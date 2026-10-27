# AnyRedact

Free online redaction for PDF, images, Word (DOCX) and text, served from Cloudflare Workers at [anyredact.app](https://anyredact.app).

## How it works

- **Detection:** the browser reads the text out of the file (pdf.js, OCR via Tesseract for images and scanned pages, XML for DOCX) and sends only that text to `POST /api/detect`. The Worker asks a Workers AI model for names, addresses, IDs and similar, keeps only strings that really occur in the text, and returns them. Nothing is stored. Requests are rate-limited per IP.
- **Matching:** `src/shared/analyze.ts` finds every mention of what the model returned and of the user's own terms, including first or last name alone (`src/shared/names.ts`), and leaves business and helpline contacts unticked. There are no local detection rules: if the AI endpoint fails, the user is told and redacts by hand.
- **Redaction** happens in the browser. Today only extracted text is sent to the server; future formats such as audio or video may need the media itself, so user-facing copy promises "processed, never stored" rather than "never uploaded".

| Format | What the download contains |
| --- | --- |
| PDF | Every page flattened to an image with solid boxes. Original text, links, forms and metadata are gone. Up to 60 pages. |
| Image (PNG/JPG/WebP) | Re-encoded image with solid boxes; EXIF, GPS, XMP and IPTC metadata is listed in the editor and dropped from the download. |
| DOCX | Same document with redacted characters replaced (█ or a `[LABEL]`). Covers body, headers, footers, footnotes, comments, tracked deletions, field codes and hyperlink targets; author names and document properties are cleared. Embedded pictures are read with OCR, can take picture redaction and drawn boxes, and are re-encoded so their metadata is dropped (GIF and BMP become PNG); alt text and the first-page thumbnail are handled too. EMF, WMF and TIFF pictures are left as they are. The editor lays the pages out with docx-preview, with highlights and picture boxes in place. |
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
npm run dev:local   # builds the site, no Cloudflare login needed; AI detection reports itself unavailable
npm run dev         # uses the real Workers AI binding (needs `wrangler login`)
npm test            # unit tests
npm run test:e2e    # with dev:local running; needs Playwright + Chromium installed
npm run typecheck
npm run deploy
```

Wrangler runs `npm run build` itself before dev, deploy and preview uploads (see `build` in `wrangler.jsonc`), so Workers Builds needs no build command. Pull request previews use the `previews` bindings.

The Workers AI model defaults to `@cf/deepseek-ai/deepseek-v4.1-flash-1017` (with thinking off) and can be overridden with an `AI_MODEL` variable. To compare models, run `node scripts/bench-models.mjs <preview-url> <model>...` against a preview deployment; previews accept a `model` in `/api/detect` requests and list the available models at `/api/models`.

## Roadmap

- Audio and video (speech-to-text with Whisper on Workers AI, then bleep/mute and blur)
- Keep a text layer in redacted PDFs
- More languages for OCR
