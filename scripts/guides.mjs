// Guides under /guides. Bodies are HTML, rendered by scripts/build.mjs into the
// prose layout. Keep the steps in line with what the editor does, and give
// every guide its own wording: the site never repeats a phrase.
import { pdfLayersDiagram, photoMetadataDiagram, redactionKindsDiagram, sarTimelineDiagram } from './diagrams.mjs';

export const GUIDES_INDEX = {
  slug: 'guides',
  title: 'Redaction Guides and How-Tos | AnyRedact',
  description: 'Guides to redacting PDFs, Word files, images, spreadsheets, slides, audio and logs, plus what to remove and why cover-up boxes fail.',
  h1: 'Redaction guides',
  lead: 'Step-by-step help for each file type, and the background on doing redaction properly.',
};

export const PUBLISHED = '2026-10-27';

export const GUIDES = [
  {
    slug: 'what-is-redaction',
    title: 'What Is Redaction? Meaning and Examples | AnyRedact',
    description: 'Redaction removes sensitive details from a document before it is shared. The methods that hold up, the ones that leak, and when you need it.',
    h1: 'What is redaction?',
    summary: 'The meaning of the word, the methods that leak, and the situations that call for it.',
    body: `
<p>Redaction is the removal of sensitive details from a document, picture or recording before someone else sees it. The rest of the content stays readable, so the reader still gets what they need, minus the parts they have no right to.</p>
<p>The word comes from legal and government work, where court filings and released records have names, account numbers and other private details blacked out. Today it applies to any file: a screenshot sent to a support team, a spreadsheet handed to a contractor, a call recording used for training.</p>

<h2>Redaction, deletion and anonymisation</h2>
${redactionKindsDiagram()}
<ul>
<li><strong>Deletion</strong> gets rid of a whole file or record.</li>
<li><strong>Redaction</strong> keeps the file and removes selected parts of it, usually leaving a visible mark (a black bar, a label such as [NAME], or a beep) so the reader knows something was taken out.</li>
<li><strong>Anonymisation</strong> goes further: a dataset is changed until nobody in it can be identified, even by combining fields. Redacting names alone often falls short of that.</li>
</ul>

<h2>Methods that leave the data behind</h2>
<p>Most failed redactions look fine on screen. The sensitive text is still in the file, just out of sight:</p>
<ul>
<li><strong>Black highlighter or a shape on top.</strong> The words underneath can be selected, copied or found with search. See <a href="/guides/pdf-black-box-mistakes">why black boxes in PDFs fail</a>.</li>
<li><strong>White or tiny text.</strong> Changing the colour or size hides nothing from a copy and paste.</li>
<li><strong>Blur and pixelation.</strong> Short strings such as numbers can sometimes be rebuilt by trying every candidate and comparing the blurred result.</li>
<li><strong>Cropping.</strong> Some apps keep the cropped area inside the file, so it can be restored.</li>
<li><strong>Forgetting the hidden parts.</strong> Comments, tracked changes, speaker notes, hidden sheets, document properties and photo location data travel with the file.</li>
</ul>

<h2>What a proper redaction does</h2>
<ol>
<li>Replaces the sensitive characters, pixels or sound in the file itself, not in a layer above them.</li>
<li>Covers every copy: headers, footers, alt text, chart labels, cached values and earlier versions.</li>
<li>Strips metadata such as author names, GPS coordinates and editing history.</li>
<li>Is checked afterwards, by searching the output for the removed terms.</li>
</ol>

<h2>When people redact</h2>
<ul>
<li>Answering a <a href="/guides/gdpr-subject-access-request-redaction">data subject access request</a> or a freedom of information request.</li>
<li>Filing court documents or sharing evidence.</li>
<li>Sending bank statements, payslips or ID to a landlord or lender, with the irrelevant parts removed.</li>
<li>Posting screenshots, bug reports or logs in public places.</li>
<li>Giving datasets or recordings to vendors, researchers or AI tools.</li>
</ul>
<p>The <a href="/guides/personal-information-checklist">personal information checklist</a> lists what to look for in each case.</p>
`,
  },
  {
    slug: 'pdf-black-box-mistakes',
    title: 'Why Black Boxes in PDFs Fail | AnyRedact',
    description: 'A rectangle drawn over PDF text leaves the words in the file. Where hidden text survives and a two-minute test for any redacted PDF.',
    h1: 'Why black boxes in PDFs fail',
    tools: ['redact-pdf'],
    summary: 'Text under a drawn rectangle can still be copied. Where it hides and how to test a file.',
    body: `
<p>A PDF stores its text and its drawings separately. A black rectangle added with a comment or drawing tool is one more object on the page, painted after the text. Readers see a bar. Anything that reads the text layer (copy and paste, search, screen readers, text extraction tools) still gets the original words.</p>
${pdfLayersDiagram()}

<h2>Where hidden text survives</h2>
<ul>
<li><strong>Under annotations.</strong> Rectangles, highlights and stamps can be moved or deleted by anyone who opens the file.</li>
<li><strong>In the OCR layer of a scan.</strong> A scanned page often has invisible text behind the image so it can be searched. Covering the picture leaves that text alone.</li>
<li><strong>In form fields.</strong> A filled field keeps its value even when a box is drawn over it.</li>
<li><strong>In earlier versions.</strong> PDFs can be saved incrementally, appending changes to the end of the file, so an older copy of the page may still be inside.</li>
<li><strong>In bookmarks, link targets, attachments and properties.</strong> None of these appear on the page, and all of them can hold names or addresses.</li>
</ul>

<h2>Test a redacted PDF in two minutes</h2>
<ol>
<li>Open it in a browser or PDF reader, press Ctrl+A (Cmd+A on a Mac) and paste into a plain text editor. Anything readable there is still in the file.</li>
<li>Search the PDF for a word you removed, such as a surname.</li>
<li>Open the document properties and look at the author, title and keywords.</li>
<li>Check the attachments or bookmarks panel if your reader has one.</li>
</ol>

<h2>Redacting so it holds</h2>
<p>A dedicated redaction tool removes the content under the mark instead of adding a layer. AnyRedact goes one step further and rebuilds each page as an image on download, which drops the text layer, form fields, links, attachments and metadata in one go. <a href="/guides/how-to-redact-a-pdf">How to redact a PDF</a> walks through it.</p>
`,
  },
  {
    slug: 'how-to-redact-a-pdf',
    title: 'How to Redact a PDF for Free | AnyRedact',
    description: 'Redact a PDF online in three steps: let AI mark names and numbers, review the list, and download a flattened copy with nothing left underneath.',
    h1: 'How to redact a PDF',
    tools: ['redact-pdf'],
    summary: 'From upload to a flattened download, scanned pages included.',
    body: `
<p>These steps use the free <a href="/redact-pdf">PDF redaction tool</a>. They work the same for typed PDFs, scans and exported forms, up to 60 pages per file.</p>

<h2>Steps</h2>
<ol>
<li><strong>Open the PDF.</strong> Choose it or drag it onto the upload box. Pages appear in the preview, and scanned pages are read with OCR in your browser.</li>
<li><strong>Agree to the scan.</strong> The text is sent for AI detection only after you confirm. Decline and you can still mark everything by hand.</li>
<li><strong>Go through the Found list.</strong> Each finding is highlighted on its page. Untick anything that should stay, such as your own company name.</li>
<li><strong>Add what was missed.</strong> Select text and pick "Redact here" for one spot or "Redact everywhere" for every occurrence. Drag on the page to box out a signature, stamp or photo.</li>
<li><strong>Download.</strong> Leave "Check for anything left" ticked to have a second model read the result, then save the redacted copy.</li>
</ol>

<h2>What the download contains</h2>
<p>Every page is rendered to an image with solid black bars burned in. Text, form fields, links, bookmarks, attachments and document properties are left out, so there is nothing to copy back out.</p>
<p>The trade-off is that the copy cannot be searched or edited as text. If the recipient needs searchable text, run OCR on the redacted copy afterwards: it can only read what is visible.</p>

<h2>Tips</h2>
<ul>
<li>Scans with handwriting or low contrast are harder for OCR. Zoom in and draw boxes over anything the list did not pick up.</li>
<li>Add recurring names or case numbers under "Always redact" so they are caught on every page.</li>
<li>Split files over 60 pages and redact each part.</li>
<li>Company and public service contacts are found but start unticked. Tick "Redact company and public contacts" to remove them too.</li>
</ul>
`,
  },
  {
    slug: 'how-to-redact-a-word-document',
    title: 'How to Redact a Word Document (DOCX) | AnyRedact',
    description: 'Redact a .docx without losing its formatting. Covers comments, tracked changes, headers, pictures and author names that Word keeps.',
    h1: 'How to redact a Word document',
    tools: ['redact-word'],
    summary: 'Keep the formatting while clearing comments, tracked changes and author names.',
    body: `
<p>Word has no built-in redaction. Find and Replace changes the body text but misses pictures and leaves the old wording in tracked changes, and Inspect Document removes comments without touching the text. The <a href="/redact-word">Word redaction tool</a> handles both in one pass.</p>

<h2>Steps</h2>
<ol>
<li><strong>Open the .docx.</strong> Pages render in the preview much as Word shows them. Old .doc files need saving as .docx first.</li>
<li><strong>Allow the scan</strong> and wait for the Found list to fill in.</li>
<li><strong>Review.</strong> Click any highlight to switch it off or on. Text that is not on the page, such as comments and alt text, is listed under "Also in this file".</li>
<li><strong>Pick a style.</strong> "Black out" swaps each character for a block. "Replace with label" writes [NAME], [EMAIL] and so on, which keeps sentences readable.</li>
<li><strong>Download</strong> the redacted .docx.</li>
</ol>

<h2>Places Word hides text</h2>
<ul>
<li>Headers, footers, footnotes and text boxes.</li>
<li>Comments and the names of their authors.</li>
<li>Tracked insertions and deletions, including text that was deleted but not accepted.</li>
<li>Hyperlink addresses, which can contain email addresses or account IDs.</li>
<li>Charts, and the spreadsheet stored behind each one.</li>
<li>Pictures, including scanned signatures, and their alt text.</li>
<li>Document properties: author, last modified by, company and template path.</li>
</ul>
<p>All of these are scanned. Embedded files and chart data are removed, and the thumbnail Word saves of the first page is dropped.</p>

<h2>Before sending</h2>
<p>Open the download in Word, turn on All Markup under Review, and search for a couple of the removed names. Then check File, Info, Properties.</p>
`,
  },
  {
    slug: 'how-to-redact-a-screenshot',
    title: 'How to Redact a Screenshot or Photo | AnyRedact',
    description: 'Black out text, faces and number plates in a screenshot or photo, and strip its location data. Works with PNG, JPG, WebP and iPhone HEIC.',
    h1: 'How to redact a screenshot or photo',
    tools: ['redact-image'],
    summary: 'Solid boxes over text, faces and plates, with location data stripped.',
    body: `
<p>Screenshots leak more than people expect: browser tabs, notification previews, email addresses in a sidebar, the last digits of a card. Photos add faces, house numbers and GPS coordinates. The <a href="/redact-image">image redaction tool</a> deals with all of it.</p>

<h2>Steps</h2>
<ol>
<li><strong>Paste or upload.</strong> Copy the screenshot and press Ctrl+V (Cmd+V on a Mac) on the page, or choose a PNG, JPG, WebP or HEIC file.</li>
<li><strong>Let OCR read it.</strong> Text in the picture is read in your browser and then checked by AI once you agree.</li>
<li><strong>Turn on picture redaction if needed.</strong> Under "In pictures", pick faces, screens, road signs or number plates.</li>
<li><strong>Fix the boxes.</strong> Untick anything to keep, and drag on the image to cover avatars, QR codes or anything else.</li>
<li><strong>Download.</strong> HEIC photos come back as JPG.</li>
</ol>

<h2>Boxes, not blur</h2>
<p>Blur and pixelation keep a trace of the original. For short values like phone numbers or PINs, that trace can be enough to guess the text. A solid box replaces the pixels, so there is nothing to work back from.</p>

<h2>Metadata</h2>
<p>Photos carry EXIF data: where and when they were taken, the camera or phone model and sometimes its serial number. The editor lists what it found, and the download is re-encoded without any of it. More in <a href="/guides/remove-photo-metadata">removing location and camera data from photos</a>.</p>

<h2>Easy to miss</h2>
<ul>
<li>Reflections in windows, glasses and screens.</li>
<li>Name badges, parcel labels and post on a desk.</li>
<li>URLs with session tokens or account IDs in the address bar.</li>
<li>Profile pictures and user names in chat screenshots.</li>
</ul>
`,
  },
  {
    slug: 'how-to-redact-an-excel-spreadsheet',
    title: 'How to Redact an Excel Spreadsheet | AnyRedact',
    description: 'Redact names, emails and account numbers in XLSX and ODS files while keeping styles and formulas. Hidden sheets, comments and caches included.',
    h1: 'How to redact an Excel spreadsheet',
    tools: ['redact-excel'],
    summary: 'Clear personal data from workbooks without breaking styles, formulas or charts.',
    body: `
<p>Deleting a column in Excel is quick, but workbooks keep copies of values in places that are easy to overlook. The <a href="/redact-excel">spreadsheet redaction tool</a> edits the workbook in place, so the layout survives and those copies are cleaned too.</p>

<h2>Steps</h2>
<ol>
<li><strong>Open the .xlsx or .ods file.</strong> The workbook appears in a read-only grid with its sheet tabs.</li>
<li><strong>Allow the scan.</strong> Findings are highlighted in their cells, and several can sit in one cell.</li>
<li><strong>Review cell by cell.</strong> Click a highlight to keep or redact it. The cell bar above the grid shows the full text of the selected cell.</li>
<li><strong>Add what the scan missed</strong> by typing it under "Always redact", or select text in the cell bar.</li>
<li><strong>Download</strong> the workbook in its original format.</li>
</ol>

<h2>Copies that survive a delete</h2>
<ul>
<li><strong>Hidden and very hidden sheets.</strong> They are scanned and listed in the editor.</li>
<li><strong>Formulas.</strong> A formula can rebuild a value from another cell. A redacted formula cell becomes plain text.</li>
<li><strong>Chart and pivot caches.</strong> Charts and pivot tables store their own copy of the source data, which is updated to match.</li>
<li><strong>Comments, notes, headers and footers.</strong> All scanned.</li>
<li><strong>Properties.</strong> Author, company, comment authors and the folder the file was saved in are left out.</li>
</ul>

<h2>CSV files</h2>
<p>A CSV has no styles or sheets, so it opens in the <a href="/redact-text">text tool</a>, which keeps every comma and line in place.</p>

<h2>Sharing a dataset</h2>
<p>Removing names does not always make a dataset anonymous. A postcode, birth date and job title together can point to one person. The <a href="/guides/personal-information-checklist">personal information checklist</a> covers these indirect identifiers.</p>
`,
  },
  {
    slug: 'how-to-redact-a-powerpoint',
    title: 'How to Redact a PowerPoint Presentation | AnyRedact',
    description: 'Redact a .pptx deck with its design intact: slide text, speaker notes, comments, charts and pictures. Old .ppt files need converting first.',
    h1: 'How to redact a PowerPoint presentation',
    tools: ['redact-powerpoint'],
    summary: 'Slides, notes and charts cleaned before a deck leaves the team.',
    body: `
<p>Decks get forwarded far beyond the room they were made for, often with client names in the notes and real figures behind the charts. The <a href="/redact-powerpoint">PowerPoint redaction tool</a> changes only the sensitive text and leaves the design alone.</p>

<h2>Steps</h2>
<ol>
<li><strong>Open the .pptx.</strong> Slides render in the preview. Save .ppt or Keynote files as .pptx first.</li>
<li><strong>Allow the scan.</strong> Slide text, notes and comments go to AI detection together.</li>
<li><strong>Review the findings.</strong> Off-slide text, such as speaker notes, is listed below the slides.</li>
<li><strong>Choose black blocks or labels</strong>, then download.</li>
</ol>

<h2>What gets checked</h2>
<ul>
<li>Text on every slide, hidden slides included, with tables and SmartArt.</li>
<li>Speaker notes and comments.</li>
<li>Chart titles and labels. The workbook stored behind each chart is removed, so the chart still shows but its data cannot be opened.</li>
<li>Pictures, which are read with OCR and boxed where needed.</li>
<li>Alt text, author names and the preview thumbnail of the first slide.</li>
</ul>

<h2>Before presenting</h2>
<p>Open the download, switch to the Notes view and step through a few slides. Then check File, Info for remaining properties.</p>
`,
  },
  {
    slug: 'how-to-redact-audio',
    title: 'How to Redact an Audio Recording | AnyRedact',
    description: 'Bleep names, card numbers and addresses in calls, interviews and voice notes. Transcribe, review the words, then save new audio and a transcript.',
    h1: 'How to redact an audio recording',
    tools: ['redact-audio'],
    summary: 'Bleep spoken details in calls and interviews, with a matching transcript.',
    body: `
<p>Call recordings and interviews are full of details said out loud: card numbers read to an agent, a home address, a date of birth for security checks. The <a href="/redact-audio">audio redaction tool</a> finds them in a transcript and covers them in the sound.</p>

<h2>Steps</h2>
<ol>
<li><strong>Open the recording.</strong> MP3, M4A, WAV, FLAC, OGG and Opus files up to 2 hours work.</li>
<li><strong>Agree to transcription.</strong> The speech is written out with a time for every word, and each paragraph shows when it starts.</li>
<li><strong>Review the transcript.</strong> Click a highlighted word to keep or bleep it, and press a paragraph's time to hear it.</li>
<li><strong>Mark anything missed.</strong> Select words in the transcript, or drag across the timeline for a stretch with no clear words.</li>
<li><strong>Pick Beep or Silence</strong> under Style and download. "Download redacted transcript" saves the text with the same parts masked.</li>
</ol>

<h2>Tips for calls</h2>
<ul>
<li>Card numbers are often read in groups with pauses. Listen to the section around each one and widen the mark on the timeline if a digit falls outside.</li>
<li>Spelled-out names ("S, M, I, T, H") may not be joined into one word. Look for runs of single letters in the transcript.</li>
<li>Listen to the first and last minute too: greetings and sign-offs often include full names.</li>
</ul>

<h2>File tags</h2>
<p>Audio files can hold a title, artist, comments, cover art and recording location. None of these are written to the new file.</p>
`,
  },
  {
    slug: 'how-to-redact-logs-and-json',
    title: 'How to Redact Logs and JSON Before Sharing | AnyRedact',
    description: 'Mask emails, IPs, API keys and tokens in log, JSON, YAML and .env files before posting them in a bug report, while keeping them valid.',
    h1: 'How to redact logs and JSON before sharing',
    tools: ['redact-text'],
    summary: 'Mask keys, tokens and customer data in logs, configs and payloads.',
    body: `
<p>Bug reports, support tickets and forum posts often need a log or a config. Those files tend to hold customer emails, IP addresses, session cookies and live API keys. The <a href="/redact-text">text redaction tool</a> masks them and keeps the file usable.</p>

<h2>Steps</h2>
<ol>
<li><strong>Paste the text</strong> or open a .log, .txt, .csv, .json, .jsonl, .xml, .yaml, .toml, .ini or .env file.</li>
<li><strong>Allow the scan</strong> to find emails, phone numbers, IPs, card numbers, keys and tokens.</li>
<li><strong>Add your own terms</strong> under "Always redact": internal host names, customer IDs, project code names.</li>
<li><strong>Pick a style.</strong> "Black out" keeps each line the same length, which helps with aligned columns. "Replace with label" makes the result easier to read.</li>
<li><strong>Download</strong> the result.</li>
</ol>

<h2>Valid output</h2>
<p>JSON and XML stay parseable: quotes, brackets and tags are untouched, and a redacted JSON number turns into a string. YAML and .env files keep their keys, so a reader can still see which setting held the secret.</p>

<h2>What to look for</h2>
<ul>
<li>Authorization headers, bearer tokens, cookies and signed URLs.</li>
<li>Connection strings with a password inside.</li>
<li>Email addresses and user IDs in request paths.</li>
<li>Client IP addresses and device identifiers.</li>
<li>Stack traces with home directory paths that include a user name.</li>
</ul>

<h2>Rotate leaked secrets</h2>
<p>If a key or password was already posted somewhere, redacting the copy you share next does not undo the leak. Revoke the key and issue a new one.</p>
`,
  },
  {
    slug: 'remove-photo-metadata',
    title: 'Remove Location and EXIF Data from Photos | AnyRedact',
    description: 'Photos record where they were taken and on which device. See that EXIF and GPS data on any computer or phone, and save a copy without it.',
    h1: 'Remove location and camera data from photos',
    tools: ['redact-image'],
    summary: 'See the EXIF and GPS data a photo carries and save a copy without it.',
    body: `
<p>Most phone cameras write EXIF metadata into each photo: the time, the GPS position, the device model and settings, and sometimes the owner's name or the camera's serial number. Some sites strip it on upload, but email, messaging apps that send files and cloud links usually keep it.</p>

<h2>See what a photo contains</h2>
<ul>
<li><strong>Windows:</strong> right-click the file, choose Properties, then the Details tab.</li>
<li><strong>Mac:</strong> open it in Preview and choose Tools, Show Inspector, then the info tab.</li>
<li><strong>iPhone:</strong> open the photo in Photos and swipe up to see the place and device.</li>
<li><strong>Android:</strong> in Google Photos, open the photo and swipe up for details.</li>
<li><strong>Any device:</strong> open it in the <a href="/redact-image">image tool</a>, which lists EXIF, GPS, XMP and IPTC fields beside the picture.</li>
</ul>

<h2>Save a copy without it</h2>
${photoMetadataDiagram()}
<ul>
<li><strong>AnyRedact:</strong> open the photo and download it. The file is re-encoded from the pixels, so no metadata is carried over. Redacting text or faces is optional.</li>
<li><strong>Windows:</strong> in Properties, Details, use "Remove Properties and Personal Information" and choose to create a copy.</li>
<li><strong>iPhone:</strong> in the share sheet, tap Options and turn off Location before sending.</li>
</ul>

<h2>Location without metadata</h2>
<p>Stripping EXIF does not hide what is in the frame. Street signs, house numbers, number plates, school logos and views from a window can place a photo just as well. Turn on picture redaction for road signs and number plates, and box out the rest by hand.</p>
`,
  },
  {
    slug: 'personal-information-checklist',
    title: 'What Personal Information to Redact: Checklist | AnyRedact',
    description: 'A checklist of personal information to redact: direct identifiers, details that identify people in combination, special category data and common misses.',
    h1: 'What personal information to redact',
    summary: 'Direct identifiers, risky combinations and the details people forget.',
    body: `
<p>Personal information, or PII, is anything that identifies a person on its own or together with other details. What to remove depends on who will read the file, but this list covers the usual suspects.</p>

<h2>Direct identifiers</h2>
<ul>
<li>Full names, user names and signatures.</li>
<li>Home and postal addresses.</li>
<li>Email addresses and phone numbers.</li>
<li>Government numbers: Social Security, National Insurance, passport, driving licence, tax IDs.</li>
<li>Financial details: card numbers, IBANs, account numbers and sort codes.</li>
<li>Customer, patient, employee and case numbers.</li>
<li>Photos of faces, and voice recordings.</li>
</ul>

<h2>Details that identify in combination</h2>
<p>None of these name anyone, yet together they often point to one person:</p>
<ul>
<li>Date of birth, age or graduation year.</li>
<li>Postcode or ZIP code, town and workplace.</li>
<li>Job title, especially a unique one.</li>
<li>Rare events, conditions or family situations.</li>
<li>IP addresses, device IDs, cookies and vehicle number plates.</li>
</ul>

<h2>Special category data</h2>
<p>Health, ethnicity, religion, sexual orientation, political views, trade union membership, biometrics and criminal records get extra protection under GDPR and similar laws. Remove them unless the reader has a clear reason to see them.</p>

<h2>Often missed</h2>
<ul>
<li>Email headers and signatures quoted at the bottom of a thread.</li>
<li>File names, such as "Smith_J_payslip.pdf".</li>
<li>Comments, tracked changes and speaker notes.</li>
<li>Document properties and photo metadata.</li>
<li>QR codes and barcodes on letters and labels.</li>
<li>Partially masked numbers, where another document shows the rest.</li>
</ul>

<h2>What to keep</h2>
<p>Over-redaction has a cost too. A redacted file should still answer the question it was shared for, so keep the dates, amounts and context the reader needs. Public contacts, such as a company switchboard or a helpline, rarely need removing. AnyRedact finds them but leaves them unticked.</p>
`,
  },
  {
    slug: 'gdpr-subject-access-request-redaction',
    title: 'Redacting Documents for a GDPR Access Request | AnyRedact',
    description: 'When answering a GDPR subject access request, redact other people\'s data and keep the requester\'s. What to remove, deadlines and a simple workflow.',
    h1: 'Redacting documents for a GDPR access request',
    summary: 'Whose data to remove when answering a subject access request, and how to keep a record.',
    body: `
<p>Under the UK and EU GDPR, people can ask an organisation for a copy of the personal data it holds about them. This is a subject access request, or SAR. The copies usually include emails, notes and reports that also mention colleagues, customers or other third parties, and those parts need redacting before release.</p>
<p>This guide is general information, not legal advice.</p>

<h2>What to redact</h2>
<ul>
<li><strong>Third-party personal data.</strong> Names, contact details and opinions about other people, unless they agree to disclosure or it is reasonable to share without their consent.</li>
<li><strong>Information covered by an exemption,</strong> such as legal privilege, or data whose release would prejudice crime prevention.</li>
<li><strong>Content unrelated to the requester,</strong> where a long document is only partly about them.</li>
</ul>
<p>Do not redact the requester's own data, even if it is unflattering. Their name, their opinions and opinions about them are what the request is for.</p>

<h2>Deadlines</h2>
<p>A response is due within one calendar month of receiving the request. It can be extended by up to two further months for complex or numerous requests, as long as the requester is told within the first month.</p>
${sarTimelineDiagram()}

<h2>A workflow that scales</h2>
<ol>
<li>Collect the documents and remove duplicates, such as the same email in several mailboxes.</li>
<li>Run each file through the matching tool: <a href="/redact-pdf">PDF</a>, <a href="/redact-word">Word</a>, <a href="/redact-excel">Excel</a> or <a href="/redact-text">text</a> for email exports.</li>
<li>Untick findings that belong to the requester. Add colleagues' names under "Always redact" so they are caught everywhere.</li>
<li>Use "Replace with label" in Word and text files where the reader needs to know a person was mentioned, such as [NAME].</li>
<li>Keep a log of what was redacted in each document and why. Regulators may ask for it if the requester complains.</li>
</ol>

<h2>Checks before release</h2>
<ul>
<li>Search each output for the third parties' names.</li>
<li>Check attachments inside emails, not only the email body.</li>
<li>Make sure the files cannot be un-redacted. See <a href="/guides/pdf-black-box-mistakes">why black boxes in PDFs fail</a>.</li>
</ul>
`,
  },
  {
    slug: 'how-to-redact-a-bank-statement',
    title: 'How to Redact a Bank Statement | AnyRedact',
    description: 'Hide account numbers, payees and spending you do not need to share before sending a bank statement to a landlord, employer or agency.',
    h1: 'How to redact a bank statement',
    tools: ['redact-pdf', 'redact-image'],
    summary: 'Share proof of income or address without your account numbers and spending.',
    body: `
<p>Landlords, letting agents, visa offices and new employers often ask for a bank statement when all they need is your name, your address or proof that a salary arrives. A full statement also shows where you shop, who you pay and your account details. Redacting the rest keeps the part they asked for and nothing more.</p>

<h2>Ask what they need first</h2>
<p>Some recipients only accept an untouched statement, and mortgage lenders in particular may want it straight from your bank. Others are happy with a redacted copy as long as certain lines stay visible. Asking up front saves sending it twice.</p>

<h2>Usually keep</h2>
<ul>
<li>Your name and address, if the statement is proof of address.</li>
<li>The bank's name and logo, and the statement period.</li>
<li>Salary or benefit payments and the opening and closing balances, if the statement is proof of income.</li>
</ul>

<h2>Usually remove</h2>
<ul>
<li>The full account number, sort code, IBAN and card number. Leaving the last four digits is common when the recipient needs to match the account.</li>
<li>Payee and merchant names, which can reveal health, religion, politics or relationships.</li>
<li>Names of other people you send money to or receive money from.</li>
<li>Payment references, which often hold invoice numbers, phone numbers or notes.</li>
</ul>

<h2>Steps</h2>
<ol>
<li><strong>Open the statement</strong> in the <a href="/redact-pdf">PDF tool</a>, or a photo or screenshot of it in the <a href="/redact-image">image tool</a>.</li>
<li><strong>Allow the scan.</strong> Account numbers, card numbers, IBANs and names are marked on each page.</li>
<li><strong>Untick what must stay</strong>, such as your own name and address.</li>
<li><strong>Box out transaction rows</strong> by dragging over them. One box can cover a whole block of lines.</li>
<li><strong>Download</strong> and open the copy to check every page.</li>
</ol>

<h2>Why the copy is an image</h2>
<p>The PDF comes back with each page flattened, so the hidden account number cannot be copied from under a bar. The flip side is that the recipient cannot search it or check it against the bank's digital signature. If they need that, ask your bank whether it can issue a statement for a shorter period or a letter confirming your address or income instead.</p>
`,
  },
  {
    slug: 'how-to-redact-a-chat-export',
    title: 'How to Redact a WhatsApp or Slack Chat Export | AnyRedact',
    description: 'Mask names, phone numbers and addresses in exported WhatsApp, Telegram or Slack chats before using them as evidence, research data or a bug report.',
    h1: 'How to redact a chat export',
    tools: ['redact-text'],
    summary: 'Mask names and numbers in WhatsApp, Telegram and Slack exports, line by line.',
    body: `
<p>Exported chats end up in court bundles, HR complaints, research datasets and support tickets. They name everyone in the conversation, and the messages themselves are full of phone numbers, addresses and links. The <a href="/redact-text">text redaction tool</a> works through the export and keeps one message per line.</p>

<h2>Getting the export</h2>
<ul>
<li><strong>WhatsApp:</strong> open the chat, choose Export chat from the menu and pick Without media. You get a .txt file, sometimes inside a .zip that needs unzipping first.</li>
<li><strong>Telegram Desktop:</strong> Export chat history, with the format set to machine-readable JSON.</li>
<li><strong>Slack:</strong> a workspace export is a folder of JSON files, one per channel per day. Open the days you need.</li>
</ul>

<h2>Steps</h2>
<ol>
<li><strong>Open the .txt or .json file</strong>, or paste the part of the chat you need.</li>
<li><strong>Allow the scan.</strong> Names, phone numbers, emails, addresses and links are found in the messages and in the sender names at the start of each line.</li>
<li><strong>Add nicknames</strong> under "Always redact". People rarely use full names in a chat, so first names and nicknames may need listing by hand.</li>
<li><strong>Pick a style.</strong> "Replace with label" turns every person into [NAME]. If the reader has to tell people apart, swap each name for a stand-in such as "Person A" with find and replace in a text editor before opening the file, and let the scan catch the rest.</li>
<li><strong>Download</strong> the redacted file.</li>
</ol>

<h2>Easy to miss</h2>
<ul>
<li>Phone numbers shown in place of names for people who are not in your contacts.</li>
<li>Group names and "added" or "left" system lines.</li>
<li>Shared locations, which appear as map links with coordinates.</li>
<li>Usernames, @mentions and email signatures pasted into messages.</li>
</ul>
<p>Photos and voice notes are not part of a text export. If you need them, redact each one in the <a href="/redact-image">image</a> or <a href="/redact-audio">audio</a> tool.</p>
`,
  },
  {
    slug: 'redact-before-sharing-with-ai',
    title: 'Remove Personal Data Before Pasting into ChatGPT | AnyRedact',
    description: 'Strip names, emails and account numbers from documents before giving them to ChatGPT, Claude or Gemini, while keeping enough context for a good answer.',
    h1: 'Remove personal data before pasting into an AI chatbot',
    tools: ['redact-text', 'redact-pdf'],
    summary: 'Give chatbots the content they need without customer names, emails or account numbers.',
    body: `
<p>Summarising a contract, rewriting a complaint or analysing a spreadsheet with an AI chatbot means handing it the whole document. Depending on the service and your settings, what you paste may be kept in your history, reviewed or used for training. Your employer's policy may also forbid sharing customer data with outside tools. Redacting first lets you get the help without passing the personal details on.</p>

<h2>Labels keep the meaning</h2>
<p>A chatbot answers better when it can tell people and things apart. "Replace with label" turns "Anna Novak emailed anna@example.com" into "[NAME] emailed [EMAIL]", so the sentence still makes sense and the model can still reason about it. Black bars make the text harder for the model to follow.</p>

<h2>Steps</h2>
<ol>
<li><strong>Paste the text</strong> into the <a href="/redact-text">text tool</a>, or open the file in the tool for its format (PDF, Word, Excel and the rest).</li>
<li><strong>Allow the scan</strong> and check the Found list.</li>
<li><strong>Add company terms</strong> under "Always redact": client names, project code names, internal host names.</li>
<li><strong>Choose "Replace with label"</strong> and download the result.</li>
<li><strong>Paste the redacted copy</strong> into the chatbot.</li>
</ol>
<p>If the answer comes back with labels in it, put the real names back yourself in your own copy. Keep the original file: the redacted one cannot be turned back.</p>

<h2>Detection uses AI too</h2>
<p>To find what to remove, AnyRedact sends the text it reads from your file to its own server, where an AI model running on Cloudflare marks the personal details. Nothing is sent until you agree, the text is not stored or used for training, and you can decline and mark everything by hand. The <a href="/privacy">privacy policy</a> has the details.</p>

<h2>Worth removing even when it seems harmless</h2>
<ul>
<li>Signatures at the bottom of emails, with phone numbers and job titles.</li>
<li>Customer and order IDs, which can be looked up in your systems.</li>
<li>File paths and URLs that contain user names.</li>
<li>Health, salary and disciplinary details about named staff.</li>
</ul>
`,
  },
  {
    slug: 'remove-metadata-from-docx',
    title: 'How to Remove Metadata from a DOCX File | AnyRedact',
    description: 'Clear the author, company, comment names and custom properties from a Word file, with Word\'s Inspect Document or online with nothing to install.',
    h1: 'How to remove metadata from a DOCX file',
    tools: ['redact-word'],
    summary: 'Clear author names, company and hidden properties, in Word or online.',
    body: `
<p>A .docx is a zip of XML files, and a few of them describe the document rather than hold its text. Send the file to someone and they can read who wrote it, who edited it last, which company their copy of Office is registered to, and everyone who commented. None of it shows on the page.</p>

<h2>What a DOCX records about you</h2>
<ul>
<li><strong>Author and last modified by</strong>, taken from the name set up in Office.</li>
<li><strong>Company and manager</strong>, often filled in by an organisation's Office setup.</li>
<li><strong>Title, subject, keywords and comments</strong> in the file properties, which may still describe an older version.</li>
<li><strong>Custom properties</strong> added by document management systems, such as a client name, matter number or file path.</li>
<li><strong>Names on comments and tracked changes</strong>, plus a list of everyone who edited.</li>
<li><strong>A thumbnail of the first page</strong>, if the file was saved with one.</li>
<li><strong>Camera and location data</strong> inside photos placed in the document.</li>
</ul>
<p>To see what your file holds, open File, Info in Word and look at the Properties panel. "Show All Properties" and Advanced Properties list the rest.</p>

<h2>In Word on Windows: Inspect Document</h2>
<ol>
<li>Save a copy first. The inspector's removals cannot be undone once the file is saved.</li>
<li>Go to File, Info, Check for Issues, Inspect Document.</li>
<li>Leave "Document Properties and Personal Information" ticked, along with "Comments, Revisions and Versions" if those should go too, and click Inspect.</li>
<li>Click Remove All next to each result you want cleared, then save.</li>
</ol>
<p>Inspect Document deletes comments and tracked changes outright instead of keeping them under a neutral name, so reviewers lose the discussion. It also leaves the text itself alone: a name typed in the body or a header is still there.</p>

<h2>In Word for Mac</h2>
<p>Word for Mac has no Inspect Document. On the Review tab, choose Protect Document and tick "Remove personal information from this file on save", then save. That clears the author names from the properties, comments and tracked changes. Check File, Properties afterwards for a company, title or custom fields left behind.</p>

<h2>Online, without Word</h2>
<p>The <a href="/redact-word">Word redaction tool</a> clears the metadata on every download, and you can redact names in the text at the same time.</p>
<ol>
<li><strong>Open the .docx</strong> in your browser.</li>
<li><strong>Allow the scan</strong> if the text also needs redacting, or decline it to clear only the metadata.</li>
<li><strong>Download.</strong> The copy has the author, last modified by, title, subject, keywords, category, company and manager emptied, custom properties deleted and the first-page thumbnail removed.</li>
</ol>
<p>Comments and tracked changes stay in the file, with every author shown as "Redacted", so the review history still reads. Photos in the document are saved again without their camera and location data (EMF, WMF and TIFF pictures are left as they are), and embedded files are dropped.</p>

<h2>Check the result</h2>
<p>Open the cleaned copy and look at File, Info, Properties again, then hover over a comment to see its author. For photos taken on a phone, the <a href="/guides/remove-photo-metadata">photo metadata guide</a> covers the same data in picture files.</p>
`,
  },
];
