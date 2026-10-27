// Content for each landing page. Every tool page targets one search intent
// ("redact pdf", "redact image", ...) and links to the others.

export const SITE = {
  name: 'AnyRedact',
  origin: 'https://anyredact.app',
  tagline: 'Free online redaction for PDF, images, Word, Excel, text and audio',
};


export const TOOLS = [
  {
    slug: 'redact-pdf',
    format: 'pdf',
    name: 'Redact PDF',
    nav: 'PDF',
    title: 'Auto Redact PDF Online with AI | AnyRedact',
    description:
      'Auto redact PDF files online with AI. Names, addresses and account numbers are marked on every page, including scans, and the download is flattened so the text is gone.',
    h1: 'Auto redact PDF online with AI',
    lead: 'Drop a PDF and our AI will find and permanently remove names, numbers, signatures, and other sensitive details, including on scanned pages.',
    hint: 'PDF up to 60 pages',
    points: [
      ['True redaction', 'Pages are flattened to images on export, so the original text, links, form fields and metadata are gone, not just covered.'],
      ['Scanned PDFs too', 'Pages without a text layer are read with OCR so their contents can be detected.'],
      ['Draw your own boxes', 'Drag over signatures, photos or anything else the detector missed.'],
    ],
    faq: [
      {
        q: 'Is a black box drawn in a PDF editor enough?',
        a: 'Often not. Many editors only place a shape on top, and the text underneath can still be copied. AnyRedact rebuilds each page as an image, so the hidden text is gone from the file.',
      },
      {
        q: 'Will my redacted PDF still be searchable?',
        a: 'No. Each page is flattened to an image, so the output has no text layer.',
      },
    ],
  },
  {
    slug: 'redact-image',
    format: 'image',
    name: 'Redact images',
    nav: 'Image',
    title: 'Auto Redact Images Online with AI: JPG, PNG, WebP, HEIC | AnyRedact',
    description:
      'Auto redact images online with AI. Text in the picture is read, personal details get solid black boxes, and EXIF and GPS data are stripped. Works with JPG, PNG, WebP, HEIC and screenshots.',
    h1: 'Auto redact images online with AI',
    lead: 'Upload a photo, scan, or screenshot to automatically black out faces, ID numbers, and any text you don’t want shared.',
    also: 'Works with JPG, PNG, WebP and HEIC.',
    hint: 'PNG, JPG, WebP or HEIC, or paste a screenshot',
    points: [
      ['Automatic text detection', 'OCR reads the image on your device, then AI marks what to hide.'],
      ['Solid boxes, not blur', 'Blur and pixelation can sometimes be reversed. AnyRedact paints solid black boxes.'],
      ['Metadata removed', 'The download is re-encoded, which strips EXIF, XMP and IPTC data such as GPS location and camera details.'],
    ],
    faq: [
      {
        q: 'Can I paste a screenshot directly?',
        a: 'Yes. Copy it and press Ctrl+V or Cmd+V on this page.',
      },
      {
        q: 'Why not blur instead of a black box?',
        a: 'Blurred or pixelated text can sometimes be reconstructed. A solid box replaces the pixels.',
      },
      {
        q: 'Can I upload iPhone photos?',
        a: 'Yes. HEIC and HEIF photos open here and download as JPG.',
      },
    ],
  },
  {
    slug: 'redact-word',
    format: 'docx',
    name: 'Redact Word',
    nav: 'Word',
    title: 'Auto Redact Word Online with AI: DOCX | AnyRedact',
    description:
      'Auto redact Word (DOCX) files online with AI. Personal details are removed from the body, headers, footers, comments and tracked changes, and author names are cleared.',
    h1: 'Auto redact Word online with AI',
    lead: 'Upload a .docx to redact sensitive text, comments, tracked changes, and metadata while keeping your formatting intact.',
    hint: 'Word .docx files',
    points: [
      ['Formatting kept', 'Only the sensitive characters change. Fonts, tables and layout stay as they were.'],
      ['Hidden places too', 'Tracked changes, comments, headers, footers, hyperlink targets, pictures and their alt text are redacted along with the body.'],
      ['Author names removed', 'Document properties and the names on comments and revisions are cleared.'],
    ],
    faq: [
      {
        q: 'Does it work with old .doc files?',
        a: 'Not yet. Save it as .docx in Word, LibreOffice or Google Docs first.',
      },
      {
        q: 'Can I replace text with a label instead of black boxes?',
        a: 'Yes. Pick "Replace with label" to turn an email address into [EMAIL], for example.',
      },
    ],
  },
  {
    slug: 'redact-excel',
    format: 'sheet',
    name: 'Redact Excel',
    nav: 'Excel',
    title: 'Auto Redact Excel Online with AI: XLSX, ODS, CSV | AnyRedact',
    description:
      'Auto redact Excel (XLSX) workbooks online with AI. Names, emails and account numbers are found on every sheet, hidden sheets included. Accepts ODS and CSV as well.',
    h1: 'Auto redact Excel online with AI',
    lead: 'Upload a spreadsheet to redact personal data in columns, cells, hidden sheets, and comments without breaking your layout.',
    also: 'Works with ODS and CSV.',
    hint: 'Excel .xlsx, OpenDocument .ods or CSV',
    points: [
      ['Cells keep their styles', 'Only redacted cells change. Number formats, colours, column widths and charts stay put.'],
      ['Hidden sheets too', 'Hidden sheets, comments, notes, headers and footers are scanned, and hidden sheets are listed in the editor.'],
      ['No copies left behind', 'Values cached by charts and pivot tables are updated, and a redacted formula becomes plain text so it cannot rebuild the value.'],
    ],
    faq: [
      {
        q: 'Does it work with old .xls files?',
        a: 'Not yet. Save it as .xlsx in Excel, LibreOffice or Google Sheets first.',
      },
      {
        q: 'Are formulas kept?',
        a: 'Yes, except in cells whose result is redacted. Those hold the redacted text instead.',
      },
      {
        q: 'Is the workbook author cleared?',
        a: 'Yes. The author, company, comment authors, custom properties and the folder the file was saved in are left out of the download.',
      },
    ],
  },
  {
    slug: 'redact-text',
    format: 'text',
    name: 'Redact text',
    nav: 'Text',
    title: 'Auto Redact Text Online with AI: CSV, JSON, Logs | AnyRedact',
    description:
      'Auto redact text online with AI. Paste text or upload a CSV, JSON, XML, YAML, .env or log file to mask emails, phone numbers, IP addresses and card numbers before sharing.',
    h1: 'Auto redact text online with AI',
    lead: 'Paste text or upload a file to mask personal info, passwords, API keys, and other secrets in seconds.',
    also: 'Works with CSV, JSON, XML, YAML, .env, Markdown and log files.',
    hint: 'TXT, CSV, JSON, XML, YAML, .env or logs',
    points: [
      ['Great for logs and support tickets', 'Strip customer details before sharing logs, transcripts or datasets.'],
      ['Mask or label', 'Keep the shape of the text with █ blocks, or replace values with labels like [EMAIL].'],
      ['Your own terms', 'Add names or project codes that should always be removed.'],
    ],
    faq: [
      {
        q: 'Can I keep the layout of a CSV or log?',
        a: 'Yes. Black out keeps every line and column in place, using █ for each removed character.',
      },
      {
        q: 'Will a redacted JSON or XML file still parse?',
        a: 'Yes. Quotes, brackets and tags are left alone, and a redacted number becomes a string.',
      },
    ],
  },
  {
    slug: 'redact-audio',
    format: 'audio',
    name: 'Redact audio',
    nav: 'Audio',
    title: 'Auto Redact Audio Online with AI: MP3, M4A, WAV | AnyRedact',
    description:
      'Auto redact audio online with AI. The speech is transcribed, and names, phone numbers and card numbers are bleeped in a new file. Handles MP3, M4A, WAV, FLAC, OGG and Opus.',
    h1: 'Auto redact audio online with AI',
    lead: 'Upload a recording and we’ll bleep spoken sensitive details, then give you the redacted audio and a redacted transcript.',
    also: 'Works with MP3, M4A, WAV, FLAC, OGG and Opus.',
    hint: 'MP3, M4A, WAV, FLAC, OGG or Opus, up to 2 hours',
    points: [
      ['Found in the transcript', 'Speech is written out with a time for every word, so each finding is bleeped where it was said.'],
      ['Pick any stretch', 'Drag on the timeline to bleep a part the transcript missed.'],
      ['Tags removed', 'Title, artist, comments, cover art and recording location are left out of the new file.'],
    ],
    faq: [
      {
        q: 'Can I use silence instead of a beep?',
        a: 'Yes. Pick Silence under Style before you download.',
      },
      {
        q: 'Which languages work?',
        a: 'English and most widely spoken languages. English recordings are transcribed with Deepgram Nova-3, others with OpenAI Whisper.',
      },
    ],
  },
];

export const HOME = {
  slug: '',
  format: 'all',
  title: 'AnyRedact: Free Online Redaction Tool for PDF, Images, Word, Excel, Text & Audio',
  description:
    'Redact PDFs, images, Word documents, spreadsheets, text and audio online for free. AI finds the personal information, you review it, and nothing is stored.',
  h1: 'Redact anything, with AI that finds it for you',
  lead: 'Upload PDFs, images, Word, Excel, text, or audio files, and our AI will find and redact sensitive information in all of them.',
  hint: 'PDF, Word (DOCX), Excel (XLSX), ODS, PNG, JPG, WebP, HEIC, text or audio',
  points: [
    ['Faces and plates too', 'Optionally black out faces, screens, road signs and number plates in pictures.'],
    ['Real redaction', 'Sensitive content is removed from the file, not just hidden under a box.'],
    ['Review before you download', 'Every detection can be switched off, and you can add your own words or draw boxes.'],
  ],
  faq: [
    {
      q: 'Is AnyRedact free?',
      a: 'Yes. You get 10 credits a day. One credit covers one page of text or one picture, and a minute of audio takes 3. For more, buy a monthly plan or a credit pack that never expires. There is no watermark.',
    },
    {
      q: 'Do I need an account?',
      a: 'Only to buy credits. Sign in with an email link or with Google.',
    },
    {
      q: 'Do you store my files?',
      a: 'No. Nothing leaves your browser until you agree. After that, the text (and page images, if picture redaction is on, or the speech of a recording) is processed in memory to find personal information, then discarded. It is never logged or used for training.',
    },
    {
      q: 'Which details are found?',
      a: 'Names, addresses, emails, phone numbers, ID and account numbers, card numbers, IBANs, IP addresses and dates. If you turn them on, also faces, screens, road signs and number plates in pictures. Before the download, a second model checks the result for anything left.',
    },
    {
      q: 'Which file types are supported?',
      a: 'PDF, Word (.docx), Excel (.xlsx), OpenDocument spreadsheets (.ods), PNG, JPG, WebP, HEIC, text files such as TXT, CSV, JSON, XML, YAML, .env and logs, and audio such as MP3, M4A and WAV. Video is planned.',
    },
  ],
};
