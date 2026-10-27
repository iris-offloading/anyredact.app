# AnyRedact

Free online redaction for PDF, images, Word (DOCX), PowerPoint (PPTX), spreadsheets (XLSX, ODS) and text, served from Cloudflare Workers at [anyredact.app](https://anyredact.app).

## How it works

- **Detection:** the browser reads the text out of the file (pdf.js, OCR via Tesseract for images and scanned pages, XML for DOCX, PPTX, XLSX and ODS) and sends only that text to `POST /api/detect`. The Worker asks a Workers AI model for names, addresses, IDs and similar, keeps only strings that really occur in the text, and returns them. Nothing is stored. Requests are rate-limited per IP.
- **Matching:** `src/shared/analyze.ts` finds every mention of what the model returned and of the user's own terms, including first or last name alone (`src/shared/names.ts`), and leaves business and helpline contacts unticked. There are no local detection rules: if the AI endpoint fails, the user is told and redacts by hand.
- **Redaction** happens in the browser. Documents send only extracted text to the server; audio sends 16 kHz mono speech chunks (`/api/transcribe`, Nova-3 for English and Whisper turbo otherwise), so user-facing copy promises "processed, never stored" rather than "never uploaded".

| Format | What the download contains |
| --- | --- |
| PDF | Every page flattened to an image with solid boxes. Original text, links, forms and metadata are gone. Up to 60 pages. |
| Image (PNG/JPG/WebP/HEIC/AVIF/GIF/BMP/TIFF/SVG) | Re-encoded image with solid boxes; EXIF, GPS, XMP and IPTC metadata is listed in the editor and dropped from the download. HEIC comes back as JPG, AVIF as WebP, GIF and BMP as PNG (animations keep their first frame). Multi-page TIFFs open every page (decoded with UTIF.js) and come back as one Deflate-compressed RGB TIFF. SVG is rendered in an `<img>` (no scripts, no external loads) and flattened to PNG; its title, description, metadata and links are listed. |
| DOCX | Same document with redacted characters replaced (█ or a `[LABEL]`). Covers body, headers, footers, footnotes, comments, tracked deletions, field codes and hyperlink targets; author names and document properties are cleared. Embedded pictures are read with OCR, can take picture redaction and drawn boxes, and are re-encoded so their metadata is dropped (GIF and BMP become PNG); alt text and the first-page thumbnail are handled too. Chart titles, labels and series names are redacted, and embedded files (OLE objects, the workbook behind each chart) are removed. EMF, WMF and TIFF pictures are left as they are. The editor lays the pages out with docx-preview, with highlights and picture boxes in place. |
| PPTX | Same deck with redacted characters replaced (█ or a `[LABEL]`). Covers slides, tables, charts, speaker notes, comments, SmartArt, text on layouts and masters, alt text, hyperlink targets and the slide titles in the file properties; comment authors and document properties are cleared, and hidden slides are flagged. Pictures are handled as in DOCX, and the first-slide thumbnail is removed. Embedded files (OLE objects, the workbook behind each chart) are removed. The editor draws the slides with pptx-to-html, with highlights and picture boxes in place. |
| XLSX / ODS | Same workbook with only the redacted cells changed, so styles, widths and charts stay. Covers every sheet (hidden ones are listed in the editor), comments, notes, headers and footers. A redacted number or formula cell becomes text; chart and pivot caches are updated. Authors, comment authors, custom properties, the save path and the thumbnail are removed. Pictures, text boxes and chart titles are not scanned. |
| Text (TXT, CSV, JSON, HTML, Markdown, SRT/VTT, code, logs…) | Masked or labelled text. JSON and XML stay valid, and subtitles keep their cue numbers and timings (`src/shared/structured.ts`). CSV and TSV also open from the spreadsheet page. |

Users can untick any detection, add their own terms, select text to redact everywhere, and draw boxes on PDF pages and images.

## Layout

```
src/shared/      detection + text rewriting (no DOM, unit-tested)
src/client/      browser app; formats/ has one loader per file type
src/worker/      Worker entry (index.ts) and the AI detection endpoint
scripts/         build.mjs bundles the client and renders the SEO pages from pages.mjs
static/          CSS, favicon, _headers (CSP and caching)
test/            unit tests; e2e/ drives every format in Chromium
```

Each tool has its own landing page (`/redact-pdf`, `/redact-image`, `/redact-word`, `/redact-powerpoint`, `/redact-excel`, `/redact-text`, `/redact-audio`) with unique title, description, FAQ and JSON-LD; `/` accepts every format. Edit copy in `scripts/pages.mjs`; the sitemap and robots.txt are generated from it.

## Develop

```sh
npm install
npm run dev:local   # builds the site, no Cloudflare login needed; AI detection reports itself unavailable
npm run dev         # uses the real Workers AI binding (needs `wrangler login`)
npm test            # unit tests
npm run test:e2e    # with dev:local running; needs Playwright + Chromium installed (and LibreOffice for the ODS check)
npm run typecheck
npm run deploy
node scripts/indexnow.mjs   # after a deploy: submit the sitemap URLs to IndexNow
```

Wrangler runs `npm run build` itself before dev, deploy and preview uploads (see `build` in `wrangler.jsonc`), so Workers Builds needs no build command. Pull request previews use the `previews` bindings.

The Workers AI model defaults to `@cf/deepseek-ai/deepseek-v4.1-flash-1017` (with thinking off) and can be overridden with an `AI_MODEL` variable. To compare models, run `node scripts/bench-models.mjs <preview-url> <model>...` against a preview deployment; previews accept a `model` in `/api/detect` requests and list the available models at `/api/models`. These preview-only features need the `TRIAL_KEY` Worker secret, sent by the scripts from the `TRIAL_KEY` environment variable. `scripts/bench-audio.mjs` compares speech-to-text models for audio redaction on synthetic recordings.

## Roadmap

- Audio and video (speech-to-text with Whisper on Workers AI, then bleep/mute and blur)
- Redact images embedded in DOCX and keep a text layer in redacted PDFs
