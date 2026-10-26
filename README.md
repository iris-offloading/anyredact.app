# AnyRedact

Free online redaction for PDF, images, Word (DOCX) and text, served from Cloudflare Workers at [anyredact.app](https://anyredact.app).

## How it works

- **Private mode (default):** files are opened and redacted in the browser. Pattern rules in `src/shared/detect.ts` find emails, phone numbers, card numbers (Luhn-checked), IBANs (mod-97 checked), US SSNs, IPs, URLs and dates. Images and scanned PDF pages are read with Tesseract OCR, which the browser loads from jsDelivr.
- **AI-assisted mode (opt-in):** the browser sends the *extracted text* (never the file) to `POST /api/detect`. The Worker asks a Workers AI model for names, addresses, IDs and similar, keeps only strings that really occur in the text, and returns them. Nothing is stored. Requests are rate-limited per IP.

| Format | What the download contains |
| --- | --- |
| PDF | Every page flattened to an image with solid boxes. Original text, links, forms and metadata are gone. Up to 60 pages. |
| Image (PNG/JPG/WebP) | Re-encoded image with solid boxes; EXIF/GPS metadata is dropped. |
| DOCX | Same document with redacted characters replaced (█ or a `[LABEL]`). Covers body, headers, footers, footnotes, comments, tracked deletions, field codes and hyperlink targets; author names and document properties are cleared. Embedded images are not scanned yet. |
| Text (TXT, CSV, JSON, logs…) | Masked or labelled text. |

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

Each tool has its own landing page (`/redact-pdf`, `/redact-image`, `/redact-word`, `/redact-text`) with unique title, description, FAQ and JSON-LD; `/` accepts every format. Edit copy in `scripts/pages.mjs`; the sitemap and robots.txt are generated from it.

## Develop

```sh
npm install
npm run dev:local   # no Cloudflare login needed; AI mode reports itself unavailable
npm run dev         # uses the real Workers AI binding (needs `wrangler login`)
npm test            # unit tests
npm run test:e2e    # with dev:local running; needs Playwright + Chromium installed
npm run typecheck
npm run deploy
```

The Workers AI model defaults to `@cf/meta/llama-3.3-70b-instruct-fp8-fast` and can be overridden with an `AI_MODEL` variable.

## Roadmap

- Audio and video (speech-to-text with Whisper on Workers AI, then bleep/mute and blur)
- Redact images embedded in DOCX and keep a text layer in redacted PDFs
- More languages for OCR and patterns
