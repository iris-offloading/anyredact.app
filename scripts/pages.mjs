// Content for each landing page. Every tool page targets one search intent
// ("redact pdf", "redact image", ...) and links to the others.

export const SITE = {
  name: 'AnyRedact',
  origin: 'https://anyredact.app',
  tagline: 'Free online redaction for PDF, images, Word and text',
};

const privacyFaq = {
  q: 'Do you store my files?',
  a: 'No. Your content is sent to our AI model only to find personal information, is processed in memory and is never stored, logged or used for training. There are no accounts, and nothing is kept after the request finishes.',
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
      'Redact PDF files online for free. Automatically find emails, phone numbers, account numbers and names, black them out and download a clean PDF. Free, no sign-up, nothing stored.',
    h1: 'Redact PDF online',
    lead: 'Black out sensitive text in any PDF, including scanned pages, and download a flattened copy that cannot be un-redacted.',
    hint: 'PDF up to 60 pages · nothing is stored',
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
    lead: 'Hide emails, phone numbers, card numbers and names in screenshots, scans and photos. Text is read automatically and checked by AI.',
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
    hint: 'Word .docx files · nothing is stored',
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
        a: 'Names, street addresses, emails, phone numbers, ID and account numbers, payment card numbers (Luhn-checked), IBANs (checksum-verified), US Social Security numbers, IP addresses and other personal details. An AI model finds context-dependent items like names and addresses, and checksum rules catch structured numbers.',
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
    'Redact PDFs, images, Word documents and text online for free. AI finds the personal information, you review it, and nothing is stored.',
  h1: 'Redact anything, with AI that finds it for you',
  lead: 'Drop a PDF, image, Word document or text file. AnyRedact finds personal information, lets you review it, and gives you back a clean copy.',
  hint: 'PDF, Word (DOCX), PNG, JPG, WebP or text',
  points: [
    ['Nothing is stored', 'Your content is processed only to find personal information and is never stored, logged or used for training. No accounts needed.'],
    ['Real redaction', 'Sensitive content is removed from the file, not just hidden under a box.'],
    ['Review before you download', 'Every detection can be switched off, and you can add your own words or draw boxes.'],
  ],
  faq: [
    privacyFaq,
    {
      q: 'How does detection work?',
      a: 'The text in your file is checked by a language model running on Cloudflare Workers AI, which recognises names, addresses and other context-dependent details. Checksum-verified rules for card numbers, IBANs and similar run alongside it. You review every finding, and before the download a second model checks the redacted result for anything that was missed.',
    },
    {
      q: 'Which file types are supported?',
      a: 'PDF, Word (.docx), PNG, JPG, WebP and plain-text formats such as TXT, CSV, JSON and logs. Audio and video are planned.',
    },
    freeFaq,
  ],
};
