import { PDFDocument, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';
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
<w:p><w:del w:id="1" w:author="Bob Author"><w:r><w:delText>old ssn 123-45-6789</w:delText></w:r></w:del></w:p>
</w:body></w:document>`);
writeFileSync(`${out}/sample.docx`, await zip.generateAsync({ type: 'nodebuffer' }));
writeFileSync(`${out}/sample.txt`, 'Hi, I am Jane Doe. Reach me at jane@example.com or 415-555-0132.\nServer: 10.0.0.12\n');
