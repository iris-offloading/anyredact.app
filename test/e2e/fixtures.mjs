import { PDFDocument, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';
import sharp from 'sharp';
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
writeFileSync(`${out}/sample.txt`, 'Hi, I am Jane Doe. Reach me at jane@example.com or 415-555-0132.\nServer: 10.0.0.12\nAlt number: 415-555-\n0199. Ask Jane.\nNext steps\nHelpline: 0800 123 4567\n');

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
