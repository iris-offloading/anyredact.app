// Content for each landing page. Every tool page targets one search intent
// ("redact pdf", "redact image", ...) and links to the others.

export const SITE = {
  name: 'AnyRedact',
  origin: 'https://anyredact.app',
  tagline: 'Free online redaction for PDF, images, Word, PowerPoint, Excel, text and audio',
};


export const TOOLS = [
  {
    slug: 'redact-pdf',
    card: 'Contracts, bank statements and scanned forms.',
    format: 'pdf',
    name: 'Redact PDF',
    nav: 'PDF',
    title: 'Auto Redact PDF Online with AI | AnyRedact',
    description:
      'Auto redact PDF files online with AI. Names, addresses and account numbers are marked on every page, scans included, and the download is flattened.',
    h1: 'Auto redact PDF online with AI',
    lead: 'Drop a PDF and our AI will find and permanently remove names, numbers, signatures, and other sensitive details, including on scanned pages.',
    hint: 'PDF up to 60 pages',
    art: 'pdf',
    how: [
      ['Open your PDF', 'Scanned pages are read with OCR first.'],
      ['Review what was found', 'Untick a finding to keep it, or drag a box over a signature.'],
      ['Download the flattened copy', 'Every page comes back as an image with the marks burned in.'],
    ],
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
    card: 'Screenshots, ID photos and pictures of receipts.',
    format: 'image',
    name: 'Redact images',
    nav: 'Image',
    title: 'Auto Redact Images Online with AI | AnyRedact',
    description:
      'Redact JPG, PNG, HEIC, TIFF and SVG images with AI. Text in the picture is read, personal details get black boxes, and EXIF and GPS data are stripped.',
    h1: 'Auto redact images online with AI',
    lead: 'Upload a photo, scan, or screenshot to automatically black out faces, ID numbers, and any text you don’t want shared.',
    also: 'Works with JPG, PNG, WebP, HEIC, AVIF, GIF, BMP, multi-page TIFF and SVG.',
    hint: 'PNG, JPG, WebP, HEIC, AVIF, GIF, BMP, TIFF or SVG',
    art: 'image',
    how: [
      ['Open or paste a picture', 'Words in the picture are read with OCR.'],
      ['Check the boxes', 'Untick a box to keep that spot, or drag a new one over a face.'],
      ['Save the clean image', 'It is repainted from scratch, so camera and GPS tags are gone.'],
    ],
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
      {
        q: 'Can I redact a multi-page TIFF?',
        a: 'Yes. Every page opens in the editor, and the download is one TIFF holding all of them.',
      },
      {
        q: 'What happens to an SVG?',
        a: 'It is flattened to a PNG. Text, links and scripts hidden in the drawing are left out of the download.',
      },
    ],
  },
  {
    slug: 'redact-word',
    card: 'Letters, CVs and reports, review comments included.',
    format: 'docx',
    name: 'Redact Word',
    nav: 'Word',
    title: 'Auto Redact Word Documents Online with AI | AnyRedact',
    description:
      'Remove personal details from Word (DOCX) files with AI, including headers, footers, comments and tracked changes. Author names are cleared.',
    h1: 'Auto redact Word online with AI',
    lead: 'Upload a .docx to redact sensitive text, comments, tracked changes, and metadata while keeping your formatting intact.',
    hint: 'Word .docx files',
    art: 'doc',
    how: [
      ['Open your .docx', 'Body text, headers, comments and tracked changes are scanned.'],
      ['Review what was found', 'Select any word in the preview to remove it as well.'],
      ['Download the edited file', 'Pick black bars or labels like [NAME] before you save.'],
    ],
    points: [
      ['Formatting kept', 'Only the sensitive characters change. Fonts, tables and layout stay as they were.'],
      ['Hidden places too', 'Tracked changes, comments, headers, footers, hyperlink targets, charts, pictures and their alt text are redacted along with the body.'],
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
    slug: 'redact-powerpoint',
    card: 'Client decks and training slides, notes and all.',
    format: 'pptx',
    name: 'Redact PowerPoint',
    nav: 'PowerPoint',
    title: 'Auto Redact PowerPoint Online with AI | AnyRedact',
    description:
      'Redact PowerPoint (PPTX) decks with AI: slides, speaker notes, comments and pictures. The file keeps its layout and loses its author names.',
    h1: 'Auto redact PowerPoint online with AI',
    lead: 'Upload a .pptx to redact names, numbers and other personal details on slides, in speaker notes, comments and pictures.',
    hint: 'PowerPoint .pptx files',
    art: 'slide',
    how: [
      ['Open your .pptx', 'Slides, speaker notes and comments are scanned together.'],
      ['Review what was found', 'Step through the slides and untick what should stay.'],
      ['Download the deck', 'It opens in PowerPoint, Keynote or Google Slides as before.'],
    ],
    points: [
      ['Design kept', 'Themes, fonts, shapes and animations are untouched.'],
      ['Notes and comments too', 'Speaker notes, comments, hidden slides, tables, charts, SmartArt and alt text are redacted along with the slides.'],
      ['Pictures checked', 'Text in photos and scans is read and boxed out, and the first-slide thumbnail is removed.'],
    ],
    faq: [
      {
        q: 'Does it work with old .ppt files?',
        a: 'Not yet. Save it as .pptx in PowerPoint, Keynote, LibreOffice or Google Slides first.',
      },
      {
        q: 'What happens to charts and embedded files?',
        a: 'Chart titles and labels are redacted like any other text. The spreadsheet behind each chart and any embedded files are removed, so charts still show but their data can no longer be edited.',
      },
    ],
  },
  {
    slug: 'redact-excel',
    card: 'Customer lists, payroll sheets and data exports.',
    format: 'sheet',
    name: 'Redact Excel',
    nav: 'Excel',
    title: 'Auto Redact Excel Online with AI | AnyRedact',
    description:
      'Redact Excel (XLSX) and ODS workbooks with AI. Names, emails and account numbers are found on every sheet, hidden sheets included.',
    h1: 'Auto redact Excel online with AI',
    lead: 'Upload a spreadsheet to redact personal data in columns, cells, hidden sheets, and comments without breaking your layout.',
    also: 'Works with ODS and CSV.',
    hint: 'Excel .xlsx, OpenDocument .ods or CSV',
    art: 'sheet',
    how: [
      ['Open your workbook', 'Every sheet is read, cell by cell.'],
      ['Review the cells', 'Click a highlight to keep that value.'],
      ['Download the workbook', 'Open it in Excel and carry on working.'],
    ],
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
    card: 'Logs, chat exports, config files and support tickets.',
    format: 'text',
    name: 'Redact text',
    nav: 'Text',
    title: 'Auto Redact Text, CSV and JSON with AI | AnyRedact',
    description:
      'Paste text or upload CSV, JSON, XML, YAML, .env or log files to mask emails, phone numbers, IP addresses and card numbers with AI.',
    h1: 'Auto redact text online with AI',
    lead: 'Paste text or upload a file to mask personal info, passwords, API keys, and other secrets in seconds.',
    also: 'Works with CSV, JSON, XML, HTML, Markdown, YAML, .env, logs, SRT and VTT subtitles, and source code.',
    hint: 'TXT, CSV, JSON, XML, HTML, Markdown, subtitles, logs or code',
    art: 'text',
    how: [
      ['Paste or upload', 'Drop in a log, a config file or a chat export.'],
      ['Review what was found', 'List project code names under Always redact.'],
      ['Download the masked file', 'Keys, brackets and line breaks stay where they were.'],
    ],
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
      {
        q: 'Do redacted subtitles still play?',
        a: 'Yes. Cue numbers and timings in SRT and VTT files are never touched.',
      },
    ],
  },
  {
    slug: 'redact-audio',
    card: 'Calls, interviews and voice notes.',
    format: 'audio',
    name: 'Redact audio',
    nav: 'Audio',
    title: 'Auto Redact Audio Online with AI | AnyRedact',
    description:
      'Redact MP3, M4A, WAV and other recordings with AI. Speech is transcribed, and names, phone and card numbers are bleeped in a new file.',
    h1: 'Auto redact audio online with AI',
    lead: 'Upload a recording and we’ll bleep spoken sensitive details, then give you the redacted audio and a redacted transcript.',
    also: 'Works with MP3, M4A, WAV, FLAC, OGG and Opus.',
    hint: 'MP3, M4A, WAV, FLAC, OGG or Opus, up to 2 hours',
    art: 'audio',
    how: [
      ['Upload a recording', 'Speech is written out next to a timeline.'],
      ['Review what was found', 'Listen back and untick anything that can stay.'],
      ['Download the bleeped audio', 'Save the redacted transcript too if you need it.'],
    ],
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
  title: 'AnyRedact: Free Online Auto Redaction Tool with AI',
  description:
    'Auto redact PDFs, images, Word, PowerPoint, Excel, text and audio for free. AI finds the personal information, you review it, and nothing is stored.',
  h1: 'Redact anything, with AI that finds it for you',
  lead: 'Upload PDFs, images, Word, PowerPoint, Excel, text, or audio files, and our AI will find and redact sensitive information in all of them.',
  hint: 'PDF, Word (DOCX), PowerPoint (PPTX), Excel (XLSX), ODS, images, text or audio',
  points: [
    ['Real redaction', 'Sensitive content is removed from the file, not just hidden under a box.'],
    ['Review before you download', 'Every detection can be switched off, and you can add your own words or draw boxes.'],
    ['Hidden data removed too', 'Author names, document properties, photo locations and audio tags are left out of the download.'],
  ],
  steps: [
    ['Open your file', 'Choose it, drop it on the box or paste a screenshot. It opens in an editor beside a list of findings.'],
    ['Check the findings', 'Untick anything to keep. Select text or drag a box to add more, or list words to always remove.'],
    ['Download the copy', 'Pick black bars or labels. A second AI pass reads the result for anything left before you save it.'],
  ],
  finds: [
    ['Names', 'People named in the text, signatures and email threads'],
    ['Addresses', 'Home, postal and email addresses'],
    ['Phone numbers', 'Mobile, landline and international formats'],
    ['ID numbers', 'Social Security, passport, licence and tax numbers'],
    ['Bank details', 'Card numbers, IBANs and account numbers'],
    ['Online identifiers', 'IP addresses, links with tokens, API keys'],
    ['Dates', 'Birth dates and other dates tied to a person'],
    ['In pictures', 'Faces, screens, road signs and number plates, when turned on'],
  ],
  faq: [
    {
      q: 'Is AnyRedact free?',
      a: 'Yes. You get 10 credits a day. One credit covers one page of text or one picture, and a minute of audio takes 3. For more, buy a monthly plan or credits that never expire. There is no watermark.',
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
      q: 'Can redacted text be recovered?',
      a: 'Not from the download. PDF pages are rebuilt as images, Office and text files get new characters in place of the old ones, pictures are repainted and audio is overwritten. Keep your original if you need it later.',
    },
    {
      q: 'Does it work on a phone?',
      a: 'Yes, in any modern mobile browser. The editor switches between Preview and Found tabs to fit the screen.',
    },
  ],
};
