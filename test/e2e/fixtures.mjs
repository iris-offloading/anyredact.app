import { PDFDocument, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';
import sharp from 'sharp';
import ExcelJS from 'exceljs';
import PptxGenJS from 'pptxgenjs';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const out = process.argv[2] || 'e2e-out';
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const page = pdf.addPage([612, 792]);
const lines = ['Invoice for Jane Doe', 'Email: jane.doe@example.com', 'Phone: +1 (415) 555-0132', 'Card: 4111 1111 1111 1111', 'Thank you for your business.'];
lines.forEach((l, i) => page.drawText(l, { x: 72, y: 700 - i * 30, size: 16, font }));
// A filled form field: its value lives in the widget, not the page text.
const field = pdf.getForm().createTextField('reference');
field.setText('Reference A-77');
field.addToPage(page, { x: 72, y: 520, width: 300, height: 30, borderWidth: 0 });
pdf.setAuthor('Jane Doe');
writeFileSync(`${out}/sample.pdf`, await pdf.save());

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const zip = new JSZip();
zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:bob@corp.io" TargetMode="External"/></Relationships>`);
zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Bob Author</dc:creator><cp:lastModifiedBy>Bob Author</cp:lastModifiedBy></cp:coreProperties>`);
zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Contact: </w:t></w:r><w:hyperlink r:id="rId5"><w:r><w:t>bob@</w:t></w:r><w:r><w:t>corp.io</w:t></w:r></w:hyperlink></w:p>
<w:p><w:r><w:t xml:space="preserve">Call 555-</w:t></w:r><w:r><w:t>0100-200 today</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Prepared by: Maria Gonzalez</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Phone: 415-555-</w:t><w:br/><w:t>0132</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Fax: 415-555-</w:t></w:r></w:p><w:p><w:r><w:t>0199 (office)</w:t></w:r></w:p>
<w:p><w:fldSimple w:instr="HYPERLINK &quot;https://example.com/u/jane@example.com?growth=5%&quot;"><w:r><w:t>jane@example.com</w:t></w:r></w:fldSimple></w:p>
<w:sdt><w:sdtPr><w:dataBinding w:xpath="/client/ssn" w:storeItemID="{11111111-2222-3333-4444-555555555555}"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>SSN 123-45-6789</w:t></w:r></w:p></w:sdtContent></w:sdt>
<w:p><w:del w:id="1" w:author="Bob Author"><w:r><w:delText>old ssn 123-45-6789</w:delText></w:r></w:del></w:p>
</w:body></w:document>`);
zip.file('customXml/item1.xml', '<?xml version="1.0" encoding="UTF-8"?><client><ssn>123-45-6789</ssn></client>');
writeFileSync(`${out}/sample.docx`, await zip.generateAsync({ type: 'nodebuffer' }));
// A Word file with pictures: text and EXIF in a photo, alt text, a GIF and a first-page thumbnail.
{
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="300"><rect width="100%" height="100%" fill="#fff"/><text x="40" y="120" font-family="Arial" font-size="48">Patient: Jane Doe</text><text x="40" y="210" font-family="Arial" font-size="48">SSN 123-45-6789</text></svg>`;
  const photo = await withMetadata(await sharp(Buffer.from(svg)).jpeg().toBuffer());
  const gif = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#3a7' } }).gif().toBuffer();
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const pic = (rid, id, descr) => `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="5486400" cy="1828800"/><wp:docPr id="${id}" name="Jane passport.jpg" descr="${descr}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Jane passport.jpg" descr="${descr}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  const z = new JSZip();
  z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  z.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail" Target="docProps/thumbnail.jpeg"/></Relationships>`);
  z.file('docProps/thumbnail.jpeg', photo);
  z.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="${R}/image" Target="media/image1.jpeg"/><Relationship Id="rId8" Type="${R}/image" Target="media/image2.gif"/></Relationships>`);
  z.file('word/media/image1.jpeg', photo);
  z.file('word/media/image2.gif', gif);
  z.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W} xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>
<w:p><w:r><w:t>Scan attached.</w:t></w:r></w:p>
${pic('rId7', 1, 'ID card, call 415-555-0132')}
${pic('rId8', 2, 'Logo')}
</w:body></w:document>`);
  writeFileSync(`${out}/pictures.docx`, await z.generateAsync({ type: 'nodebuffer' }));
}

// A deck: a dark title slide with a bullet list, notes and a comment, a slide with a scanned ID
// (alt text, EXIF) and a table, a hidden slide, and author details.
{
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="300"><rect width="100%" height="100%" fill="#fff"/><text x="40" y="120" font-family="Arial" font-size="48">Patient: Jane Doe</text><text x="40" y="210" font-family="Arial" font-size="48">SSN 123-45-6789</text></svg>`;
  const photo = await withMetadata(await sharp(Buffer.from(svg)).jpeg().toBuffer());
  const deck = new PptxGenJS();
  deck.layout = 'LAYOUT_WIDE';
  deck.author = 'Bob Author';
  deck.company = 'Acme Ltd';
  let slide = deck.addSlide();
  slide.background = { color: '1F3A5F' };
  slide.addText('Onboarding: Jane Doe', { x: 0.6, y: 0.5, w: 12, h: 1, fontSize: 40, bold: true, color: 'FFFFFF' });
  slide.addText(
    [
      { text: 'Email: jane.doe@example.com', options: { bullet: true, breakLine: true } },
      { text: 'Phone: +1 (415) 555-0132', options: { bullet: true, breakLine: true } },
      { text: 'Contact: ', options: { bullet: true } },
      { text: 'bob@corp.io', options: { hyperlink: { url: 'mailto:bob@corp.io' } } },
    ],
    { x: 0.6, y: 2, w: 7, h: 2.4, fontSize: 22, color: 'E0E8F0' },
  );
  slide.addShape(deck.ShapeType.roundRect, { x: 8.2, y: 2, w: 4.5, h: 2.4, fill: { color: 'F4B942' }, rectRadius: 0.2 });
  slide.addText('Manager: Maria Gonzalez', { x: 8.4, y: 2.6, w: 4.1, h: 1, fontSize: 20, color: '1F3A5F' });
  slide.addNotes('Remind Maria about SSN 123-45-6789');
  slide = deck.addSlide();
  slide.addText('Scan of ID', { x: 0.6, y: 0.4, w: 12, h: 0.8, fontSize: 32, bold: true });
  slide.addImage({ data: `image/jpeg;base64,${photo.toString('base64')}`, x: 0.6, y: 1.4, w: 9, h: 3, altText: 'ID card, call 415-555-0199' });
  slide.addTable([[{ text: 'Name' }, { text: 'Card' }], [{ text: 'Maria Gonzalez' }, { text: '4111 1111 1111 1111' }]], { x: 0.6, y: 5, w: 9, fontSize: 16, border: { type: 'solid', pt: 1, color: '999999' } });
  slide = deck.addSlide();
  slide.addText('Hours', { x: 0.6, y: 0.4, w: 12, h: 0.8, fontSize: 32, bold: true });
  slide.addChart(deck.ChartType.bar, [{ name: 'Hours', labels: ['Maria Gonzalez', 'Team B'], values: [12, 30] }], { x: 0.6, y: 1.4, w: 8, h: 4, showTitle: true, title: 'Overtime for Jane Doe' });
  slide = deck.addSlide();
  slide.hidden = true;
  slide.addText('Old ssn 123-45-6789', { x: 0.6, y: 0.6, w: 8, h: 1, fontSize: 28 });
  const z = await JSZip.loadAsync(await deck.write({ outputType: 'nodebuffer' }));
  // pptxgenjs writes neither comments nor a thumbnail, so they are added here.
  const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  z.file('ppt/commentAuthors.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:cmAuthorLst ${P}><p:cmAuthor id="0" name="Bob Author" initials="BA" lastIdx="1" clrIdx="0"/></p:cmAuthorLst>`);
  z.file('ppt/comments/comment1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:cmLst ${P}><p:cm authorId="0" dt="2026-10-27T10:00:00.000" idx="1"><p:pos x="10" y="10"/><p:text>Check 415-555-0177 with Jane Doe</p:text></p:cm></p:cmLst>`);
  const rels = await z.file('ppt/slides/_rels/slide1.xml.rels').async('string');
  z.file('ppt/slides/_rels/slide1.xml.rels', rels.replace('</Relationships>', '<Relationship Id="rIdC1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments/comment1.xml"/></Relationships>'));
  const presRels = await z.file('ppt/_rels/presentation.xml.rels').async('string');
  z.file('ppt/_rels/presentation.xml.rels', presRels.replace('</Relationships>', '<Relationship Id="rIdCA" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors" Target="commentAuthors.xml"/></Relationships>'));
  z.file('docProps/thumbnail.jpeg', photo);
  const root = await z.file('_rels/.rels').async('string');
  z.file('_rels/.rels', root.replace('</Relationships>', '<Relationship Id="rIdT" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail" Target="docProps/thumbnail.jpeg"/></Relationships>'));
  const types = await z.file('[Content_Types].xml').async('string');
  z.file('[Content_Types].xml', types.replace('</Types>', '<Override PartName="/ppt/comments/comment1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.comments+xml"/><Override PartName="/ppt/commentAuthors.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml"/></Types>'));
  writeFileSync(`${out}/sample.pptx`, await z.generateAsync({ type: 'nodebuffer' }));

  // The same chart, with the workbook behind it, in a Word file.
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const chart = Object.keys(z.files).find((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n));
  const chartRels = await z.file(chart.replace(/charts\/(chart\d+\.xml)$/, 'charts/_rels/$1.rels')).async('string');
  const book = Object.keys(z.files).find((n) => /^ppt\/embeddings\/.+\.xlsx$/.test(n));
  const d = new JSZip();
  d.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`);
  d.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`);
  d.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="${R}/chart" Target="charts/chart1.xml"/></Relationships>`);
  d.file('word/charts/chart1.xml', await z.file(chart).async('string'));
  d.file('word/charts/_rels/chart1.xml.rels', chartRels.replace(/Target="[^"]*embeddings\//, 'Target="../embeddings/'));
  d.file(`word/embeddings/${book.split('/').pop()}`, await z.file(book).async('nodebuffer'));
  d.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W} xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><w:body>
<w:p><w:r><w:t>Overtime report.</w:t></w:r></w:p>
<w:p><w:r><w:drawing><wp:inline><wp:extent cx="5486400" cy="3200400"/><wp:docPr id="1" name="Chart 1"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId9"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
</w:body></w:document>`);
  writeFileSync(`${out}/chart.docx`, await d.generateAsync({ type: 'nodebuffer' }));
}

// A deck whose chart color closes the drawing early and adds a frame that loads a script.
{
  const deck = new PptxGenJS();
  const slide = deck.addSlide();
  slide.addText('Hello Jane Doe', { x: 0.5, y: 0.3, w: 8, h: 0.8 });
  slide.addChart(deck.ChartType.pie, [{ name: 'Sales', labels: ['North', 'South'], values: [3, 5] }], { x: 1, y: 1.5, w: 5, h: 3.5, chartColors: ['AA0000', '00AA00'] });
  const z = await JSZip.loadAsync(await deck.write({ outputType: 'nodebuffer' }));
  const attack = '</svg></div><iframe id="injected" srcdoc="<script src=https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js></script>"></iframe><a id="injected-link" href="https://example.com">Sign in</a><svg><path d="';
  const esc = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  for (const n of Object.keys(z.files).filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n))) {
    z.file(n, (await z.file(n).async('string')).replace('val="AA0000"', `val="AA0000${esc(attack)}"`));
  }
  writeFileSync(`${out}/injected.pptx`, await z.generateAsync({ type: 'nodebuffer' }));
}

writeFileSync(`${out}/sample.txt`, 'Hi, I am Jane Doe. Reach me at jane@example.com or 415-555-0132.\nServer: 10.0.0.12\nAlt number: 415-555-\n0199. Ask Jane.\nNext steps\nHelpline: 0800 123 4567\n');

// Spreadsheet: styled header, a phone stored as a number, a formula copying an email,
// a note, a footer, a hidden sheet and workbook properties.
const book = new ExcelJS.Workbook();
book.creator = 'Bob Author';
book.lastModifiedBy = 'Bob Author';
book.company = 'Acme Ltd';
const sheet = book.addWorksheet('Customers');
sheet.columns = [{ width: 18 }, { width: 28 }, { width: 16 }, { width: 28 }];
sheet.addRow(['Name', 'Email', 'Phone', 'Contact']);
sheet.getRow(1).font = { bold: true };
sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE699' } };
sheet.addRow(['Customer', 'jane.doe@example.com', 4155550132, { formula: 'B2', result: 'jane.doe@example.com' }]);
sheet.addRow(['Supplier', { text: 'bob@corp.io', hyperlink: 'mailto:bob@corp.io' }, '415-555-0199', 'Helpline: 0800 123 4567']);
sheet.addRow(['Born', new Date(Date.UTC(1985, 2, 15))]);
sheet.getCell('B4').numFmt = 'dd/mm/yyyy';
sheet.getCell('C2').numFmt = '0';
sheet.getCell('A2').note = 'Called back from 415-555-0177';
sheet.headerFooter.oddFooter = 'Prepared by Dr. Maria Gonzalez';
sheet.views = [{ state: 'frozen', ySplit: 1 }];
const orders = book.addWorksheet('Orders', { properties: { tabColor: { argb: 'FF4472C4' } } });
orders.columns = [{ width: 14 }, { width: 14 }, { width: 12 }];
orders.mergeCells('A1:C1');
orders.getCell('A1').value = 'Orders for Jane Doe';
orders.getCell('A1').alignment = { horizontal: 'center' };
orders.getCell('A1').font = { bold: true, size: 14 };
orders.addRow(['Date', 'Amount', 'Paid']);
orders.addRow([new Date(Date.UTC(2026, 9, 1)), 1234.5, true]);
orders.getCell('A3').numFmt = 'yyyy-mm-dd';
orders.getCell('B3').numFmt = '#,##0.00';
orders.getCell('B3').border = { bottom: { style: 'double' } };
const old = book.addWorksheet('Old', { state: 'hidden' });
old.addRow(['Customer', 'old ssn 123-45-6789']);
await book.xlsx.writeFile(`${out}/sample.xlsx`);
try {
  // LibreOffice, when installed, turns the same workbook into an ODS file.
  execFileSync('soffice', ['--headless', '--convert-to', 'ods', '--outdir', out, `${out}/sample.xlsx`], { stdio: 'ignore' });
} catch {
  /* the ODS test is skipped */
}

/** Adds EXIF (camera, author, date, GPS) and XMP to a JPEG, for the metadata test. */
export function withMetadata(jpeg) {
  const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" photoshop:City="San Francisco"/></rdf:RDF></x:xmpmeta>';
  return sharp(jpeg)
    .withExif({
      IFD0: { Make: 'Canon', Model: 'Canon EOS R6', Artist: 'Jane Doe' },
      IFD2: { DateTimeOriginal: '2026:10:20 14:03:00', BodySerialNumber: '0123456789' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '37/1 46/1 30/1', GPSLongitudeRef: 'W', GPSLongitude: '122/1 25/1 12/1' },
    })
    .withXmp(xmp)
    .jpeg()
    .toBuffer();
}
