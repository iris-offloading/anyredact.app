# AnyRedact

Free online redaction for PDFs, images, Word documents (DOCX), PowerPoint presentations (PPTX), spreadsheets (XLSX, ODS), audio recordings, and plain or structured text—served from Cloudflare Workers at [anyredact.app](https://anyredact.app).

## How it works

- **Detection:** Your browser extracts text locally from the file (`pdf.js` for PDFs, Tesseract OCR for images and scanned pages, and XML parsing for DOCX, PPTX, XLSX, and ODS) and sends only the extracted text to `POST /api/detect`. The Worker prompts a Workers AI model to identify personal and sensitive information (names, addresses, IDs, phone numbers, and similar entities), filters the response to strings that actually appear in the source text, and returns the matches. Nothing is stored. Requests are rate-limited per IP, and a signed-out visitor's first request of the day—as well as every sign-in email—must pass Cloudflare Turnstile (`TURNSTILE_SITE_KEY` variable and `TURNSTILE_SECRET_KEY` Worker secret; disabled until both are configured).
- **Matching:** `src/shared/analyze.ts` locates every occurrence of the AI-detected values and any custom terms added by the user—including standalone first or last names (`src/shared/names.ts`)—while leaving public business and helpline numbers unchecked by default. There are no fallback regex rules on the client: if the AI endpoint is unavailable, the app notifies the user so they can redact manually.
- **Redaction:** All file reconstruction happens locally in the browser. For documents, only extracted text is sent to the server (along with rendered page images if the user opts into visual face/plate detection or the final AI review). For audio, the browser sends 16 kHz mono speech chunks to `/api/transcribe` (powered by `MAI-Transcribe-2` on Azure Speech, falling back to `Nova-3` for English and `Whisper Large v3 Turbo` for other languages on Workers AI). Because extracted text or audio chunks are sent for analysis, user-facing copy promises that data is "processed, never stored" rather than "never uploaded."

| Format | What the redacted download contains |
| --- | --- |
| PDF | Every page is flattened into an image with solid redaction boxes burned into the pixels. Underlying text layers, links, form fields, and metadata are completely removed. Supports up to 60 pages per file. |
| Image (PNG/JPG/WebP/HEIC/AVIF/GIF/BMP/TIFF/SVG) | A re-encoded image with solid redaction boxes burned into the pixels. EXIF, GPS, XMP, and IPTC metadata are displayed in the editor and stripped on download. HEIC exports as JPG, AVIF as WebP, and GIF/BMP as PNG (animated images keep their first frame). Multi-page TIFFs open all pages (up to 60, decoded with `UTIF.js`) and export as a single Deflate-compressed RGB TIFF. SVGs are safely rendered inside an `<img>` element (blocking scripts and external network requests) and flattened to PNG; embedded titles, descriptions, metadata, and links are listed for review and removed on export. |
| DOCX | The original Word document with redacted characters replaced in place (`█` or `[LABEL]`). Covers body text, headers, footers, footnotes, endnotes, comments, tracked deletions, field codes, and hyperlink targets, while clearing author names and document properties. Embedded images are scanned with OCR, support visual detection and manual box drawing, and are re-encoded to strip metadata (GIF and BMP become PNG). Image alt text and the document thumbnail are also scrubbed. Chart titles, labels, and series names are redacted, and embedded files (OLE objects and the backing workbook behind each chart) are removed. EMF, WMF, and TIFF images cannot be decoded in the browser and remain unchanged. The editor renders a live preview using `docx-preview` with interactive text highlights and image redaction boxes. |
| PPTX | The original presentation with redacted characters replaced in place (`█` or `[LABEL]`). Covers slides, tables, charts, speaker notes, comments, SmartArt, slide layouts and masters, alt text, hyperlink targets, and slide titles stored in document properties. Comment authors and file properties are cleared, and hidden slides are flagged in the editor. Embedded images and objects are handled the same way as in DOCX, and the presentation thumbnail is removed. The editor renders slides using `pptx-to-html` with interactive highlights and image boxes. |
| XLSX / ODS | The original workbook with only the redacted cells modified in place, preserving cell styles, column widths, charts, and pivot tables. Covers all worksheets (including hidden sheets, which are flagged in the editor), comments, notes, headers, and footers. Redacted numeric or formula cells are converted to plain text, and chart and pivot caches are updated to match. Author names, comment authors, custom properties, the last save path, and the workbook thumbnail are stripped. Embedded images, floating text boxes, and chart titles are not scanned. |
| Audio (MP3, M4A, WAV, FLAC, OGG, Opus, AAC, WebM) | A re-encoded audio file with selected spoken words or timeline ranges replaced by a 1 kHz beep tone or silence, plus an optional timestamped `[REDACTED]` transcript. All ID3, MP4, and Vorbis tags, cover art, and GPS location metadata are stripped. |
| Text (TXT, CSV, JSON, HTML, Markdown, SRT/VTT, code, logs…) | Masked (`█`) or labeled (`[LABEL]`) text. JSON and XML syntax remain valid, and SRT/VTT subtitle files preserve their cue numbers and timestamps (`src/shared/structured.ts`). CSV and TSV files can also be opened from the spreadsheet tool. |

Users can uncheck any individual finding, add custom words or phrases to redact everywhere, highlight arbitrary text in the preview to redact it, and drag to draw redaction boxes on PDF pages, images, or audio timelines.

## Project structure

```
src/shared/      Detection matching + text rewriting (DOM-free, unit-tested)
src/client/      Browser application; formats/ contains one loader per file type
src/worker/      Cloudflare Worker entry point (index.ts) and API endpoints
scripts/         build.mjs bundles the client and generates static SEO pages from pages.mjs
static/          Stylesheet, favicon, theme/analytics scripts, and _headers (CSP and caching)
test/            Unit tests, Playwright E2E suite (test/e2e/), and fuzz suite (test/fuzz/)
```

Each format has a dedicated landing page (`/redact-pdf`, `/redact-image`, `/redact-word`, `/redact-powerpoint`, `/redact-excel`, `/redact-text`, `/redact-audio`) with tailored metadata, copy, FAQs, and JSON-LD structured data, while `/` accepts all supported formats. Page copy lives in `scripts/pages.mjs` and `scripts/guides.mjs`, which also drive sitemap and `robots.txt` generation.

## Development

```sh
npm install
npm run dev:local   # Builds the site locally without Cloudflare login; AI endpoints report as unavailable
npm run dev         # Runs with the live Workers AI binding (requires `wrangler login`)
npm test            # Runs unit tests
npm run test:e2e    # Runs Playwright E2E tests against dev:local (requires Chromium, plus LibreOffice for ODS verification)
npm run test:fuzz   # Runs fuzz tests against dev:local across malformed and edge-case files (see test/fuzz/FINDINGS.md)
npm run typecheck
npm run deploy
node scripts/indexnow.mjs   # Submits sitemap URLs to IndexNow after deployment
```

Wrangler automatically runs `npm run build` before `dev`, `deploy`, and preview uploads (configured under `build` in `wrangler.jsonc`), so Cloudflare Workers Builds requires no custom build command. Pull request preview deployments use the `previews` environment bindings.

By default, text detection uses `@cf/deepseek-ai/deepseek-v4.1-flash-1017` (with reasoning disabled) and can be overridden via the `AI_MODEL` environment variable. To benchmark alternative models against a preview deployment, run `node scripts/bench-models.mjs <preview-url> <model>...`; preview deployments accept a `model` parameter in `/api/detect` requests and expose available models at `/api/models`. These preview-only endpoints require the `TRIAL_KEY` Worker secret, passed from the local `TRIAL_KEY` environment variable. Similarly, `scripts/bench-audio.mjs` benchmarks speech-to-text models on synthetic audio recordings. Audio transcription uses Azure Speech when `AZURE_SPEECH_URL` and `AZURE_SPEECH_KEY` are configured, and falls back to Workers AI otherwise.

## Roadmap

- Video redaction (speech-to-text bleeping/muting combined with visual face and object blurring)
- Optional searchable text layer preservation for redacted PDFs
