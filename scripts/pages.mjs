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
    nav: 'PDF',
    title: 'Redact PDF Online Free: Permanently Remove Text | AnyRedact',
    description:
      'Redact PDF files online for free. Automatically find emails, phone numbers, account numbers and names, black them out and download a clean PDF. Free to start.',
    h1: 'Redact PDF online',
    lead: 'Black out sensitive text in any PDF, including scanned pages, and download a flattened copy that cannot be un-redacted.',
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
    nav: 'Image',
    title: 'Redact Image Online Free: Black Out Text in Screenshots & Photos | AnyRedact',
    description:
      'Redact images and screenshots online. AnyRedact reads the text in PNG, JPG and WebP files, finds personal data and blacks it out. Removes EXIF and GPS metadata too.',
    h1: 'Redact images and screenshots',
    lead: 'Hide emails, phone numbers, card numbers and names in screenshots, scans and photos. Text is read automatically and checked by AI.',
    hint: 'PNG, JPG or WebP, or paste a screenshot',
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
    ],
  },
  {
    slug: 'redact-word',
    format: 'docx',
    nav: 'Word',
    title: 'Redact Word Document Online Free: DOCX Redaction Tool | AnyRedact',
    description:
      'Redact Word documents (DOCX) online for free. Find and remove personal information from text, headers, footers, comments and tracked changes, and strip author metadata.',
    h1: 'Redact Word documents (DOCX)',
    lead: 'Remove personal information from .docx files while keeping the formatting. Headers, footers, footnotes, comments and tracked changes are covered.',
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
    nav: 'Excel',
    title: 'Redact Excel Spreadsheet Online Free: XLSX, ODS & CSV | AnyRedact',
    description:
      'Redact Excel (XLSX), OpenDocument (ODS) and CSV spreadsheets online for free. Find names, emails, phone and account numbers in every sheet and remove them while the formatting stays.',
    h1: 'Redact Excel and other spreadsheets',
    lead: 'Remove personal data from XLSX, ODS and CSV files, across every sheet, comment and header.',
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
    nav: 'Text',
    title: 'Redact Text Online: Remove PII from Text, Logs & CSV | AnyRedact',
    description:
      'Paste text or upload a TXT, CSV, JSON or log file and remove personal data in seconds. Mask emails, phone numbers, IPs, card numbers and more. Free and private.',
    h1: 'Redact text, logs and CSV files',
    lead: 'Paste text or drop a file to mask emails, phone numbers, IP addresses, card numbers and other personal data before you share it.',
    hint: 'TXT, CSV, JSON, Markdown or logs',
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
    ],
  },
  {
    slug: 'redact-audio',
    format: 'audio',
    nav: 'Audio',
    title: 'Redact Audio Online Free: Bleep Names and Numbers | AnyRedact',
    description:
      'Redact audio recordings online for free. AI writes out the speech, finds names, phone numbers and card numbers, and bleeps them in a new MP3, M4A or WAV file.',
    h1: 'Redact audio online',
    lead: 'Bleep names, numbers and addresses in calls, interviews and voice notes, then download a new file.',
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
  lead: 'Drop a PDF, image, Word document, spreadsheet, text file or recording. AnyRedact finds personal information, lets you review it, and gives you back a clean copy.',
  hint: 'PDF, Word (DOCX), Excel (XLSX), ODS, PNG, JPG, WebP, text or audio',
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
      a: 'PDF, Word (.docx), Excel (.xlsx), OpenDocument spreadsheets (.ods), PNG, JPG, WebP, text files such as TXT, CSV, JSON and logs, and audio such as MP3, M4A and WAV. Video is planned.',
    },
  ],
};
