// Content for each landing page. Every tool page targets one search intent
// ("redact pdf", "redact image", ...) and links to the others.

export const SITE = {
  name: 'AnyRedact',
  origin: 'https://anyredact.app',
  tagline: 'Free online AI redaction for PDF, images, Word, PowerPoint, Excel, text, and audio',
};

// Each tool page's credit cost, from the numbers in src/shared/pricing.ts.
const textCost = ({ CREDIT_CHARS }) => `1 credit per ${CREDIT_CHARS.toLocaleString('en-US')} characters (about one page)`;

export const TOOLS = [
  {
    slug: 'redact-pdf',
    card: 'Contracts, bank statements, and scanned forms.',
    format: 'pdf',
    name: 'Redact PDF',
    nav: 'PDF',
    title: 'Auto Redact PDF Online with AI | AnyRedact',
    description:
      'Auto redact PDF files online with AI. Automatically find and remove names, addresses, and account numbers—including on scanned pages—and download a flattened PDF.',
    h1: 'Auto redact PDF online with AI',
    lead: 'Drop in a PDF to automatically find and permanently remove names, account numbers, signatures, and other sensitive details—even on scanned pages.',
    cost: textCost,
    hint: 'PDF up to 60 pages',
    art: 'pdf',
    how: [
      ['Open your PDF', 'Any scanned pages are read automatically with OCR.'],
      ['Review detected items', 'Uncheck anything you want to keep, or drag a box over signatures and stamps.'],
      ['Download a flattened PDF', 'Every page is rebuilt as an image with solid black redaction bars burned in.'],
    ],
    points: [
      ['True permanent redaction', 'Pages are flattened into images on export, permanently removing the underlying text, links, form fields, and metadata—not just covering them up.'],
      ['Works on scanned PDFs', 'Built-in OCR reads pages that have no text layer so sensitive details can still be detected automatically.'],
      ['Draw custom boxes', 'Click and drag anywhere on a page to black out signatures, stamps, photos, or anything else.'],
    ],
    faq: [
      {
        q: 'Is drawing a black box in a PDF editor enough?',
        a: 'Usually not. Most PDF editors only place a black shape on top of the page, leaving the underlying text selectable and searchable. AnyRedact rebuilds each page as a flat image, so hidden text is completely removed from the file.',
      },
      {
        q: 'Will my redacted PDF still be searchable?',
        a: 'No. Because each page is flattened into an image to guarantee nothing stays hidden underneath, the exported PDF has no selectable text layer.',
      },
    ],
  },
  {
    slug: 'redact-image',
    card: 'Screenshots, ID photos, and receipts.',
    format: 'image',
    name: 'Redact images',
    nav: 'Image',
    title: 'Auto Redact Images Online with AI | AnyRedact',
    description:
      'Auto redact JPG, PNG, HEIC, TIFF, and SVG images online with AI. Automatically black out personal text and faces while stripping EXIF and GPS metadata.',
    h1: 'Auto redact images online with AI',
    lead: 'Upload a photo, scan, or screenshot to automatically black out faces, ID numbers, and sensitive text before sharing.',
    also: 'Supports JPG, PNG, WebP, HEIC, AVIF, GIF, BMP, multi-page TIFF, and SVG.',
    cost: () => '1 credit per image',
    hint: 'PNG, JPG, WebP, HEIC, AVIF, GIF, BMP, TIFF, or SVG',
    art: 'image',
    how: [
      ['Upload or paste an image', 'Built-in OCR reads text in the image directly on your device.'],
      ['Review redaction boxes', 'Uncheck any box you want to keep, or drag new boxes over faces and logos.'],
      ['Save a clean image', 'The image is freshly re-encoded, stripping hidden camera and GPS tags.'],
    ],
    points: [
      ['Automatic text detection', 'OCR reads text in your browser, and AI highlights personal details so you don’t have to hunt for them by hand.'],
      ['Solid boxes, never blur', 'Blurred or pixelated text can sometimes be reconstructed. AnyRedact burns solid opaque black boxes directly into the pixels.'],
      ['EXIF & GPS metadata stripped', 'Every download is re-encoded from scratch, removing EXIF, XMP, and IPTC metadata such as GPS coordinates and camera details.'],
    ],
    faq: [
      {
        q: 'Can I paste a screenshot directly?',
        a: 'Yes. Copy any image to your clipboard and press Ctrl+V (or Cmd+V on Mac) anywhere on this page.',
      },
      {
        q: 'Why use solid black boxes instead of blurring?',
        a: 'Blurred or pixelated text—especially short strings like phone numbers or PINs—can often be reversed. Replacing those pixels with a solid black box permanently destroys the original information.',
      },
      {
        q: 'Can I upload iPhone HEIC photos?',
        a: 'Yes. HEIC and HEIF photos open right in your browser and export as standard JPG files.',
      },
      {
        q: 'Does it support multi-page TIFF files?',
        a: 'Yes. Every page opens in the editor, and your redacted download is saved as a single multi-page TIFF.',
      },
      {
        q: 'How are SVG files handled?',
        a: 'SVGs are flattened into PNG images on export, ensuring any hidden text layers, links, or embedded scripts are excluded from the downloaded file.',
      },
    ],
  },
  {
    slug: 'redact-word',
    card: 'Contracts, CVs, resumes, and reports—comments included.',
    format: 'docx',
    name: 'Redact Word',
    nav: 'Word',
    title: 'Auto Redact Word Documents Online with AI | AnyRedact',
    description:
      'Auto redact Word (DOCX) files online with AI. Remove personal details from body text, headers, footers, comments, and tracked changes while clearing author names.',
    h1: 'Auto redact Word online with AI',
    lead: 'Upload a .docx file to redact sensitive text, comments, tracked changes, and hidden metadata while keeping your layout and formatting intact.',
    cost: textCost,
    hint: 'Word .docx files',
    art: 'doc',
    how: [
      ['Open your .docx file', 'Body text, headers, footers, comments, and tracked changes are all scanned.'],
      ['Review detected items', 'Click any highlight to keep it, or select text in the preview to redact more.'],
      ['Download your clean .docx', 'Choose solid black bars or readable placeholders like [NAME] before saving.'],
    ],
    points: [
      ['Formatting stays intact', 'Only the redacted text changes—fonts, tables, styles, and page layout stay just as they were.'],
      ['Covers hidden document text', 'Tracked changes, review comments, headers, footers, hyperlink targets, charts, embedded images, and alt text are all scanned alongside the body.'],
      ['Author metadata cleared', 'Document properties, custom fields, and reviewer names on comments and tracked revisions are scrubbed on download.'],
    ],
    faq: [
      {
        q: 'Does it work with legacy .doc files?',
        a: 'Not directly. Open the file in Word, LibreOffice, or Google Docs and save it as .docx first.',
      },
      {
        q: 'Can I use labels like [NAME] instead of black bars?',
        a: 'Yes. Switch the style to "Replace with label" before downloading to replace personal details with tags like [NAME] or [EMAIL].',
      },
    ],
  },
  {
    slug: 'redact-powerpoint',
    card: 'Client decks and training slides, including speaker notes.',
    format: 'pptx',
    name: 'Redact PowerPoint',
    nav: 'PowerPoint',
    title: 'Auto Redact PowerPoint Online with AI | AnyRedact',
    description:
      'Auto redact PowerPoint (PPTX) presentations online with AI. Redact slides, speaker notes, comments, charts, and images while keeping your slide layout intact.',
    h1: 'Auto redact PowerPoint online with AI',
    lead: 'Upload a .pptx presentation to automatically redact names, numbers, and client details across slides, speaker notes, comments, and embedded images.',
    cost: textCost,
    hint: 'PowerPoint .pptx files',
    art: 'slide',
    how: [
      ['Open your .pptx deck', 'Slides, speaker notes, and review comments are scanned together.'],
      ['Review detected items', 'Step through your slides and uncheck anything that should stay visible.'],
      ['Download your presentation', 'The cleaned deck opens normally in PowerPoint, Keynote, or Google Slides.'],
    ],
    points: [
      ['Slide design preserved', 'Themes, fonts, layouts, shapes, and animations remain untouched.'],
      ['Notes, comments & hidden slides', 'Speaker notes, comments, hidden slides, tables, charts, SmartArt, and alt text are all redacted alongside visible slide text.'],
      ['Embedded images scanned too', 'Text inside slide images is read with OCR and blacked out, and the deck’s preview thumbnail is removed.'],
    ],
    faq: [
      {
        q: 'Does it work with legacy .ppt files?',
        a: 'Not directly. Save the presentation as .pptx in PowerPoint, Keynote, LibreOffice, or Google Slides first.',
      },
      {
        q: 'What happens to charts and embedded files?',
        a: 'Visible chart titles and labels are redacted like regular slide text. Any underlying Excel workbooks and embedded attachments are stripped out so charts stay visible without leaking raw source data.',
      },
    ],
  },
  {
    slug: 'redact-excel',
    card: 'Customer lists, payroll sheets, and data exports.',
    format: 'sheet',
    name: 'Redact Excel',
    nav: 'Excel',
    title: 'Auto Redact Excel Online with AI | AnyRedact',
    description:
      'Auto redact Excel (XLSX) and ODS spreadsheets online with AI. Find and mask names, emails, and account numbers across every worksheet, including hidden sheets.',
    h1: 'Auto redact Excel online with AI',
    lead: 'Upload a workbook to redact personal data across columns, cells, hidden sheets, and comments without breaking your spreadsheet layout.',
    also: 'Also supports OpenDocument (.ods) and CSV files.',
    cost: textCost,
    hint: 'Excel .xlsx, OpenDocument .ods, or CSV',
    art: 'sheet',
    how: [
      ['Open your workbook', 'Every worksheet is scanned row by row and cell by cell.'],
      ['Review highlighted cells', 'Click any highlight in the grid to keep that value, or select cells to add more.'],
      ['Download your spreadsheet', 'Open the cleaned workbook right back in Excel or LibreOffice.'],
    ],
    points: [
      ['Cell styles preserved', 'Only redacted cells are modified—number formats, colors, column widths, merged cells, and charts stay intact.'],
      ['Hidden sheets & comments included', 'Hidden worksheets, cell comments, notes, headers, and footers are all scanned, and hidden tabs are clearly flagged in the editor.'],
      ['Cached copies cleaned up', 'Cached values inside charts and pivot tables are updated to match, and redacted formula cells are converted to plain text so they cannot recalculate sensitive data.'],
    ],
    faq: [
      {
        q: 'Does it work with legacy .xls files?',
        a: 'Not directly. Save the spreadsheet as .xlsx in Excel, LibreOffice, or Google Sheets first.',
      },
      {
        q: 'Are formulas preserved?',
        a: 'Formulas in untouched cells keep working normally. Any formula cell whose output is redacted is converted to plain redacted text so the original value cannot be rebuilt.',
      },
      {
        q: 'Is workbook metadata removed?',
        a: 'Yes. Author names, company details, comment authors, custom properties, thumbnails, and local save paths are all stripped from the downloaded file.',
      },
    ],
  },
  {
    slug: 'redact-text',
    card: 'Logs, chat exports, config files, and support tickets.',
    format: 'text',
    name: 'Redact text',
    nav: 'Text',
    title: 'Auto Redact Text, CSV and JSON with AI | AnyRedact',
    description:
      'Paste text or upload CSV, JSON, XML, YAML, .env, or log files to automatically mask emails, phone numbers, IP addresses, API keys, and card numbers with AI.',
    h1: 'Auto redact text online with AI',
    lead: 'Paste text or upload a file to mask personal details, passwords, API keys, and other secrets in seconds.',
    also: 'Works with CSV, JSON, XML, HTML, Markdown, YAML, .env, logs, SRT and VTT subtitles, and source code.',
    cost: textCost,
    hint: 'TXT, CSV, JSON, XML, HTML, Markdown, subtitles, logs, or code',
    art: 'text',
    how: [
      ['Paste text or upload a file', 'Drop in server logs, config files, JSON payloads, or chat exports.'],
      ['Review detected items', 'Add internal hostnames or project codenames under Always redact.'],
      ['Download your masked file', 'Structure, keys, brackets, and line breaks stay right where they belong.'],
    ],
    points: [
      ['Built for logs & tickets', 'Quickly scrub customer data and credentials before sharing bug reports, transcripts, or datasets.'],
      ['Block mask or readable labels', 'Preserve exact character lengths with █ blocks, or swap sensitive values for clean placeholders like [EMAIL].'],
      ['Custom blocklists', 'Add client names, internal IDs, or codenames that should always be stripped across the entire file.'],
    ],
    faq: [
      {
        q: 'Will redaction break column alignment in CSVs or logs?',
        a: 'No. Choosing "Black out" replaces each sensitive character with █ while keeping spaces, delimiters, and line lengths intact.',
      },
      {
        q: 'Will redacted JSON or XML files still parse cleanly?',
        a: 'Yes. Quotes, brackets, escapes, and XML tags are preserved, and any redacted numeric value in JSON is safely quoted as a string so the file stays valid.',
      },
      {
        q: 'Will redacted SRT or VTT subtitles still play?',
        a: 'Yes. Cue numbers and timestamps in SRT and VTT subtitle files are never modified.',
      },
    ],
  },
  {
    slug: 'redact-audio',
    card: 'Call recordings, interviews, and voice notes.',
    format: 'audio',
    name: 'Redact audio',
    nav: 'Audio',
    title: 'Auto Redact Audio Online with AI | AnyRedact',
    description:
      'Auto redact MP3, M4A, WAV, and other audio recordings online with AI. Transcribe speech, bleep or mute spoken names and card numbers, and save a clean file.',
    h1: 'Auto redact audio online with AI',
    lead: 'Upload a recording to automatically detect and bleep spoken names, phone numbers, and card details—complete with a matching redacted transcript.',
    also: 'Supports MP3, M4A, WAV, FLAC, OGG, and Opus.',
    cost: ({ AUDIO_CREDITS_PER_MINUTE }) => `${AUDIO_CREDITS_PER_MINUTE} credits per minute`,
    hint: 'MP3, M4A, WAV, FLAC, OGG, or Opus, up to 2 hours',
    art: 'audio',
    how: [
      ['Upload a recording', 'Speech is transcribed alongside an interactive audio timeline.'],
      ['Review the transcript', 'Play back sections and uncheck any words you want to leave audible.'],
      ['Download clean audio', 'Export the bleeped or muted audio file—plus a redacted text transcript if you need one.'],
    ],
    points: [
      ['Word-level audio sync', 'Every spoken word is transcribed with precise timestamps, so sensitive details are bleeped at the exact moment they are said.'],
      ['Manual timeline selection', 'Click and drag anywhere on the audio timeline to bleep or mute sections that weren’t caught in the transcript.'],
      ['Audio metadata stripped', 'Title, artist, comments, cover art, and GPS recording tags are omitted when encoding your clean audio file.'],
    ],
    faq: [
      {
        q: 'Can I mute sections with silence instead of a beep?',
        a: 'Yes. Change Style from "Beep" to "Silence" before downloading your redacted audio.',
      },
      {
        q: 'Which spoken languages are supported?',
        a: 'English and roughly 60 other languages, powered by Microsoft MAI-Transcribe-2 word-level speech recognition.',
      },
    ],
  },
];

export const HOME = {
  slug: '',
  format: 'all',
  title: 'AnyRedact: Free Online Auto Redaction Tool with AI',
  description:
    'Free online AI redaction tool for PDFs, images, Word, PowerPoint, Excel, text, and audio. Automatically detect personal information, review every match, and store nothing.',
  h1: 'Redact anything, with AI that finds it for you',
  lead: 'Upload PDFs, images, Word documents, PowerPoint decks, Excel spreadsheets, text files, or audio recordings—our AI finds sensitive details so you can remove them permanently.',
  hint: 'PDF, Word (DOCX), PowerPoint (PPTX), Excel (XLSX), ODS, images, text, or audio',
  points: [
    ['Permanent redaction', 'Sensitive text, pixels, and audio are genuinely removed from the exported file—never just hidden behind a movable shape.'],
    ['You stay in control', 'Review every match before downloading. Uncheck anything you want to keep, add custom terms, or draw boxes by hand.'],
    ['Metadata stripped too', 'Author names, revision history, EXIF GPS coordinates, and audio tags are automatically cleared when you export.'],
  ],
  steps: [
    ['Open your file', 'Choose a file, drop it onto the page, or paste a screenshot. It opens right in your browser alongside a list of detected items.'],
    ['Review every match', 'Uncheck anything you want to leave visible. Highlight text or drag boxes to add more, or list custom terms to redact everywhere.'],
    ['Download your clean copy', 'Export with solid black bars or labels like [NAME]. An optional final AI check scans the output first to catch anything missed.'],
  ],
  finds: [
    ['Names', 'People mentioned in body text, greetings, signatures, and email threads'],
    ['Addresses', 'Street addresses, postal codes, and personal email addresses'],
    ['Phone numbers', 'Mobile, landline, and international phone numbers'],
    ['ID numbers', 'Social Security, passport, driver’s license, national ID, and tax numbers'],
    ['Financial details', 'Payment card numbers, IBANs, sort codes, and bank account numbers'],
    ['Online identifiers', 'IP addresses, private URLs, API keys, passwords, and tokens'],
    ['Personal dates', 'Dates of birth and other dates linked to an individual'],
    ['Visual details', 'Faces, screens, road signs, and license/number plates when enabled'],
  ],
  faq: [
    {
      q: 'Is AnyRedact free to use?',
      a: 'Yes. Every browser gets 10 free credits per day with no watermarks and no sign-up required. One credit covers roughly one page of text or one image, and audio costs 3 credits per minute. Need more? Subscribe to a monthly plan or buy non-expiring credit packs.',
    },
    {
      q: 'Do I need to create an account?',
      a: 'Only if you want to purchase additional credits or a monthly plan. You can sign in anytime with a magic email link or Google.',
    },
    {
      q: 'Do you store or train on my files?',
      a: 'No. Nothing leaves your browser until you click Upload to confirm. When you do, only the extracted text (plus page images if road sign/plate detection is enabled, or audio chunks for recordings) is processed in memory to find sensitive data and immediately discarded. Your content is never stored, logged, or used to train AI models.',
    },
    {
      q: 'Can redacted content be recovered from the downloaded file?',
      a: 'No. PDF pages are flattened into fresh images, Office documents and text files have the original characters overwritten, images are re-encoded from pixels, and audio samples are replaced with a tone or silence. Always keep your original file if you may need it later.',
    },
    {
      q: 'Does AnyRedact work on mobile devices?',
      a: 'Yes. AnyRedact works in any modern phone or tablet browser, with dedicated Preview and Found tabs tailored for smaller screens.',
    },
  ],
};
