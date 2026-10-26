// Content for each landing page. Every tool page targets one search intent
// ("redact pdf", "redact image", ...) and links to the others.

export const SITE = {
  name: 'AnyRedact',
  origin: 'https://anyredact.app',
  tagline: 'Free online redaction for PDF, images, Word and text',
};

const privacyFaq = {
  q: 'Are my files uploaded?',
  a: 'No. Files are opened and redacted inside your browser. In the optional AI-assisted mode, only the extracted text is sent to our server for detection; the file itself never leaves your device and nothing is stored.',
};
const freeFaq = {
  q: 'Is AnyRedact really free?',
  a: 'Yes. There is no sign-up, watermark or page limit beyond what your browser can handle.',
};

export const TOOLS = [
  {
    slug: 'redact-pdf',
    format: 'pdf',
    nav: 'PDF',
    title: 'Redact PDF Online Free – Permanently Remove Text | AnyRedact',
    description:
      'Redact PDF files online for free. Automatically find emails, phone numbers, account numbers and names, black them out and download a clean PDF. Private, in-browser.',
    h1: 'Redact PDF online',
    lead: 'Black out sensitive text in any PDF, including scanned pages, and download a flattened copy that cannot be un-redacted.',
    hint: 'PDF up to 60 pages · processed on your device',
    points: [
      ['True redaction', 'Pages are flattened to images on export, so the original text, links, form fields and metadata are gone, not just covered.'],
      ['Scanned PDFs too', 'Pages without a text layer are read with OCR so their contents can be detected.'],
      ['Draw your own boxes', 'Drag over signatures, photos or anything else the detector missed.'],
    ],
    faq: [
      {
        q: 'Is drawing a black box in a PDF editor enough?',
        a: 'Often not. Many editors only place a shape on top, and the text underneath can still be copied or extracted. AnyRedact rebuilds each page as an image, so the hidden text no longer exists in the file.',
      },
      {
        q: 'Will my redacted PDF still be searchable?',
        a: 'No. Because each page is flattened to remove the underlying text, the output is an image-only PDF. This is the safest way to make sure nothing can be recovered.',
      },
      privacyFaq,
      freeFaq,
    ],
  },
  {
    slug: 'redact-image',
    format: 'image',
    nav: 'Image',
    title: 'Redact Image Online Free – Black Out Text in Screenshots & Photos | AnyRedact',
    description:
      'Redact images and screenshots online. AnyRedact reads the text in PNG, JPG and WebP files, finds personal data and blacks it out. Removes EXIF and GPS metadata too.',
    h1: 'Redact images and screenshots',
    lead: 'Hide emails, phone numbers, card numbers and names in screenshots, scans and photos. Text is found automatically with on-device OCR.',
    hint: 'PNG, JPG or WebP · or paste a screenshot with Ctrl+V',
    points: [
      ['Automatic text detection', 'On-device OCR reads the image and highlights sensitive details for you.'],
      ['Solid boxes, not blur', 'Blur and pixelation can sometimes be reversed. AnyRedact paints solid black boxes.'],
      ['Metadata removed', 'The download is re-encoded, which strips EXIF data such as GPS location and camera details.'],
    ],
    faq: [
      {
        q: 'Can I paste a screenshot directly?',
        a: 'Yes. Copy a screenshot and press Ctrl+V (or Cmd+V) on this page.',
      },
      {
        q: 'Why not blur instead of a black box?',
        a: 'Blurred or pixelated text can sometimes be reconstructed. A solid box replaces the pixels completely.',
      },
      privacyFaq,
      freeFaq,
    ],
  },
  {
    slug: 'redact-word',
    format: 'docx',
    nav: 'Word',
    title: 'Redact Word Document Online Free – DOCX Redaction Tool | AnyRedact',
    description:
      'Redact Word documents (DOCX) online for free. Find and remove personal information from text, headers, footers, comments and tracked changes, and strip author metadata.',
    h1: 'Redact Word documents (DOCX)',
    lead: 'Remove personal information from .docx files while keeping the formatting. Headers, footers, footnotes, comments and tracked changes are covered.',
    hint: 'Word .docx files · processed on your device',
    points: [
      ['Formatting kept', 'Only the sensitive characters change. Fonts, tables and layout stay as they were.'],
      ['Hidden places too', 'Tracked changes, comments, headers, footers and hyperlink targets are redacted along with the body.'],
      ['Author names removed', 'Document properties and the names on comments and revisions are cleared.'],
    ],
    faq: [
      {
        q: 'Does it work with old .doc files?',
        a: 'Not yet. Open the file in Word, LibreOffice or Google Docs and save it as .docx first.',
      },
      {
        q: 'Can I replace text with a label instead of black boxes?',
        a: 'Yes. Choose "Replace with label" to turn, for example, an email address into [EMAIL].',
      },
      privacyFaq,
      freeFaq,
    ],
  },
  {
    slug: 'redact-text',
    format: 'text',
    nav: 'Text',
    title: 'Redact Text Online – Remove PII from Text, Logs & CSV | AnyRedact',
    description:
      'Paste text or upload a TXT, CSV, JSON or log file and remove personal data in seconds. Mask emails, phone numbers, IPs, card numbers and more. Free and private.',
    h1: 'Redact text, logs and CSV files',
    lead: 'Paste text or drop a file to mask emails, phone numbers, IP addresses, card numbers and other personal data before you share it.',
    hint: 'TXT, CSV, JSON, Markdown, logs · or paste below',
    points: [
      ['Great for logs and support tickets', 'Strip customer details before sharing logs, transcripts or datasets.'],
      ['Mask or label', 'Keep the shape of the text with █ blocks, or replace values with labels like [EMAIL].'],
      ['Your own terms', 'Add names or project codes that should always be removed.'],
    ],
    faq: [
      {
        q: 'Which kinds of data are detected?',
        a: 'Private mode finds names (from clues such as titles, form labels, greetings and common first names, then every later mention), emails, phone numbers, payment card numbers (Luhn-checked), IBANs (checksum-verified), US Social Security numbers, IP addresses, URLs and dates. AI-assisted mode is better at names without such clues, and adds addresses, organizations and ID numbers.',
      },
      privacyFaq,
      freeFaq,
    ],
  },
];

export const HOME = {
  slug: '',
  format: 'all',
  title: 'AnyRedact – Free Online Redaction Tool for PDF, Images, Word & Text',
  description:
    'Redact PDFs, images, Word documents and text online for free. Automatically find and black out personal information, in your browser, with an optional AI mode.',
  h1: 'Redact anything, right in your browser',
  lead: 'Drop a PDF, image, Word document or text file. AnyRedact finds personal information, lets you review it, and gives you back a clean copy.',
  hint: 'PDF, Word (DOCX), PNG, JPG, WebP or text',
  points: [
    ['Private by default', 'Files are processed on your device. Nothing is uploaded unless you turn on AI-assisted detection, and even then only the text is sent.'],
    ['Real redaction', 'Sensitive content is removed from the file, not just hidden under a box.'],
    ['Review before you download', 'Every detection can be switched off, and you can add your own words or draw boxes.'],
  ],
  faq: [
    privacyFaq,
    {
      q: 'What is the difference between Private and AI-assisted mode?',
      a: 'Private mode uses rules that run in your browser. They are great at structured data like emails, phone numbers and card numbers, and find names that come with clues such as "Name:", "Dr." or "Dear". AI-assisted mode also sends the extracted text to a language model running on Cloudflare, which can recognise names, addresses and other context-dependent details.',
    },
    {
      q: 'Which file types are supported?',
      a: 'PDF, Word (.docx), PNG, JPG, WebP and plain-text formats such as TXT, CSV, JSON and logs. Audio and video are planned.',
    },
    freeFaq,
  ],
};
