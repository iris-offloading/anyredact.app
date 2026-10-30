// Guides under /guides. Bodies are HTML, rendered by scripts/build.mjs into the
// prose layout. Keep the steps in line with what the editor does, and give
// every guide its own wording: the site never repeats a phrase.
import { pdfLayersDiagram, photoMetadataDiagram, redactionKindsDiagram, sarTimelineDiagram } from './diagrams.mjs';

export const GUIDES_INDEX = {
  slug: 'guides',
  title: 'Redaction Guides and How-Tos | AnyRedact',
  description: 'Step-by-step guides to redacting PDFs, Word documents, images, Excel spreadsheets, PowerPoint slides, audio, and logs—plus how to avoid common redaction leaks.',
  h1: 'Redaction guides',
  lead: 'Practical step-by-step tutorials for every file format, plus best practices for permanent, leak-free redaction.',
};

export const PUBLISHED = '2026-10-27';

export const GUIDES = [
  {
    slug: 'what-is-redaction',
    title: 'What Does Redacted Mean? Redaction Explained | AnyRedact',
    description: 'Redacted means sensitive parts of a document, photo, or recording were permanently removed before sharing. Learn how redaction works and why DIY cover-ups fail.',
    h1: 'What does redacted mean?',
    summary: 'What redaction means, how redacted files look across formats, and why simple cover-up methods leak data.',
    body: `
<p>When a document, image, or recording is <strong>redacted</strong>, sensitive details have been permanently removed before the file is shared. The rest of the record stays intact so the recipient gets the context they need without seeing confidential information they aren’t entitled to view.</p>
<p>Although the practice originated in legal filings and declassified government records—where names, Social Security numbers, and classified passages are blacked out—it now applies to everyday files: screenshots attached to support tickets, spreadsheets shared with contractors, bank statements sent to landlords, and call recordings used for training.</p>

<h2>Where the word comes from</h2>
<p><em>Redact</em> comes from the Latin <em>redigere</em>, meaning to bring back, collect, or reduce. For centuries in English, redacting simply meant editing or preparing a manuscript for publication. Its modern meaning—removing confidential passages before releasing a document—took hold in the twentieth century as governments began publishing declassified records with sensitive lines blacked out.</p>

<h2>What redaction looks like in different files</h2>
<p>How redaction appears depends on the file format, though it almost always leaves a clear cue that information was intentionally withheld:</p>
<ul>
<li><strong>Text documents.</strong> Solid black bars over words, or bracketed placeholders such as <code>[NAME]</code> or <code>[ACCOUNT]</code>. Government Freedom of Information releases often print a legal exemption code beside each bar. Our <a href="/redact-pdf">PDF</a>, <a href="/redact-word">Word</a>, and <a href="/redact-text">plain text</a> tools work this way.</li>
<li><strong>Spreadsheets.</strong> Sensitive cell values are masked in place while column headers and table structure stay readable. Try our <a href="/redact-excel">Excel &amp; ODS tool</a>.</li>
<li><strong>Photos and scans.</strong> Solid opaque boxes cover faces, license/number plates, signatures, ID numbers, and background screens, while embedded GPS and camera metadata are stripped out. Try our <a href="/redact-image">image redaction tool</a>.</li>
<li><strong>Audio recordings.</strong> A tone (bleep) or silence replaces spoken names, addresses, or card numbers, paired with a matching masked transcript. Try our <a href="/redact-audio">audio redaction tool</a>.</li>
<li><strong>Video.</strong> Opaque boxes or heavy masks track faces and plates frame by frame while spoken details on the audio track are muted or bleeped.</li>
</ul>

<h2>Redaction vs. deletion vs. anonymization</h2>
${redactionKindsDiagram()}
<ul>
<li><strong>Deletion</strong> removes an entire file or database record altogether.</li>
<li><strong>Redaction</strong> preserves the document while removing specific passages, typically leaving visible marks (such as black bars, <code>[NAME]</code> tags, or bleeps) so readers can see where details were withheld.</li>
<li><strong>Anonymization</strong> transforms an entire dataset so no individual can be re-identified—even by combining indirect fields like age, postal code, and job title. Simply redacting names rarely achieves full anonymization on its own.</li>
</ul>

<h2>Common cover-up mistakes that still leak data</h2>
<p>Most high-profile redaction failures look completely blacked out on screen, yet leave the original data intact inside the file:</p>
<ul>
<li><strong>Drawing a black box or black highlighter over text.</strong> Underneath the shape, the text can still be selected, copied, or found with search. Read more in <a href="/guides/pdf-black-box-mistakes">why black boxes in PDFs fail</a>.</li>
<li><strong>Changing text color to white.</strong> White text on a white page is invisible to the eye, but anyone can highlight and paste it in seconds.</li>
<li><strong>Blurring or pixelating short strings.</strong> Blurred numbers, names, and email addresses can often be reconstructed by comparing candidate strings blurred with the same filter.</li>
<li><strong>Non-destructive cropping.</strong> Certain editors hide cropped areas off-canvas rather than discarding those pixels, allowing them to be restored later.</li>
<li><strong>Overlooking hidden metadata.</strong> Review comments, tracked deletions, speaker notes, hidden worksheets, author properties, and photo EXIF GPS coordinates travel silently inside the file.</li>
</ul>

<h2>What proper redaction requires</h2>
<ol>
<li>Destroying the underlying characters, pixels, or audio samples inside the file itself—never just placing a visual layer on top.</li>
<li>Catching secondary copies in headers, footers, alt text, chart caches, pivot tables, and incremental save history.</li>
<li>Stripping hidden metadata such as author names, GPS coordinates, and revision history.</li>
<li>Inspecting and searching the exported file afterward to confirm the sensitive values are truly gone.</li>
</ol>

<h2>Why organizations and individuals redact</h2>
<ul>
<li><strong>Data privacy laws.</strong> Regulations like GDPR in Europe and HIPAA in the United States require organizations to safeguard personal and medical data whenever records are disclosed.</li>
<li><strong>Legal privilege.</strong> Attorney–client advice can be withheld during litigation discovery even when surrounding sections of an email or memo must be produced.</li>
<li><strong>Court filing rules.</strong> Courts routinely require filers to mask Social Security numbers, dates of birth, financial account numbers, and minors’ names in public dockets.</li>
<li><strong>Public records requests.</strong> Freedom of Information laws open government records to the public while exempting personal privacy, law enforcement sources, and national security details.</li>
<li><strong>Security and trade secrets.</strong> API keys, passwords, pricing terms, and vendor contracts can be stripped before sharing logs or business decks externally.</li>
</ul>

<h2>Everyday situations where redaction helps</h2>
<ul>
<li>Responding to a <a href="/guides/gdpr-subject-access-request-redaction">GDPR data subject access request (SAR)</a> or Freedom of Information request.</li>
<li>Preparing court exhibits, HR bundles, or legal discovery documents.</li>
<li>Sharing <a href="/guides/how-to-redact-a-bank-statement">bank statements</a>, pay stubs, or ID scans with a landlord or lender while hiding unrelated transactions.</li>
<li>Posting screenshots, crash logs, or configuration files in bug trackers or public forums.</li>
<li>Sanitizing documents, spreadsheets, or transcripts <a href="/guides/redact-before-sharing-with-ai">before pasting them into AI chatbots</a> or sending them to vendors.</li>
</ul>
<p>Not sure what to look for? Check our <a href="/guides/personal-information-checklist">personal information checklist</a>.</p>

<h2>Frequently asked questions</h2>
<h3>Can a redacted document be un-redacted?</h3>
<p>Not when redacted properly—the original characters, pixels, or audio samples no longer exist in the exported copy. "Reversed" redactions happen when someone merely covered text with a movable PDF rectangle, black highlighter, or reversible blur. Always keep your unredacted original stored separately in case you need it later.</p>
<h3>Is redaction the same thing as censorship?</h3>
<p>Both remove content, but for very different purposes. Redaction withholds narrowly defined personal, privileged, or confidential details so the rest of a document can be safely shared. Censorship suppresses expression or ideas to prevent people from reading or publishing them.</p>
<h3>Who decides what should be redacted?</h3>
<p>Whoever is disclosing the file: a privacy or compliance team in an organization, legal counsel following court rules in a lawsuit, or you yourself when sharing personal paperwork. In legal and regulatory contexts, you should be ready to justify each redaction under the applicable rule or exemption.</p>
<h3>Is it legal to redact a document before sending it?</h3>
<p>In most everyday situations, yes—and privacy laws often require it. The main exception is when you are under a legal obligation to produce an unaltered record, such as a subpoena, court order, or mortgage underwriting check. Removing information without disclosing or justifying it in legal proceedings can result in sanctions.</p>
<h3>What does "[redacted]" mean in casual messages or social posts?</h3>
<p>Online, writers often type <code>[redacted]</code> as a playful nod to declassified government memos when skipping a name, company, or spoiler. Nothing was technically stripped from a file—the author simply chose not to type the word.</p>
`,
  },
  {
    slug: 'pdf-black-box-mistakes',
    title: 'Why Black Boxes in PDFs Fail | AnyRedact',
    description: 'Drawing a black rectangle over PDF text leaves the underlying words selectable and searchable. Learn where hidden PDF text survives and how to test any file in two minutes.',
    h1: 'Why black boxes in PDFs fail',
    tools: ['redact-pdf'],
    summary: 'Text underneath a drawn PDF rectangle can still be copied out. See where hidden text survives and how to test your files.',
    body: `
<p>A PDF stores text, vector shapes, and images as independent layers on a page. When you draw a black rectangle using a markup or comment tool, the editor simply paints a dark shape above the existing text. Visually, the words disappear—but anything that reads the underlying text layer (copy-and-paste, Ctrl+F search, screen readers, or automated scrapers) still sees every original character.</p>
${pdfLayersDiagram()}

<h2>Where hidden text survives inside a PDF</h2>
<ul>
<li><strong>Underneath markup annotations.</strong> Drawn rectangles, black highlighter strokes, and stamps sit in an annotation layer that anyone can drag aside, delete, or copy right through.</li>
<li><strong>In the invisible OCR layer of scanned pages.</strong> Scanners and PDF apps often place an invisible searchable text layer behind the page image. Painting over the image alone leaves that hidden OCR text intact.</li>
<li><strong>Inside interactive form fields.</strong> Filled PDF form inputs retain their stored field values even if an opaque box is placed on top of them.</li>
<li><strong>In incremental save history.</strong> Many PDF editors append edits to the end of the file rather than rewriting it cleanly, leaving earlier unredacted versions of a page embedded in the raw bytes.</li>
<li><strong>In bookmarks, hyperlink URLs, attachments, and metadata.</strong> None of these show up on the printed page, yet all of them routinely carry full names, email addresses, and internal file paths.</li>
</ul>

<h2>How to test any redacted PDF in two minutes</h2>
<ol>
<li>Open the PDF in your browser or reader, press <strong>Ctrl+A</strong> (or <strong>Cmd+A</strong> on Mac), copy everything, and paste it into a plain text editor. Anything readable there is still inside the PDF.</li>
<li>Press <strong>Ctrl+F</strong> (or <strong>Cmd+F</strong>) and search for a name or number you redacted.</li>
<li>Check <strong>Document Properties</strong> for the author, title, subject, and keywords fields.</li>
<li>Inspect the bookmarks, comments, and attachments panels in your PDF viewer to make sure nothing extra is riding along.</li>
</ol>

<h2>How to redact a PDF permanently</h2>
<p>True redaction removes the underlying data rather than masking it visually. AnyRedact goes a step further by flattening every page into a fresh bitmap image on export—eliminating the text layer, form fields, annotations, links, attachments, and metadata in a single pass. Follow our step-by-step guide on <a href="/guides/how-to-redact-a-pdf">how to redact a PDF</a> to try it free.</p>
`,
  },
  {
    slug: 'how-to-redact-a-pdf',
    title: 'How to Redact a PDF for Free | AnyRedact',
    description: 'Redact a PDF online for free in minutes: let AI detect names and account numbers, review every match, and download a flattened PDF with zero hidden text.',
    h1: 'How to redact a PDF',
    tools: ['redact-pdf'],
    summary: 'Go from raw PDF—digital or scanned—to a permanently flattened, clean download.',
    body: `
<p>Follow these steps with our free <a href="/redact-pdf">online PDF redaction tool</a>. The same workflow handles digital PDFs, interactive forms, and scanned documents up to 60 pages per file.</p>

<h2>Step-by-step instructions</h2>
<ol>
<li><strong>Open your PDF.</strong> Choose a file or drop it onto the upload area. Each page renders in your browser, and any scanned pages without selectable text are read automatically using local OCR.</li>
<li><strong>Confirm AI detection.</strong> Extracted text is sent for AI detection only after you click <strong>Upload</strong>. Prefer to keep everything local? Skip the upload and draw redaction boxes manually.</li>
<li><strong>Review the Found list.</strong> Every detected item is highlighted on its page. Uncheck anything that should stay visible, such as your own company name or dates needed for context.</li>
<li><strong>Add anything else.</strong> Drag directly on any page to draw solid black boxes over signatures, stamps, QR codes, or photos—or list recurring names and IDs under <strong>Always redact</strong>.</li>
<li><strong>Download your clean PDF.</strong> Leave <strong>Check for missed details</strong> checked to have a second AI model verify the masked text, then save your redacted copy.</li>
</ol>

<h2>What you get in the downloaded PDF</h2>
<p>Every page is flattened into a clean image with solid black redaction boxes burned permanently into the pixels. Underlying text layers, interactive form fields, hyperlinks, bookmarks, embedded attachments, and document metadata are all stripped out—leaving nothing underneath to copy or extract.</p>
<p>Because each page becomes a flat image, the downloaded PDF is not text-searchable. If a recipient needs searchable text, you can safely run OCR on the exported PDF afterward—it will only see the visible, unredacted text.</p>

<h2>Practical tips</h2>
<ul>
<li>Low-contrast scans and handwritten notes are harder for OCR to read accurately. Zoom in and drag manual boxes over handwritten fields or faint stamps.</li>
<li>Enter case numbers, internal codes, or unusual spellings under <strong>Always redact</strong> so every page is matched automatically.</li>
<li>For PDFs longer than 60 pages, split the document into sections first and redact each part separately.</li>
<li>Business switchboards and public helplines are detected automatically but left unchecked by default. Check <strong>Redact company and public contacts</strong> at the top of the list if you want those removed too.</li>
</ul>
`,
  },
  {
    slug: 'how-to-redact-a-word-document',
    title: 'How to Redact a Word Document (DOCX) | AnyRedact',
    description: 'Redact a Word (.docx) file online without breaking its formatting. Automatically scrub body text, comments, tracked changes, headers, images, and author metadata.',
    h1: 'How to redact a Word document',
    tools: ['redact-word'],
    summary: 'Preserve your Word layout while scrubbing body text, comments, tracked changes, and author names.',
    body: `
<p>Microsoft Word doesn’t include a true built-in redaction tool. Using Find &amp; Replace misses text inside images and leaves deleted phrases visible in Track Changes, while Word’s Document Inspector strips comments wholesale without touching sensitive names in the body. Our <a href="/redact-word">Word redaction tool</a> handles all of it in a single pass while keeping your formatting intact.</p>

<h2>Step-by-step instructions</h2>
<ol>
<li><strong>Open your .docx file.</strong> Your document renders right in the browser with its pages and layout intact. (If you have an older <code>.doc</code> file, save it as <code>.docx</code> in Word, LibreOffice, or Google Docs first.)</li>
<li><strong>Click Upload to scan</strong> and wait a moment for the <strong>Found</strong> list to populate.</li>
<li><strong>Review highlights.</strong> Click any highlighted span on the page—or toggle its checkbox in the sidebar—to keep or redact it. Off-page text like comments and image alt text appears below the pages under <strong>Also in this file</strong>.</li>
<li><strong>Choose a redaction style.</strong> Pick <strong>Black out</strong> to replace characters with solid <code>█</code> blocks, or <strong>Replace with label</strong> to insert clean tags like <code>[NAME]</code> and <code>[EMAIL]</code> so sentences still flow naturally.</li>
<li><strong>Download</strong> your redacted <code>.docx</code> file.</li>
</ol>

<h2>Hidden places where Word stores text</h2>
<ul>
<li>Page headers, footers, footnotes, endnotes, and floating text boxes.</li>
<li>Review comments and the names/initials of everyone who commented.</li>
<li>Tracked insertions and deletions—including text someone deleted earlier without accepting revisions.</li>
<li>Hyperlink URLs and <code>mailto:</code> addresses hidden behind link text.</li>
<li>Charts and the embedded Excel spreadsheets stored behind them.</li>
<li>Embedded images (such as scanned signatures) and their accessibility alt text.</li>
<li>Document metadata: author, last modified by, company, manager, custom DMS fields, and template paths.</li>
</ul>
<p>AnyRedact scans all of these locations automatically, strips embedded attachments and chart workbooks, scrubs author names, and removes the cached first-page thumbnail.</p>

<h2>Double-check before sending</h2>
<p>Open your downloaded <code>.docx</code> in Word, switch <strong>Review → Tracking</strong> to <strong>All Markup</strong>, and search for a couple of the redacted names. Finally, glance at <strong>File → Info → Properties</strong> to confirm author fields are blank.</p>
`,
  },
  {
    slug: 'how-to-redact-a-screenshot',
    title: 'How to Redact a Screenshot or Photo | AnyRedact',
    description: 'Black out sensitive text, faces, and license/number plates in screenshots or photos—and strip hidden EXIF GPS metadata. Supports PNG, JPG, iPhone HEIC, TIFF, and SVG.',
    h1: 'How to redact a screenshot or photo',
    tools: ['redact-image'],
    summary: 'Paint permanent solid boxes over text, faces, and plates while stripping hidden GPS metadata.',
    body: `
<p>Screenshots reveal far more than most people realize: open browser tabs, notification banners, customer emails in a sidebar, session tokens in the address bar, or the last digits of a card. Camera photos add bystanders’ faces, street signs, license plates, and embedded GPS coordinates. Our <a href="/redact-image">image redaction tool</a> cleans all of them in one place.</p>

<h2>Step-by-step instructions</h2>
<ol>
<li><strong>Paste or upload your image.</strong> Copy a screenshot and press <strong>Ctrl+V</strong> (or <strong>Cmd+V</strong> on Mac) right on the page, or choose an image file from your device.</li>
<li><strong>Scan text with OCR + AI.</strong> Built-in OCR reads visible text in your browser, and AI highlights personal details once you click <strong>Upload</strong>.</li>
<li><strong>Enable visual detection if needed.</strong> Under <strong>In images</strong>, toggle <strong>Faces</strong>, <strong>Screens</strong>, <strong>Road signs</strong>, or <strong>Number plates</strong>.</li>
<li><strong>Fine-tune the boxes.</strong> Click any box to toggle it off, or drag directly on the image to black out avatars, QR codes, barcodes, or handwritten notes.</li>
<li><strong>Download your clean image.</strong> iPhone HEIC photos automatically export as widely compatible JPG files.</li>
</ol>

<h2>Always use solid boxes—never blur</h2>
<p>Gaussian blur, mosaic filters, and pixelation smear the original pixels in predictable ways. For short strings like phone numbers, email addresses, or amounts, attackers can test candidate text under the same blur filter until the pattern matches. Painting a solid black box overwrites those pixels completely so nothing can be reconstructed.</p>

<h2>Automatic EXIF &amp; GPS removal</h2>
<p>Smartphone and camera photos embed EXIF metadata recording the exact GPS coordinates, date and time, phone model, and sometimes lens or body serial numbers. The editor displays any metadata found in your original file and re-encodes the downloaded image from raw pixels so none of those tags carry over. Learn more in <a href="/guides/remove-photo-metadata">how to remove location and camera data from photos</a>.</p>

<h2>Details people often overlook</h2>
<ul>
<li>Reflections in eyeglasses, windows, or glossy monitor bezels.</li>
<li>Employee badges, shipping labels, sticky notes, and mail sitting on a desk.</li>
<li>URLs containing account IDs, reset links, or API tokens in the browser address bar.</li>
<li>Avatars, @handles, and quoted replies in chat screenshots.</li>
</ul>
`,
  },
  {
    slug: 'how-to-redact-an-excel-spreadsheet',
    title: 'How to Redact an Excel Spreadsheet | AnyRedact',
    description: 'Redact names, emails, and account numbers in Excel (XLSX) and ODS workbooks while preserving styles, column widths, and formulas—hidden sheets and caches included.',
    h1: 'How to redact an Excel spreadsheet',
    tools: ['redact-excel'],
    summary: 'Scrub personal data from Excel and ODS workbooks without breaking styles, formulas, or charts.',
    body: `
<p>Deleting a column in Excel feels quick, until a formula breaks or an unredacted copy resurfaces inside a hidden tab or pivot cache. Our <a href="/redact-excel">Excel redaction tool</a> edits workbooks in place—preserving cell formatting and layout while cleaning hidden copies automatically.</p>

<h2>Step-by-step instructions</h2>
<ol>
<li><strong>Open your .xlsx or .ods workbook.</strong> Your spreadsheet loads into an interactive read-only grid complete with worksheet tabs.</li>
<li><strong>Click Upload to scan.</strong> Personal details are highlighted right inside their cells—even when a single cell contains multiple items.</li>
<li><strong>Review cell by cell.</strong> Click any highlight in the grid to keep or redact it. Selecting a cell shows its full contents in the formula-style bar above the grid.</li>
<li><strong>Add custom redactions.</strong> Type recurring terms under <strong>Always redact</strong>, click an unhighlighted cell to redact it, or highlight specific words in the cell bar and choose <strong>Redact here</strong> or <strong>Redact everywhere</strong>.</li>
<li><strong>Download</strong> the cleaned spreadsheet in its original <code>.xlsx</code> or <code>.ods</code> format.</li>
</ol>

<h2>Where spreadsheets hide duplicate data</h2>
<ul>
<li><strong>Hidden and "very hidden" worksheets.</strong> Both are automatically scanned, revealed in the preview tabs, and flagged in the file notes.</li>
<li><strong>Formulas.</strong> A formula could otherwise recalculate a redacted name or ID from other cells, so any redacted formula cell is safely converted to plain text while untouched formulas keep working.</li>
<li><strong>Chart and PivotTable caches.</strong> Excel and Calc store cached snapshots of source data inside charts and pivot tables; AnyRedact updates those caches to match your redactions.</li>
<li><strong>Cell comments, notes, headers, and footers.</strong> Every one of these is scanned alongside worksheet cells.</li>
<li><strong>Workbook metadata.</strong> Author names, company fields, comment authors, thumbnails, and local save-folder paths are stripped on export.</li>
</ul>

<h2>Working with CSV files</h2>
<p>Because CSV files contain plain delimited text rather than worksheet styles or formulas, they open in our <a href="/redact-text">text redaction tool</a>, which preserves every comma, quote, and row break.</p>

<h2>Sharing datasets safely</h2>
<p>Keep in mind that masking names and emails doesn’t automatically make a spreadsheet anonymous: combining a ZIP/postal code, birth date, and job title can still single out an individual. Review our <a href="/guides/personal-information-checklist">personal information checklist</a> before publishing raw datasets.</p>
`,
  },
  {
    slug: 'how-to-redact-a-powerpoint',
    title: 'How to Redact a PowerPoint Presentation | AnyRedact',
    description: 'Redact a PowerPoint (.pptx) presentation online while keeping its slide design intact: slides, speaker notes, comments, charts, and embedded images.',
    h1: 'How to redact a PowerPoint presentation',
    tools: ['redact-powerpoint'],
    summary: 'Scrub client names, notes, comments, and chart data before sharing a slide deck externally.',
    body: `
<p>Slide decks routinely get repurposed and forwarded far beyond the meeting they were created for—often still carrying client names in speaker notes, internal comments, hidden backup slides, and full Excel workbooks embedded behind charts. Our <a href="/redact-powerpoint">PowerPoint redaction tool</a> cleans every layer while leaving your visual slide design untouched.</p>

<h2>Step-by-step instructions</h2>
<ol>
<li><strong>Open your .pptx deck.</strong> Each slide renders directly in the preview. (Convert older <code>.ppt</code> or Keynote files to <code>.pptx</code> first.)</li>
<li><strong>Click Upload to scan.</strong> Slide copy, speaker notes, comments, charts, and OCR text from slide images are analyzed together.</li>
<li><strong>Review detected items.</strong> Click highlights on the slides to keep or redact them. Off-slide content like speaker notes, comments, and alt text is listed right below the slides under <strong>Also in this file</strong>.</li>
<li><strong>Pick black blocks or labels</strong>, then download your cleaned <code>.pptx</code> presentation.</li>
</ol>

<h2>Everything that gets checked and cleaned</h2>
<ul>
<li>Visible slide text, tables, SmartArt diagrams, slide layouts/masters, and hidden slides.</li>
<li>Speaker notes and review comments (with comment author names scrubbed).</li>
<li>Chart titles, series names, and axis labels—plus automatic removal of the underlying embedded Excel workbooks so recipients see the chart without accessing raw source sheets.</li>
<li>Embedded slide images, scanned with OCR so you can black out screenshots, faces, or logos right in place.</li>
<li>Image alt text, document properties, slide-title metadata, and the cached first-slide thumbnail image.</li>
</ul>

<h2>Quick check before sharing</h2>
<p>Open the exported deck in PowerPoint, switch to <strong>Notes Page</strong> or <strong>Normal</strong> view to spot-check speaker notes, and glance at <strong>File → Info</strong> to verify author properties are clear.</p>
`,
  },
  {
    slug: 'how-to-redact-audio',
    title: 'How to Redact an Audio Recording | AnyRedact',
    description: 'Automatically bleep or mute spoken names, phone numbers, and card details in MP3, M4A, and WAV recordings—and download clean audio with a matching transcript.',
    h1: 'How to redact an audio recording',
    tools: ['redact-audio'],
    summary: 'Detect and bleep spoken personal details in calls and interviews, complete with a redacted transcript.',
    body: `
<p>Support calls, research interviews, and voice notes are packed with spoken PII: payment card numbers read aloud to an agent, home addresses, and dates of birth used for identity verification. Searching a waveform by ear takes forever—our <a href="/redact-audio">audio redaction tool</a> transcribes the recording with word-level timestamps so AI can pinpoint and bleep sensitive speech automatically.</p>

<h2>Step-by-step instructions</h2>
<ol>
<li><strong>Open your audio file.</strong> Upload an MP3, M4A, WAV, FLAC, OGG, or Opus recording up to 2 hours long.</li>
<li><strong>Click Upload to transcribe and scan.</strong> Speech is transcribed with word-by-word timestamps, and each paragraph links directly to its position in the audio.</li>
<li><strong>Review the transcript.</strong> Click any highlighted word to toggle its bleep on or off, or click a word or timestamp to listen back from that spot.</li>
<li><strong>Mark anything extra.</strong> Highlight words in the transcript to bleep them, or click and drag directly across the audio timeline to cover mumbled speech, background voices, or crosstalk.</li>
<li><strong>Choose Beep or Silence</strong> under <strong>Style</strong> and download your clean audio file. Need text too? Click <strong>Download redacted transcript</strong> for a matching masked transcript.</li>
</ol>

<h2>Tips for call recordings</h2>
<ul>
<li>People often read credit card and phone numbers with pauses between digit groups. Play back the seconds around each number and drag on the timeline if a stray digit wasn’t caught.</li>
<li>Names spelled out letter by letter (like "S-M-I-T-H") can transcribe as separate letters—scan the transcript for short runs of single letters.</li>
<li>Double-check the opening and closing 30 seconds of a call, where speakers introduce themselves cleanly.</li>
</ul>

<h2>Audio metadata is stripped automatically</h2>
<p>Audio files often carry ID3 or MP4 metadata tags—title, artist, comments, cover art, and even smartphone GPS coordinates where a voice memo was recorded. Your exported audio file is freshly encoded without any of those tags.</p>
`,
  },
  {
    slug: 'how-to-redact-logs-and-json',
    title: 'How to Redact Logs and JSON Before Sharing | AnyRedact',
    description: 'Mask emails, IP addresses, API keys, and tokens in logs, JSON, XML, YAML, and .env files before sharing bug reports—while keeping structured files valid.',
    h1: 'How to redact logs and JSON before sharing',
    tools: ['redact-text'],
    summary: 'Scrub API keys, tokens, IPs, and customer PII from logs, JSON payloads, and config files without breaking syntax.',
    body: `
<p>Debugging an issue with a vendor, teammate, or AI assistant usually means sharing application logs, JSON payloads, or config files—the exact places where customer emails, client IPs, session cookies, and live API keys hide. Our <a href="/redact-text">text redaction tool</a> masks sensitive values while keeping structured syntax intact.</p>

<h2>Step-by-step instructions</h2>
<ol>
<li><strong>Paste text or upload a file.</strong> Open <code>.log</code>, <code>.txt</code>, <code>.csv</code>, <code>.json</code>, <code>.jsonl</code>, <code>.xml</code>, <code>.yaml</code>, <code>.toml</code>, <code>.ini</code>, <code>.env</code>, or source code files.</li>
<li><strong>Click Upload to scan</strong> for emails, phone numbers, IP addresses, payment cards, private keys, and tokens.</li>
<li><strong>Add internal identifiers</strong> under <strong>Always redact</strong>—such as internal hostnames, tenant IDs, S3 bucket names, or project codenames.</li>
<li><strong>Pick your style.</strong> <strong>Black out</strong> preserves exact character counts (ideal for aligned log columns), while <strong>Replace with label</strong> swaps values for readable tags like <code>[IP ADDRESS]</code> or <code>[EMAIL]</code>.</li>
<li><strong>Download</strong> the sanitized file.</li>
</ol>

<h2>Syntax-aware structured output</h2>
<p>Unlike naive search-and-replace, AnyRedact understands structured formats: JSON and XML stay 100% parseable, quotes, escape sequences, brackets, and tags are never corrupted, and redacted numeric JSON fields are quoted as strings so <code>JSON.parse()</code> still succeeds. YAML and <code>.env</code> files keep their key names intact so readers can see which variable was masked.</p>

<h2>Secrets &amp; identifiers to watch for</h2>
<ul>
<li><code>Authorization</code> headers, Bearer JWTs, session cookies, and pre-signed storage URLs.</li>
<li>Database connection strings containing embedded usernames and passwords.</li>
<li>PEM, OpenSSH, and PGP private keys (even when escaped with <code>\n</code> inside JSON).</li>
<li>Customer email addresses, UUIDs, and account numbers inside URL query strings.</li>
<li>Local filesystem paths in stack traces that expose an employee’s username.</li>
</ul>

<h2>Already leaked a live key? Rotate it immediately</h2>
<p>Redacting a log before sending it to the next person won’t protect a secret that was already pasted into a public issue or chat room. If a live credential ever leaked, revoke and rotate it right away.</p>
`,
  },
  {
    slug: 'remove-photo-metadata',
    title: 'Remove Location and EXIF Data from Photos | AnyRedact',
    description: 'Photos silently record GPS coordinates, timestamps, and device details in EXIF metadata. Learn how to inspect photo metadata and save a clean copy on any device.',
    h1: 'Remove location and camera data from photos',
    tools: ['redact-image'],
    summary: 'Inspect the hidden EXIF and GPS tags inside a photo and save a clean copy without them.',
    body: `
<p>Every time you snap a photo on a phone or digital camera, it embeds hidden EXIF metadata inside the file: the exact date and time, GPS latitude and longitude, camera or phone model, lens settings, and sometimes the owner’s name or body serial number. While some social networks strip EXIF on upload, email attachments, file-sharing links, AirDrop, and messaging apps sent "as file" preserve all of it.</p>

<h2>How to inspect a photo’s metadata</h2>
<ul>
<li><strong>Windows:</strong> Right-click the image, select <strong>Properties</strong>, and open the <strong>Details</strong> tab.</li>
<li><strong>Mac:</strong> Open the image in <strong>Preview</strong>, choose <strong>Tools → Show Inspector</strong>, and click the <strong>(i)</strong> info tab (plus the EXIF and GPS sub-tabs).</li>
<li><strong>iPhone / iPad:</strong> Open the photo in <strong>Photos</strong> and swipe up (or tap the <strong>i</strong> button) to see the map pin and camera details.</li>
<li><strong>Android:</strong> Open the photo in <strong>Google Photos</strong> and swipe up to view location and device metadata.</li>
<li><strong>Any browser:</strong> Drop the photo into our <a href="/redact-image">image redaction tool</a> to view its EXIF, GPS, XMP, and IPTC tags right in the sidebar.</li>
</ul>

<h2>How to strip metadata from a photo</h2>
${photoMetadataDiagram()}
<ul>
<li><strong>In AnyRedact (any device):</strong> Open the photo and click <strong>Download redacted image</strong>. Because the image is freshly re-encoded from canvas pixels, all EXIF, GPS, XMP, and IPTC metadata is left behind—even if you don’t draw any redaction boxes.</li>
<li><strong>On Windows:</strong> In <strong>Properties → Details</strong>, click <strong>Remove Properties and Personal Information</strong> and choose <strong>Create a copy with all possible properties removed</strong>.</li>
<li><strong>On iPhone before sharing:</strong> In the iOS Share Sheet, tap <strong>Options</strong> at the top and toggle off <strong>Location</strong> before sending.</li>
</ul>

<h2>Don’t forget visual location clues</h2>
<p>Stripping EXIF tags won’t hide landmarks visible inside the photo itself. Street signs, house numbers, license plates, delivery labels, school uniforms, and distinctive skylines can pinpoint a location just as accurately as GPS coordinates. Toggle on <strong>Road signs</strong> and <strong>Number plates</strong> under <strong>In images</strong>, and drag manual boxes over anything else that gives away where the photo was taken.</p>
`,
  },
  {
    slug: 'personal-information-checklist',
    title: 'What Personal Information to Redact: Checklist | AnyRedact',
    description: 'A practical PII redaction checklist covering direct identifiers, indirect combinations, GDPR special-category data, and easy-to-miss metadata.',
    h1: 'What personal information to redact',
    summary: 'A practical checklist of direct identifiers, risky combinations, sensitive categories, and commonly missed details.',
    body: `
<p>Personally identifiable information (PII)—called "personal data" under GDPR—includes any detail that identifies an individual either on its own or when combined with other facts. Exactly what you need to remove depends on who will receive the document, but this checklist covers what to check before sharing.</p>

<h2>Direct identifiers</h2>
<ul>
<li>Full names, maiden names, usernames, @handles, initials, and handwritten signatures.</li>
<li>Street addresses, apartment numbers, and postal/ZIP codes.</li>
<li>Personal email addresses and mobile or home phone numbers.</li>
<li>Government ID numbers: Social Security numbers (SSN), ITINs, National Insurance numbers, passport numbers, driver’s licenses, and tax IDs.</li>
<li>Financial identifiers: payment card numbers, IBANs, bank account numbers, and routing/sort codes.</li>
<li>Internal record IDs: patient numbers, employee IDs, customer IDs, policy numbers, and case numbers.</li>
<li>Clear photos of faces and recordings of identifiable voices.</li>
</ul>

<h2>Indirect identifiers that single people out in combination</h2>
<p>None of these name a person directly, yet two or three of them together often narrow a record down to one specific individual:</p>
<ul>
<li>Date of birth, exact age, or graduation/hire dates.</li>
<li>Postal code, neighborhood, or workplace location.</li>
<li>Specific job titles (especially one-of-a-kind roles like "VP of Legal, EMEA").</li>
<li>Uncommon diagnoses, life events, or family circumstances.</li>
<li>IP addresses, device IDs, session identifiers, and vehicle license/number plates.</li>
</ul>

<h2>Special-category &amp; high-sensitivity data</h2>
<p>Medical and health records, racial or ethnic origin, religious beliefs, political opinions, trade union membership, sexual orientation, biometric data, and criminal history carry heightened legal protection under GDPR, HIPAA, and similar frameworks. Always redact these unless the recipient has a clear, lawful basis to see them.</p>

<h2>Places people routinely forget to check</h2>
<ul>
<li>Quoted email headers and signature blocks buried halfway down a forwarded thread.</li>
<li>The file name itself (for example, renaming <code>Jane_Smith_Payslip_Oct.pdf</code> before sending).</li>
<li>Word/Excel review comments, tracked deletions, hidden sheets, and PowerPoint speaker notes.</li>
<li>Document author properties and embedded EXIF GPS coordinates in photos.</li>
<li>QR codes and barcodes on letters, boarding passes, badges, and shipping labels.</li>
<li>Partially masked numbers (like <code>**** 4821</code>) when another page reveals the rest or confirms a match.</li>
</ul>

<h2>Avoid over-redacting</h2>
<p>Removing too much can make a document useless—or trigger pushback in a regulatory or legal disclosure. Leave dates, totals, headings, and surrounding context intact wherever they don’t identify anyone. Public business details—such as a company’s main switchboard or a government helpline—rarely need redacting, which is why AnyRedact flags them as public and leaves them unchecked by default.</p>
`,
  },
  {
    slug: 'gdpr-subject-access-request-redaction',
    title: 'Redacting Documents for a GDPR Access Request | AnyRedact',
    description: 'Responding to a GDPR subject access request (SAR)? Learn how to redact third-party personal data while keeping the requester’s information, plus SAR deadlines and workflow tips.',
    h1: 'Redacting documents for a GDPR access request',
    summary: 'Whose data to redact in a GDPR subject access request (SAR), statutory deadlines, and a repeatable workflow.',
    body: `
<p>Under EU and UK GDPR, individuals have the right to request a copy of the personal data an organization holds about them—known as a <strong>data subject access request (DSAR or SAR)</strong>. Because real-world emails, support tickets, HR notes, and spreadsheets almost always mention colleagues, customers, or other third parties alongside the requester, those third-party details usually must be redacted before disclosure.</p>
<p><em>Note: This guide provides practical background information, not legal advice.</em></p>

<h2>What to redact—and what to leave visible</h2>
<ul>
<li><strong>Third-party personal data.</strong> Redact names, contact details, and identifying facts about other individuals unless they have consented to disclosure or it is reasonable to disclose without their consent.</li>
<li><strong>Legally exempt material.</strong> Withhold passages covered by a statutory GDPR exemption, such as legal professional privilege, confidential references, or information that would prejudice crime prevention or ongoing negotiations.</li>
<li><strong>Out-of-scope sections.</strong> In long multi-topic reports or spreadsheets, remove rows or sections that have nothing to do with the requester.</li>
</ul>
<p><strong>Never redact the requester’s own personal data</strong> simply because it is awkward or critical. Their name, statements they made, and others’ recorded opinions about them are part of their personal data (subject to third-party Balancing Test rules).</p>

<h2>Statutory SAR deadlines</h2>
<p>You must respond within <strong>one calendar month</strong> of receiving the request. If a request is genuinely complex or involves a large volume of records, you may extend the deadline by up to <strong>two additional months</strong>—provided you notify the requester and explain why before the first month expires.</p>
${sarTimelineDiagram()}

<h2>A practical SAR redaction workflow</h2>
<ol>
<li>Gather responsive records and deduplicate identical items (such as the same email chain saved across three mailboxes).</li>
<li>Open each file in the matching AnyRedact tool: <a href="/redact-pdf">PDF</a>, <a href="/redact-word">Word</a>, <a href="/redact-excel">Excel</a>, <a href="/redact-image">Images</a>, <a href="/redact-audio">Audio</a>, or <a href="/redact-text">Text</a>.</li>
<li>Uncheck detections that belong to the requester so their own details remain readable. Add coworkers’ and other customers’ names under <strong>Always redact</strong> so every mention—including first names and initials—is caught consistently.</li>
<li>In Word and text files, consider choosing <strong>Replace with label</strong> (such as <code>[NAME]</code> or <code>[EMAIL]</code>) so sentences still make sense to the requester.</li>
<li>Keep an internal exemption log recording which files were redacted and the legal basis for each category of withholding, in case the supervisory authority asks to review your handling.</li>
</ol>

<h2>Final checks before disclosure</h2>
<ul>
<li>Spot-search exported files for key third-party names and email addresses.</li>
<li>Remember to check email attachments, embedded spreadsheets, and call recordings—not just email bodies.</li>
<li>Verify that PDF redactions are truly flattened rather than covered with movable shapes; see <a href="/guides/pdf-black-box-mistakes">why black boxes in PDFs fail</a>.</li>
</ul>
`,
  },
  {
    slug: 'how-to-redact-a-bank-statement',
    title: 'How to Redact a Bank Statement | AnyRedact',
    description: 'Safely hide account numbers, payees, and private spending before sharing a bank statement as proof of income or address with a landlord, employer, or agency.',
    h1: 'How to redact a bank statement',
    tools: ['redact-pdf', 'redact-image'],
    summary: 'Prove your address or income without exposing full account numbers or personal spending.',
    body: `
<p>Landlords, letting agents, visa agencies, and prospective employers frequently ask for a recent bank statement when all they really need to verify is your home address or recurring salary deposits. Sharing an unedited statement exposes your full account number, where you shop, medical or religious donations, and everyone you pay. Redacting unrelated details lets you verify what they asked for without oversharing.</p>

<h2>Check the recipient’s rules first</h2>
<p>Before redacting, confirm what your recipient accepts. Mortgage underwriters, courts, and certain visa authorities require completely unaltered statements (or direct open-banking verification) and will reject edited files. Landlords, property managers, and many HR checks, on the other hand, gladly accept redacted statements as long as your name, bank header, and relevant deposits remain clear.</p>

<h2>What you typically keep visible</h2>
<ul>
<li>Your full name and residential address (especially for proof-of-address checks).</li>
<li>Your bank’s name, logo, and the statement date range.</li>
<li>Relevant salary or benefit deposits—plus opening and closing balances if required for affordability checks.</li>
</ul>

<h2>What you typically redact</h2>
<ul>
<li>Full bank account numbers, routing/sort codes, IBANs, and card numbers (leaving the last four digits visible is helpful if they need to match a payment method).</li>
<li>Everyday merchant and payee names, which can reveal medical visits, travel habits, subscriptions, or personal beliefs.</li>
<li>Names of friends, family members, or clients on incoming and outgoing transfers.</li>
<li>Transaction reference notes, invoice numbers, and running balances if not required.</li>
</ul>

<h2>Step-by-step instructions</h2>
<ol>
<li><strong>Open your statement</strong> in our <a href="/redact-pdf">PDF redaction tool</a> (or use the <a href="/redact-image">image tool</a> for mobile banking screenshots and photos).</li>
<li><strong>Click Upload to scan.</strong> Account numbers, IBANs, card numbers, addresses, and names are highlighted automatically across every page.</li>
<li><strong>Uncheck details that need to stay visible</strong>—such as your own name, your address, and your employer’s payroll line.</li>
<li><strong>Drag boxes over unrelated transactions.</strong> You can drag one solid box across an entire block of private spending rows in seconds.</li>
<li><strong>Download</strong> your flattened PDF and inspect each page before sending.</li>
</ol>

<h2>Why AnyRedact flattens your statement</h2>
<p>Exported PDF statements are rebuilt as flat page images so nobody can copy hidden account numbers or merchant names from underneath a black bar. Keep in mind that flattening also removes any cryptographic bank signature embedded in the original PDF—if an institution requires a digitally signed PDF, ask your bank whether they can export a filtered deposit confirmation letter instead.</p>
`,
  },
  {
    slug: 'how-to-redact-a-chat-export',
    title: 'How to Redact a WhatsApp or Slack Chat Export | AnyRedact',
    description: 'Mask names, phone numbers, and private links in exported WhatsApp, Telegram, or Slack chat logs before sharing them as evidence, research data, or support tickets.',
    h1: 'How to redact a chat export',
    tools: ['redact-text'],
    summary: 'Scrub names, phone numbers, and links from WhatsApp, Telegram, and Slack chat exports.',
    body: `
<p>Exported chat histories frequently end up in legal bundles, HR investigations, academic studies, and customer support tickets. Raw exports name every participant on every line—and messages themselves are full of phone numbers, home addresses, shared pins, and links. Our <a href="/redact-text">text redaction tool</a> scans the entire conversation while keeping its message-by-message structure intact.</p>

<h2>How to export your chat</h2>
<ul>
<li><strong>WhatsApp:</strong> Open the conversation, tap the menu → <strong>More → Export chat</strong>, and choose <strong>Without media</strong>. Unzip the archive if needed to get the <code>.txt</code> transcript.</li>
<li><strong>Telegram Desktop:</strong> Open the chat menu → <strong>Export chat history</strong>, and select <strong>Machine-readable JSON</strong> (or plain text).</li>
<li><strong>Slack:</strong> Workspace exports produce a folder of daily <code>.json</code> files per channel—open whichever daily files you need to share.</li>
</ul>

<h2>Step-by-step instructions</h2>
<ol>
<li><strong>Open the <code>.txt</code> or <code>.json</code> export</strong> in the text tool, or paste the relevant excerpt directly.</li>
<li><strong>Click Upload to scan.</strong> AI detects names, phone numbers, email addresses, street addresses, and private URLs in both sender headers and message bodies.</li>
<li><strong>Add nicknames and handles</strong> under <strong>Always redact</strong>. Casual chats use first names, nicknames, and Slack <code>@handles</code> that you’ll want stripped consistently everywhere.</li>
<li><strong>Choose a style.</strong> <strong>Replace with label</strong> swaps names for <code>[NAME]</code> and numbers for <code>[PHONE]</code>. (Tip: if readers need to distinguish Speaker A from Speaker B, replace each participant’s name with <code>Person A</code> and <code>Person B</code> in a text editor first, then run AnyRedact to catch remaining numbers, emails, and addresses.)</li>
<li><strong>Download</strong> your sanitized chat log—JSON exports stay valid JSON automatically.</li>
</ol>

<h2>Chat details that are easy to miss</h2>
<ul>
<li>Raw phone numbers displayed as sender names for unsaved WhatsApp contacts.</li>
<li>Group subject changes and system messages like <em>"Alex added +1 415-555-0199"</em>.</li>
<li>Shared live-location or Google/Apple Maps URLs containing exact GPS coordinates.</li>
<li>Slack user IDs, email signatures pasted into messages, and invite links.</li>
</ul>
<p>Need to share screenshots or voice notes from the same thread? Redact them separately using our <a href="/redact-image">image</a> and <a href="/redact-audio">audio</a> tools.</p>
`,
  },
  {
    slug: 'redact-before-sharing-with-ai',
    title: 'Remove Personal Data Before Pasting into ChatGPT | AnyRedact',
    description: 'Strip client names, emails, and account numbers from documents before pasting them into ChatGPT, Claude, or Gemini—while keeping the context AI needs.',
    h1: 'Remove personal data before pasting into an AI chatbot',
    tools: ['redact-text', 'redact-pdf'],
    summary: 'Get great answers from ChatGPT, Claude, or Gemini without exposing client names, emails, or secrets.',
    body: `
<p>Summarizing a contract, drafting a reply to a customer complaint, or analyzing a spreadsheet with ChatGPT, Claude, or Gemini usually means handing over the entire document. Depending on the AI service and plan you use, prompts may be stored in chat history, reviewed by human contractors, or used to train future models—and most workplace policies prohibit pasting unredacted customer or employee PII into external chatbots. Redacting first lets you use AI productively without leaking private data.</p>

<h2>Use placeholder labels so the AI keeps full context</h2>
<p>Chatbots reason much better when sentences keep their grammatical roles. Choosing <strong>Replace with label</strong> turns <em>"Anna Novak emailed anna@example.com on 04/12/2026"</em> into <em>"[NAME] emailed [EMAIL] on [DATE]"</em>—so the assistant still understands who contacted whom and when, without ever seeing real personal data.</p>

<h2>Step-by-step workflow</h2>
<ol>
<li><strong>Paste your text</strong> into our <a href="/redact-text">text redaction tool</a>, or open your file in the tool for its format (<a href="/redact-word">Word</a>, <a href="/redact-excel">Excel</a>, <a href="/redact-pdf">PDF</a>, and more).</li>
<li><strong>Click Upload to scan</strong> and review the <strong>Found</strong> list.</li>
<li><strong>Add proprietary terms</strong> under <strong>Always redact</strong>—such as client company names, deal codenames, or internal URLs.</li>
<li><strong>Select "Replace with label"</strong> under Style and download (or copy) the sanitized output.</li>
<li><strong>Paste the redacted version</strong> into ChatGPT, Claude, or Gemini.</li>
</ol>
<p>When the chatbot gives you its draft or summary, simply swap the real names back into your local copy. Always keep your original file on your computer—redacted exports cannot be reversed.</p>

<h2>How AnyRedact’s own AI handles your data</h2>
<p>To find PII automatically, AnyRedact sends extracted text over HTTPS to our Cloudflare Worker, where an AI model running on Cloudflare Workers AI identifies sensitive spans in memory. Nothing is sent until you click <strong>Upload</strong>, your content is never stored, logged, or used to train models, and you can always skip the upload to redact manually. Read our <a href="/privacy">privacy policy</a> for full details.</p>

<h2>Extra details worth stripping before prompting</h2>
<ul>
<li>Email signature blocks containing direct phone numbers, titles, and office addresses.</li>
<li>Internal customer IDs, ticket numbers, and order references.</li>
<li>API keys, database URLs, and internal hostnames in code snippets.</li>
<li>Salary figures, medical notes, and HR performance details tied to identifiable staff.</li>
</ul>
`,
  },
  {
    slug: 'remove-metadata-from-docx',
    title: 'How to Remove Metadata from a DOCX File | AnyRedact',
    description: 'Clear author names, company details, reviewer names, and custom properties from a Word (.docx) file using Word’s Document Inspector or free online.',
    h1: 'How to remove metadata from a DOCX file',
    tools: ['redact-word'],
    summary: 'Strip hidden author names, company info, reviewer identities, and custom fields from Word files.',
    body: `
<p>Under the hood, every <code>.docx</code> file is a ZIP archive of XML parts—and several of those files describe <em>who</em> created and edited the document rather than what’s written on the page. When you email a Word file externally, anyone who checks its properties can see who originally drafted it, who edited it last, which organization their Office license belongs to, and everyone who left comments.</p>

<h2>What a Word document records behind the scenes</h2>
<ul>
<li><strong>Author and Last Modified By</strong> names pulled automatically from Microsoft Office account settings.</li>
<li><strong>Company and Manager</strong> fields populated by corporate Office installations.</li>
<li><strong>Title, Subject, Keywords, and Category</strong> properties—which often still reflect an old template or earlier client’s document.</li>
<li><strong>Custom XML and DMS properties</strong> added by legal or enterprise document management tools (such as client IDs, matter numbers, or server paths).</li>
<li><strong>Reviewer names and initials</strong> attached to every comment and tracked change, plus a hidden list of contributors in <code>word/people.xml</code>.</li>
<li><strong>A preview thumbnail image</strong> of the first page, if saved with one.</li>
<li><strong>EXIF GPS and camera metadata</strong> embedded inside photos pasted into the document.</li>
</ul>
<p>To inspect these in Word, open <strong>File → Info</strong> and look at the <strong>Properties</strong> column on the right (click <strong>Show All Properties</strong> or <strong>Advanced Properties</strong> to see custom fields).</p>

<h2>Option 1: Word on Windows (Inspect Document)</h2>
<ol>
<li>Save a backup copy first—changes made by Document Inspector cannot be undone after saving.</li>
<li>Open <strong>File → Info → Check for Issues → Inspect Document</strong>.</li>
<li>Make sure <strong>Document Properties and Personal Information</strong> is checked (along with <strong>Comments, Revisions, and Versions</strong> if you want markup deleted completely), then click <strong>Inspect</strong>.</li>
<li>Click <strong>Remove All</strong> next to each category you want cleared, then save the file.</li>
</ol>
<p>Keep two caveats in mind: Document Inspector deletes comments and tracked changes outright rather than anonymizing their authors (wiping out useful review context), and it never touches names or emails written inside the document text itself.</p>

<h2>Option 2: Word for Mac</h2>
<p>Word for Mac doesn’t include the full Windows Document Inspector. Instead, go to <strong>Tools → Protect Document</strong> (or the <strong>Review</strong> tab → <strong>Protect → Protect Document</strong>), check <strong>Remove personal information from this file on save</strong>, and save. That scrubs author and reviewer names, though you should still open <strong>File → Properties</strong> afterward to clear any lingering Company, Title, or Custom fields manually.</p>

<h2>Option 3: Online without Word (plus text redaction)</h2>
<p>Our free <a href="/redact-word">online Word redaction tool</a> scrubs hidden metadata automatically on every download—whether or not you also redact names in the body text:</p>
<ol>
<li><strong>Open your .docx file</strong> right in your browser.</li>
<li><strong>Click Upload</strong> if you also want AI to find personal details in the text—or skip the upload if you only want to strip metadata.</li>
<li><strong>Download your clean .docx.</strong> Core properties (author, last modified by, title, subject, keywords, category, company, and manager) are emptied, custom properties are deleted, embedded files are dropped, and the first-page thumbnail is removed.</li>
</ol>
<p>Unlike Word’s inspector, AnyRedact preserves your comments and tracked changes while replacing every reviewer’s name with <code>Redacted</code>, so collaborators keep the markup without exposing who wrote what. Standard embedded photos are also re-encoded to strip camera and GPS tags (vector EMF/WMF and TIFF graphics stay untouched).</p>

<h2>Verify your cleaned file</h2>
<p>Open the downloaded <code>.docx</code>, check <strong>File → Info → Properties</strong>, and hover over any comment to confirm the author reads <em>Redacted</em>. Working with standalone image files too? See our guide on <a href="/guides/remove-photo-metadata">removing EXIF and location metadata from photos</a>.</p>
`,
  },
];
