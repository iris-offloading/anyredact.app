# Fuzzing findings

Run on 2026-10-29 against `npm run dev:local`, Chromium (Playwright), with the model, the final check and speech-to-text stood in for.

## How to run

```sh
npm run dev:local                 # in another shell
npm run test:fuzz                 # shared-code checks, then every corpus file in the browser
node test/fuzz/run.mjs fuzz-out 'pdf$'   # one group; results in fuzz-out/results.json, screenshots in fuzz-out/shots
```

- `shared.ts` feeds random text, JSON, JSONL, XML and subtitles through matching (`analyzeUnits`, `findTerms`) and redaction (`redactStructured`, `maskText`, `labelText`, `rewriteSegments`). It checks that redacted JSON still parses, subtitles keep their timings, XML keeps its markup, and every mention of a value the model reported is covered.
- `corpus.mjs` writes 176 files (valid, unusual and broken, every format) plus 90 damaged copies of 15 valid files (cut short, bits flipped, random bytes inserted, XML parts inside Office zips cut, doubled or broken). Most files hold the same three values: Jane Doe, jane@example.com, 415-555-0132.
- `run.mjs` opens each file on its page and follows the steps a visitor takes: open and preview, Upload, detection and matching, a box drawn by hand on the first page, download. It then checks the download on its own: it decodes (sharp, pdf-lib, ffprobe), LibreOffice opens Office files, none of the three values is left in any XML part or text, metadata is gone, and text keeps characters that were not redacted. A file must open or be refused with a message; a hang, an uncaught error or a library's own wording counts as a failure.

## Results

Nothing hangs or crashes the page. Each pattern below failed at least one file before its fix; after the fixes, 4 of the 266 files fail a check (listed under Still open).

| Step | Before | After |
| --- | --- | --- |
| Open and preview | Library wording shown for damaged PDFs, zips and pictures; binary files opened as text | Plain messages; binary files refused |
| Text decoding | Windows-1252 files lost their accents (Café became Caf�) | Read in their own encoding |
| OCR | White text on a transparent picture read as nothing | Read on a dark backdrop |
| Matching | A name right after `\n` or `\t` in JSON or code was missed | Found |
| Download | Office parts the browser could not parse were skipped and left as they were | Read, or the file is refused before review |

## Failure patterns, fixed

1. **Office parts that do not parse were left unredacted (security).** Word, PowerPoint and Excel loaders skipped any XML part `DOMParser` rejected and wrote it back unchanged, so its text went into the download unredacted and unseen. A browser rejects parts that Office opens: parts saved as UTF-16 (read as UTF-8), and characters XML 1.0 forbids, such as `&#1;`, which some generators write. Fuzz cases: `word-utf16-header.docx` and `word-bad-char-header.docx` (header name in the download), `deck-*-slide.pptx` and `sheet-*-strings.xlsx` (refused with a crash message). Fix: `readXml` decodes each part by its byte order mark or XML declaration, drops forbidden characters, and refuses a file with any part that still does not parse (`checkParts` runs at open, so this happens before review rather than at download). Written parts declare UTF-8. Damaged `docProps/core.xml` or `meta.xml` used to keep the author's name the same way.
2. **Library errors shown as they are.** pdf.js ("No password given", "Invalid PDF structure.", "The PDF file is empty, i.e. its size is zero bytes."), JSZip ("Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/...", "Corrupted zip or bug: unexpected signature (\x72\x65...)"), the browser ("The source image could not be decoded."), UTIF ("Invalid array length") and a TypeError from a damaged workbook ("Cannot read properties of undefined (reading 'richText')"). Fix: the app's own messages are `FileError`s; anything else gets a message for the format. A password-protected PDF says so.
3. **Text files in Windows-1252 were corrupted.** `File.text()` reads UTF-8 only, so a CSV saved by Excel or Notepad on Windows came back with `�` in place of every accented letter, redacted or not. A UTF-8 BOM, which Excel's "CSV UTF-8" writes, was dropped, so Excel then misread the download. Fix: `decodeText` reads by BOM, then strict UTF-8, then Windows-1252, recognises UTF-16 without a BOM, and the download starts with a BOM whenever the source had one or was not UTF-8.
4. **Binary files opened as text.** Random bytes named `.txt` (or with no extension and no type) opened as garbage and could be uploaded for detection. Fix: more than 5% control bytes refuses the file.
5. **Names after an escape were missed.** `"Hello\nJane Doe"` in JSON, logs or code: whole-word matching saw the `n` of `\n` as part of the word, so the model's "Jane Doe" matched nowhere. Fix: a letter after a backslash no longer counts as a word character before a term.
6. **XML declarations kept their values.** `<!ENTITY name "Jane Doe">` in a DOCTYPE was treated as markup and never redacted. Fix: quoted values in `<!...>` declarations are redactable like attribute values.
7. **White text on a transparent picture was not read.** OCR drew pictures on white. Fix: `opaque()` in `ocr.ts` puts light marks on a black backdrop, for images and pictures inside Office files.
8. **Wrong note for damaged pictures in Word and PowerPoint.** A damaged PNG was counted as "in EMF, WMF or TIFF format". The note now says the picture could not be opened.
9. **Spreadsheet grid failing stopped the file opening.** ExcelJS, which only draws the grid, is stricter than the redaction's own reader. The preview now falls back to the cell list.

## Still open

| Finding | Files | Impact | Suggestion |
| --- | --- | --- | --- |
| No way to open a password-protected PDF | `encrypted-password.pdf` | Bank statements and payslips often have one; the visitor has to remove it elsewhere | Ask for the password (pdf.js takes it in `getDocument`) |
| Very large text in big photos is missed by OCR | `big.jpg` (200 px letters on 8000 by 6000) | One of three values not found | Read a scaled-down copy when OCR finds little on a large picture |
| CMYK TIFF with JPEG compression decodes to noise | `cmyk-jpeg.tiff` | Preview unreadable, nothing found; the download is the noise, so nothing leaks | Decode JPEG-in-TIFF strips with the browser, or refuse the file |
| SVG without width, height or viewBox is cut to 300 by 150 | `no-size.svg` | Text outside that area is not shown, read or kept, so nothing leaks | Size it from its drawn contents |
| PDF with neither xref nor trailer | `no-xref.pdf` | Refused with a plain message; desktop readers recover it | Leave |
| Random spans that split an emoji leave half of it | `shared.ts` | Only reachable with hand-made offsets; the model and terms never split one | Leave |
| `.odt`, `.odp`, `.docm` and video are refused | | Messages ask for a supported format | Formats to add later |

Formats that passed every case: plain, structured and subtitle text, CSV and TSV, JSON (BOM, comments, 5000 levels deep), XML (billion laughs is not expanded), HTML, `.env`, PDF (rotated pages, offset media box, 200 inch and 1 inch pages, 61 pages, scanned pages, per-character text, rotated text, form fields, owner-password encryption), PNG (16-bit, palette, interlaced, transparent), JPEG (CMYK, progressive, all eight EXIF orientations), WebP, AVIF, GIF and WebP animations, BMP (24-bit and 1-bit), TIFF (LZW, JPEG, tiled, 16-bit, CMYK, fax G4, two pages), SVG (scripts, external pictures, BOM, huge size), HEIC, Word (runs per character, entities, nested tables, text boxes, tabs and hyphens inside values, missing and damaged pictures, 20,000 paragraphs, LibreOffice files), PowerPoint (tables, notes, 120 slides, text only in a picture, no slides, LibreOffice files), Excel (rich text, formulas, merged cells, notes, odd sheet names, hidden and empty sheets, 100,000 cells, a cell at XFD1048576, LibreOffice files), ODS, and WAV, MP3 (tags removed), M4A, Ogg, Opus, FLAC and AAC, up to 9 minutes in three parts.
