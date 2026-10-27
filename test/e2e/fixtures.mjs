import { PDFDocument, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';
import sharp from 'sharp';
import ExcelJS from 'exceljs';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const out = process.argv[2] || 'e2e-out';
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const page = pdf.addPage([612, 792]);
const lines = ['Invoice for Jane Doe', 'Email: jane.doe@example.com', 'Phone: +1 (415) 555-0132', 'Card: 4111 1111 1111 1111', 'Thank you for your business.'];
lines.forEach((l, i) => page.drawText(l, { x: 72, y: 700 - i * 30, size: 16, font }));
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
<w:p><w:del w:id="1" w:author="Bob Author"><w:r><w:delText>old ssn 123-45-6789</w:delText></w:r></w:del></w:p>
</w:body></w:document>`);
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
