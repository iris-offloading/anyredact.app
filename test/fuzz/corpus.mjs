// Writes the fuzz corpus: valid, unusual and broken files of every supported type.
// Usage: node test/fuzz/corpus.mjs <outdir>. Prints nothing; run.mjs reads cases() from here.
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import JSZip from 'jszip';
import sharp from 'sharp';
import ExcelJS from 'exceljs';
import PptxGenJS from 'pptxgenjs';
import wavefile from 'wavefile';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';

// Every case holds at least one of these, which the stand-in model reports.
export const SECRETS = ['Jane Doe', 'jane@example.com', '415-555-0132'];
const LINES = ['Patient: Jane Doe', 'Email: jane@example.com', 'Phone: 415-555-0132'];

const rnd = (n, seed = 7) => {
  const b = Buffer.alloc(n);
  let s = seed;
  for (let i = 0; i < n; i++) b[i] = (s = (s * 1103515245 + 12345) >>> 0) >>> 24;
  return b;
};

/** A picture of the lines, big enough for OCR. */
async function textPicture(lines = LINES, { w = 1200, h = 400, size = 44, bg = '#fff', fg = '#000' } = {}) {
  const rows = lines.map((l, i) => `<text x="40" y="${90 + i * size * 1.6}" font-family="Arial" font-size="${size}" fill="${fg}">${l}</text>`).join('');
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${bg}"/>${rows}</svg>`));
}

async function textPdf(lines = LINES, opts = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const n = opts.pages ?? 1;
  for (let p = 0; p < n; p++) {
    const page = pdf.addPage(opts.size ?? [612, 792]);
    if (opts.rotate) page.setRotation(degrees(opts.rotate));
    if (opts.box) page.setMediaBox(...opts.box);
    const [x0, y0] = opts.box ?? [0, 0];
    lines.forEach((l, i) => page.drawText(l, { x: x0 + 40, y: y0 + (opts.size?.[1] ?? 792) - 80 - i * 1.7 * (opts.fontSize ?? 14) - (opts.fontSize ?? 14), size: opts.fontSize ?? 14, font }));
  }
  return Buffer.from(await pdf.save({ useObjectStreams: !opts.classic }));
}

async function imagePdf(img, { w = 612, h = 792, rotate = 0 } = {}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([w, h]);
  if (rotate) page.setRotation(degrees(rotate));
  const png = await pdf.embedPng(img);
  page.drawImage(png, { x: 20, y: h - 20 - (w - 40) / 3, width: w - 40, height: (w - 40) / 3 });
  return Buffer.from(await pdf.save());
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
/** A minimal Word file around the given body XML. */
async function docx(body, extra = {}) {
  const z = new JSZip();
  z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  z.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.file('word/_rels/document.xml.rels', extra.rels ?? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`);
  z.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W} xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:v="urn:schemas-microsoft-com:vml"><w:body>${body}</w:body></w:document>`);
  for (const [k, v] of Object.entries(extra.files ?? {})) z.file(k, v);
  return z.generateAsync({ type: 'nodebuffer' });
}
const para = (t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;

function soffice(src, to, outDir) {
  execFileSync('soffice', ['--headless', '--convert-to', to, '--outdir', outDir, src], { stdio: 'ignore', timeout: 120_000 });
}

function wav(seconds, { rate = 16000, channels = 1, bits = '16' } = {}) {
  const w = new wavefile.WaveFile();
  const n = Math.round(seconds * rate);
  const ch = Array.from({ length: channels }, () => {
    const max = bits === '8' ? 127 : 3000;
    return Array.from({ length: n }, (_, i) => Math.round(Math.sin((i / rate) * 2 * Math.PI * 220) * max * 0.3) + (bits === '8' ? 128 : 0));
  });
  w.fromScratch(channels, rate, bits, channels === 1 ? ch[0] : ch);
  return Buffer.from(w.toBuffer());
}

/**
 * Each case: file name, the page it opens on ('' is the all-formats page), whether
 * it should open, and which secrets it holds where the editor can find them.
 */
export async function build(out) {
  mkdirSync(out, { recursive: true });
  const cases = [];
  const add = (file, data, o = {}) => {
    writeFileSync(path.join(out, file), data);
    cases.push({ file, slug: o.slug ?? '', keep: o.keep ?? [], opens: o.opens ?? true, secrets: o.secrets ?? (o.opens === false ? [] : SECRETS), note: o.note ?? '', group: o.group ?? path.extname(file).slice(1) });
  };
  const body = LINES.join('\n');

  // Text
  add('empty.txt', '', { secrets: [], note: 'zero bytes' });
  add('only-spaces.txt', '   \n\t\n', { secrets: [] });
  add('plain.txt', body + '\n');
  add('crlf.txt', LINES.join('\r\n'));
  add('cr-only.txt', LINES.join('\r'), { note: 'old Mac line ends' });
  add('utf8-bom.txt', '\uFEFF' + body + ' Zürich', { keep: ['\uFEFF', 'Zürich'], note: 'UTF-8 with a BOM, as Excel saves CSV UTF-8' });
  add('utf16le-bom.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(body, 'utf16le')]), { keep: ['Patient'], note: 'Windows Notepad Unicode' });
  add('utf16le-no-bom.txt', Buffer.from(body + ' Zürich', 'utf16le'), { keep: ['Zürich'], note: 'UTF-16 without a byte order mark' });
  add('mostly-zeros.bin.txt', Buffer.concat([Buffer.alloc(30_000), rnd(2000)]), { opens: false, note: 'zeros named .txt' });
  add('utf16be-bom.txt', Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(body, 'utf16le').swap16()]));
  add('latin1.txt', Buffer.from('Café owner: Jane Doe, Zürich\nEmail: jane@example.com\nPhone: 415-555-0132\nNiño señor façade\n', 'latin1'), { keep: ['Café', 'Zürich', 'Niño señor façade'], note: 'Windows-1252 accents' });
  add('nul-bytes.txt', `Patient: Jane\u0000 Doe\u0000\nEmail: jane@example.com\u0000\nPhone: 415-555-0132`, { secrets: ['jane@example.com', '415-555-0132'] });
  add('emoji-rtl.txt', `👩‍⚕️ Patient: Jane Doe 😀\n‮Email: jane@example.com‬\nטלפון: 415-555-0132 שלום\nZero​width: Ja​ne`);
  add('combining.txt', `Patient: Jane Doe, José Nuñez\nEmail: jane@example.com\nPhone: 415-555-0132`);
  add('one-long-line.txt', ('lorem ipsum dolor sit amet ').repeat(80_000) + body.replace(/\n/g, ' '), { note: '2 MB with no line break' });
  add('many-lines.log', Array.from({ length: 60_000 }, (_, i) => `2026-10-29T10:00:${String(i % 60).padStart(2, '0')}Z INFO request ${i} from 10.1.${i % 255}.${i % 200}`).join('\n') + '\n' + body, { note: '60k log lines' });
  add('binary.txt', rnd(20_000), { opens: false, note: 'random bytes named .txt' });
  add('program.exe', Buffer.concat([Buffer.from('MZ'), rnd(20_000)]), { opens: false, note: 'a program' });
  add('no-extension', body, { note: 'file without an extension' });
  add('.env', `DB_USER=Jane Doe\nEMAIL=jane@example.com\nPHONE=415-555-0132\nSECRET_KEY="abc"\n`);
  add('unknown.xyz', body, { note: 'unknown extension, text inside' });

  // Structured text
  add('valid.json', JSON.stringify({ name: 'Jane Doe', email: 'jane@example.com', phone: 4155550132, tel: '415-555-0132' }, null, 2), { secrets: ['Jane Doe', 'jane@example.com', '415-555-0132'] });
  add('bom.json', '﻿' + JSON.stringify({ name: 'Jane Doe', email: 'jane@example.com', tel: '415-555-0132' }, null, 2), { note: 'BOM before JSON' });
  add('invalid.json', '{"name": "Jane Doe", "email": "jane@example.com", tel: 415-555-0132,,}', { note: 'broken JSON' });
  add('deep.json', '['.repeat(5000) + JSON.stringify({ name: 'Jane Doe', email: 'jane@example.com', tel: '415-555-0132' }) + ']'.repeat(5000), { note: '5000 levels deep' });
  add('jsonc.json', `// owner Jane Doe\n{\n  /* email */ "email": "jane@example.com",\n  "tel": "415-555-0132", // trailing\n}\n`, { note: 'comments and trailing comma' });
  add('crlf.jsonl', [{ n: 'Jane Doe' }, { e: 'jane@example.com' }, { t: '415-555-0132' }].map((o) => JSON.stringify(o)).join('\r\n') + '\r\n');
  add('broken-line.jsonl', `{"n":"Jane Doe"}\n{"e":"jane@example.com"\n{"t":"415-555-0132"}\n`, { note: 'one bad line' });
  add('escaped.json', JSON.stringify({ note: 'Patient\tJane Doe said "hi"', email: 'jane@example.com', tel: '415-555-0132' }).replace('jane@example.com', 'jane\\u0040example.com'), { secrets: ['Jane Doe', '415-555-0132'], note: 'escaped @ in an email' });
  add('entities.xml', `<?xml version="1.0"?>\n<!DOCTYPE p [<!ENTITY n "Jane Doe">]>\n<p name="Jane Doe" mail='jane@example.com'>&n; &amp; <![CDATA[415-555-0132 <x>]]><!-- Jane Doe --></p>\n`);
  add('billion-laughs.xml', `<?xml version="1.0"?>\n<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"><!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">]>\n<lolz>&lol3; Jane Doe jane@example.com 415-555-0132</lolz>\n`);
  add('attr-gt.xml', `<?xml version="1.0"?>\n<a title="x > y" who="Jane Doe">jane@example.com 415-555-0132</a>\n`, { note: '> inside an attribute' });
  add('broken.xml', `<a><b>Jane Doe</a> jane@example.com <c 415-555-0132`, { note: 'unclosed tags' });
  add('page.html', `<!doctype html><html><head><title>Jane Doe</title><script>var email = "jane@example.com";</script><style>.x{}</style></head><body><p>Call 415-555-0132</p><img alt="Jane Doe"></body></html>`);
  add('crlf.srt', `1\r\n00:00:01,000 --> 00:00:04,000\r\nHi, I am Jane Doe.\r\n\r\n2\r\n00:00:05,000 --> 00:00:08,000\r\nMail jane@example.com or 415-555-0132\r\n`);
  add('bom.vtt', `﻿WEBVTT\n\n00:01.000 --> 00:04.000 align:start\n<v Jane Doe>Hi, I am Jane Doe.\n\n00:05.000 --> 00:08.000\nMail jane@example.com or call 415-555-0132\n`);
  add('quoted.csv', `name,notes,phone\n"Doe, Jane","Line one\nEmail jane@example.com, ""quoted""",415-555-0132\nJane Doe,,\n`, { slug: '' });
  add('quoted-on-sheet.csv', `name,notes,phone\n"Doe, Jane","Line one\nEmail jane@example.com, ""quoted""",415-555-0132\nJane Doe,,\n`, { slug: 'redact-excel' });
  add('semicolon.csv', `name;email;phone\nJane Doe;jane@example.com;415-555-0132\n`, { slug: 'redact-excel', note: 'European CSV' });
  add('tabs.tsv', `name\temail\tphone\nJane Doe\tjane@example.com\t415-555-0132\n`, { slug: 'redact-excel' });
  add('latin1.csv', Buffer.from('nom,ville,mail,tel\nJane Doe,Zürich,jane@example.com,415-555-0132\n', 'latin1'), { slug: 'redact-excel', keep: ['Zürich'], note: 'Excel CSV in Windows-1252' });
  add('empty-on-sheet.csv', '', { slug: 'redact-excel', secrets: [] });

  // PDF
  add('text.pdf', await textPdf());
  add('empty.pdf', Buffer.alloc(0), { opens: false });
  add('random.pdf', rnd(5000), { opens: false });
  add('truncated.pdf', (await textPdf()).subarray(0, 900), { opens: false, note: 'cut off mid-file' });
  add('no-xref.pdf', Buffer.from((await textPdf(LINES, { classic: true })).toString('latin1').replace(/xref[\s\S]*$/, ''), 'latin1'), { note: 'no xref table or trailer' });
  add('rotated-90.pdf', await textPdf(LINES, { rotate: 90 }));
  add('rotated-180.pdf', await textPdf(LINES, { rotate: 180 }));
  add('rotated-270.pdf', await textPdf(LINES, { rotate: 270 }));
  add('offset-mediabox.pdf', await textPdf(LINES, { box: [500, 500, 612, 792] }), { note: 'MediaBox not at 0,0' });
  add('huge-page.pdf', await textPdf(LINES, { size: [14400, 14400], fontSize: 200 }), { note: '200 inch page' });
  add('tiny-page.pdf', await textPdf(['Jane Doe'], { size: [72, 36], fontSize: 6 }), { secrets: [], note: '1 by 0.5 inch page' });
  add('blank-pages.pdf', await textPdf([], { pages: 3 }), { secrets: [] });
  add('long-61.pdf', await textPdf(LINES, { pages: 61 }), { note: '61 pages' });
  add('scan.pdf', await imagePdf(await (await textPicture()).png().toBuffer()), { note: 'scanned page' });
  add('scan-rot90.pdf', await imagePdf(await (await textPicture()).png().toBuffer(), { rotate: 90 }), { note: 'scanned page with /Rotate 90' });
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([612, 792]);
    // Text drawn one character at a time, as some generators do.
    let x = 40;
    for (const ch of 'Patient: Jane Doe jane@example.com 415-555-0132') {
      page.drawText(ch, { x, y: 700, size: 12, font });
      x += font.widthOfTextAtSize(ch, 12);
    }
    add('per-char.pdf', Buffer.from(await pdf.save()), { note: 'one text item per character' });
  }
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([612, 792]);
    const lines = ['Patient: Jane Doe', 'Email: jane@example.com', 'Phone: 415-555-0132'];
    lines.forEach((l, i) => page.drawText(l, { x: 300, y: 600 - i * 60, size: 18, font, rotate: degrees(30) }));
    add('rotated-text.pdf', Buffer.from(await pdf.save()), { note: 'text drawn at 30 degrees' });
  }
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([612, 792]);
    page.drawText('Public text only', { x: 40, y: 700, size: 14, font });
    const form = pdf.getForm();
    const f = form.createTextField('who');
    f.setText('Jane Doe');
    f.addToPage(page, { x: 40, y: 600, width: 200, height: 24 });
    const c = form.createCheckBox('ok');
    c.addToPage(page, { x: 40, y: 560, width: 12, height: 12 });
    c.check();
    const d = form.createDropdown('mail');
    d.addOptions(['jane@example.com', 'x@y.z']);
    d.select('jane@example.com');
    d.addToPage(page, { x: 40, y: 500, width: 200, height: 24 });
    const ml = form.createTextField('notes');
    ml.enableMultiline();
    ml.setText('Call 415-555-0132\nanytime');
    ml.addToPage(page, { x: 40, y: 400, width: 300, height: 60 });
    add('form.pdf', Buffer.from(await pdf.save()), { note: 'text, dropdown and multiline fields' });
  }
  {
    // Encrypted PDFs: pypdf is the only encrypter at hand.
    const plain = path.join(out, '_plain.pdf');
    writeFileSync(plain, await textPdf());
    for (const [name, user] of [['encrypted-open.pdf', ''], ['encrypted-password.pdf', 'secret']]) {
      try {
        execFileSync('python3', ['-I', '-c', `import sys,pypdf\nr=pypdf.PdfReader(sys.argv[1]);w=pypdf.PdfWriter(clone_from=r)\nw.encrypt(user_password=sys.argv[3],owner_password='owner',algorithm='AES-256')\nw.write(sys.argv[2])`, plain, path.join(out, name), user]);
        cases.push({ file: name, slug: '', opens: true, password: user || undefined, secrets: SECRETS, note: user ? `opens with the password "${user}"` : 'owner password only', group: 'pdf' });
      } catch {
        /* pypdf missing */
      }
    }
  }

  // Images
  const pic = await textPicture();
  add('text.png', await pic.clone().png().toBuffer());
  add('text.jpg', await pic.clone().jpeg().toBuffer());
  add('progressive.jpg', await pic.clone().jpeg({ progressive: true }).toBuffer());
  add('cmyk.jpg', await pic.clone().toColourspace('cmyk').jpeg().toBuffer(), { note: 'CMYK JPEG' });
  add('grey16.png', await pic.clone().toColourspace('grey16').png().toBuffer(), { note: '16-bit greyscale' });
  add('interlaced.png', await pic.clone().png({ progressive: true }).toBuffer());
  add('palette.png', await pic.clone().png({ palette: true, colours: 4 }).toBuffer());
  add('transparent.png', await (await textPicture(LINES, { bg: 'none' })).png().toBuffer(), { note: 'black text on transparency' });
  add('white-on-transparent.png', await (await textPicture(LINES, { bg: 'none', fg: '#fff' })).png().toBuffer(), { note: 'white text on transparency' });
  add('dark.png', await (await textPicture(LINES, { bg: '#111', fg: '#eee' })).png().toBuffer(), { note: 'light text on dark' });
  add('text.webp', await pic.clone().webp().toBuffer());
  add('text.avif', await pic.clone().avif().toBuffer());
  add('text.gif', await pic.clone().gif().toBuffer());
  add('text.tiff', await pic.clone().tiff().toBuffer());
  add('lzw.tiff', await pic.clone().tiff({ compression: 'lzw' }).toBuffer());
  add('jpeg-in.tiff', await pic.clone().tiff({ compression: 'jpeg' }).toBuffer(), { note: 'JPEG-compressed TIFF' });
  add('tiled.tiff', await pic.clone().tiff({ tile: true, tileWidth: 256, tileHeight: 256 }).toBuffer(), { note: 'tiled TIFF' });
  add('bit16.tiff', await pic.clone().toColourspace('rgb16').tiff().toBuffer(), { note: '16-bit RGB TIFF' });
  add('cmyk.tiff', await pic.clone().toColourspace('cmyk').tiff({ compression: 'lzw' }).toBuffer(), { note: 'CMYK TIFF' });
  add('cmyk-jpeg.tiff', await pic.clone().toColourspace('cmyk').tiff().toBuffer(), { note: 'CMYK TIFF with JPEG compression' });
  {
    // BMP and fax TIFF: sharp cannot write them, ImageMagick can.
    const src = path.join(out, '_pic.png');
    writeFileSync(src, await pic.clone().png().toBuffer());
    try {
      execFileSync('convert', [src, path.join(out, 'text.bmp')]);
      cases.push({ file: 'text.bmp', slug: '', opens: true, secrets: SECRETS, note: '', group: 'bmp' });
      execFileSync('convert', [src, '-monochrome', 'BMP3:' + path.join(out, 'mono.bmp')]);
      cases.push({ file: 'mono.bmp', slug: '', opens: true, secrets: SECRETS, note: '1-bit BMP', group: 'bmp' });
      execFileSync('convert', [src, '-monochrome', '-compress', 'Group4', path.join(out, 'fax.tiff')]);
      cases.push({ file: 'fax.tiff', slug: '', opens: true, secrets: SECRETS, note: 'fax G4 bilevel TIFF', group: 'tiff' });
    } catch {
      /* ImageMagick missing */
    }
  }
  // Pixels stored the way a camera would, so the photo is upright once its EXIF orientation is applied.
  const stored = { 2: (p) => p.flop(), 3: (p) => p.rotate(180), 4: (p) => p.flip(), 5: (p) => p.rotate(90).flop(), 6: (p) => p.rotate(270), 7: (p) => p.rotate(270).flop(), 8: (p) => p.rotate(90) };
  for (const [o, f] of Object.entries(stored)) {
    const raw = await f(sharp(await pic.clone().png().toBuffer())).png().toBuffer();
    add(`orient-${o}.jpg`, await sharp(raw).jpeg().withMetadata({ orientation: Number(o) }).toBuffer(), { note: `EXIF orientation ${o}` });
  }
  add('png-named.jpg', await pic.clone().png().toBuffer(), { note: 'PNG with a .jpg name' });
  add('jpg-named.heic', await pic.clone().jpeg().toBuffer(), { note: 'JPEG with a .heic name' });
  add('empty.png', Buffer.alloc(0), { opens: false });
  add('random.jpg', rnd(4000), { opens: false });
  add('truncated.jpg', (await pic.clone().jpeg().toBuffer()).subarray(0, 4000), { opens: false, note: 'cut off mid-file' });
  add('truncated.png', (await pic.clone().png().toBuffer()).subarray(0, 3000), { opens: false, note: 'cut off mid-file' });
  add('one-pixel.png', await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } }).png().toBuffer(), { secrets: [] });
  add('thin.png', await sharp({ create: { width: 20000, height: 4, channels: 3, background: '#fff' } }).png().toBuffer(), { secrets: [], note: '20000 by 4' });
  add('big.jpg', await (await textPicture(LINES, { w: 8000, h: 6000, size: 200 })).jpeg({ quality: 60 }).toBuffer(), { note: '48 megapixels' });
  add('small-text.png', await (await textPicture(LINES, { w: 400, h: 120, size: 12 })).png().toBuffer(), { secrets: [], note: '12 px text' });
  add('animated.gif', await sharp([await pic.clone().png().toBuffer(), await sharp({ create: { width: 1200, height: 400, channels: 3, background: '#fff' } }).png().toBuffer()], { join: { animated: true } }).gif().toBuffer(), { note: 'two frames' });
  add('animated.webp', await sharp([await pic.clone().png().toBuffer(), await sharp({ create: { width: 1200, height: 400, channels: 3, background: '#fff' } }).png().toBuffer()], { join: { animated: true } }).webp().toBuffer());
  add('multipage.tiff', await sharp([await pic.clone().png().toBuffer(), await (await textPicture(['Second page', 'Jane Doe'])).png().toBuffer()], { join: { animated: true } }).tiff().toBuffer(), { note: 'two pages' });
  const svgText = LINES.map((l, i) => `<text x="20" y="${60 + i * 50}" font-family="Arial" font-size="36">${l}</text>`).join('');
  add('plain.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="220">${svgText}</svg>`);
  add('viewbox-only.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 220">${svgText}</svg>`, { note: 'no width or height' });
  add('percent.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 900 220">${svgText}</svg>`, { note: 'size in percent' });
  add('no-size.svg', `<svg xmlns="http://www.w3.org/2000/svg">${svgText}</svg>`, { note: 'no size at all' });
  add('huge.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="200000" height="100000" viewBox="0 0 900 220">${svgText}</svg>`, { note: '200000 px wide' });
  add('script.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="220" onload="alert(1)"><script>alert(2)</script><image href="https://example.com/x.png" width="10" height="10"/>${svgText}</svg>`, { note: 'scripts and an external picture' });
  add('foreign.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="220"><foreignObject width="900" height="220"><div xmlns="http://www.w3.org/1999/xhtml" style="font:36px Arial">${LINES.join('<br/>')}</div></foreignObject></svg>`, { secrets: [], note: 'HTML inside foreignObject, left out with a note' });
  add('broken.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="220"><text>Jane Doe`, { opens: false, note: 'unclosed' });
  add('bom.svg', `﻿<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="900" height="220">${svgText}</svg>`);
  add('gzip.svgz', execFileSync('gzip', ['-c'], { input: `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="220">${svgText}</svg>` }), { opens: false, note: 'compressed SVG' });
  if (existsSync('test/e2e/photo.heic')) {
    copyFileSync('test/e2e/photo.heic', path.join(out, 'photo.heic'));
    cases.push({ file: 'photo.heic', slug: '', opens: true, secrets: [], note: 'HEIC photo', group: 'heic' });
  }
  add('random.heic', rnd(3000), { opens: false });

  // Word
  add('word-basic.docx', await docx(LINES.map(para).join('')));
  add('word-split-runs.docx', await docx(`<w:p>${[...'Patient: Jane Doe jane@example.com 415-555-0132'].map((c) => `<w:r><w:t xml:space="preserve">${c}</w:t></w:r>`).join('')}</w:p>`), { note: 'one run per character' });
  add('word-entities.docx', await docx(para('Patient: Jane Doe &amp; family &lt;jane@example.com&gt; tel 415-555-0132')), { note: 'escaped < > &' });
  add('word-table.docx', await docx(`<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Jane Doe</w:t></w:r></w:p></w:tc><w:tc><w:tbl><w:tr><w:tc>${para('jane@example.com')}</w:tc></w:tr></w:tbl><w:p/></w:tc></w:tr></w:tbl>${para('415-555-0132')}`), { note: 'nested tables' });
  add('word-textbox.docx', await docx(`<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor><wp:docPr id="1" name="Box"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:txbx><w:txbxContent>${para('Jane Doe in a box')}</w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent>${para('Jane Doe in a box')}</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>${para('jane@example.com')}${para('415-555-0132')}`), { note: 'text box with VML fallback' });
  add('word-tabs-breaks.docx', await docx(`<w:p><w:r><w:t>Jane</w:t><w:tab/><w:t>Doe</w:t></w:r></w:p><w:p><w:r><w:t>jane@</w:t><w:softHyphen/><w:t>example.com</w:t></w:r></w:p><w:p><w:r><w:t>415-555-</w:t><w:noBreakHyphen/><w:t>0132</w:t></w:r></w:p>`), { secrets: ['jane@example.com'], note: 'tab, soft hyphen and no-break hyphen inside values' });
  add('word-empty.docx', await docx(''), { secrets: [] });
  add('word-no-body.docx', await (async () => {
    const z = await JSZip.loadAsync(await docx(''));
    z.remove('word/document.xml');
    return z.generateAsync({ type: 'nodebuffer' });
  })(), { opens: false, note: 'zip without word/document.xml' });
  add('word-bad-xml.docx', await (async () => {
    const z = await JSZip.loadAsync(await docx(''));
    z.file('word/document.xml', `<w:document ${W}><w:body><w:p><w:r><w:t>Jane Doe</w:t></w:r>`);
    return z.generateAsync({ type: 'nodebuffer' });
  })(), { opens: false, note: 'XML cut off' });
  add('word-random.docx', rnd(5000), { opens: false });
  add('word-truncated.docx', (await docx(LINES.map(para).join(''))).subarray(0, 600), { opens: false });
  add('word-missing-image.docx', await docx(`${para('Jane Doe')}<w:p><w:r><w:drawing><wp:inline><wp:extent cx="100" cy="100"/><wp:docPr id="1" name="x"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>${para('jane@example.com 415-555-0132')}`, {
    rels: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="${R}/image" Target="media/missing.png"/></Relationships>`,
  }), { note: 'picture whose file is missing' });
  add('word-corrupt-image.docx', await docx(`${para('Jane Doe')}<w:p><w:r><w:drawing><wp:inline><wp:extent cx="100" cy="100"/><wp:docPr id="1" name="x"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>${para('jane@example.com 415-555-0132')}`, {
    rels: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="${R}/image" Target="media/bad.png"/></Relationships>`,
    files: { 'word/media/bad.png': rnd(800) },
  }), { note: 'picture with garbage bytes' });
  {
    // A picture with black text on a transparent background, as screenshots of documents often are.
    const png = await (await textPicture(LINES, { bg: 'none' })).png().toBuffer();
    const drawing = `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="5486400" cy="1828800"/><wp:docPr id="1" name="scan"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="scan"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    add('word-transparent-picture.docx', await docx(para('See the scan.') + drawing, {
      rels: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="${R}/image" Target="media/scan.png"/></Relationships>`,
      files: { 'word/media/scan.png': png },
    }), { note: 'text only in a transparent PNG' });
  }
  add('word-big.docx', await docx(Array.from({ length: 20_000 }, (_, i) => para(`Paragraph ${i} lorem ipsum ${i === 15_000 ? LINES.join(' ') : ''}`)).join('')), { note: '20000 paragraphs' });
  add('word-macro.docm', await docx(LINES.map(para).join('')), { opens: false, note: 'macro-enabled name' });
  {
    // Real-world structure: LibreOffice writes styles, settings, numbering and fonts.
    const src = path.join(out, '_lo.txt');
    writeFileSync(src, `${body}\n\nSecond paragraph with Jane Doe again.\n`);
    try {
      soffice(src, 'docx:MS Word 2007 XML', out);
      add('libreoffice.docx', readFileSync(path.join(out, '_lo.docx')));
      soffice(src, 'odt', out);
      add('libreoffice.odt', readFileSync(path.join(out, '_lo.odt')), { opens: false, note: 'OpenDocument text' });
      const html = path.join(out, '_lo2.html');
      writeFileSync(html, `<html><body><h1>Report</h1><ul><li>Jane Doe</li><li>jane@example.com</li></ul><table border=1><tr><td>Phone</td><td>415-555-0132</td></tr></table><p style="text-align:right"><i>footnote</i></p></body></html>`);
      soffice(html, 'docx:MS Word 2007 XML', out);
      add('libreoffice-rich.docx', readFileSync(path.join(out, '_lo2.docx')), { note: 'list and table from LibreOffice' });
    } catch {
      /* LibreOffice missing */
    }
  }

  // PowerPoint
  {
    const deck = new PptxGenJS();
    deck.addSlide().addText(LINES.join('\n'), { x: 0.5, y: 0.5, w: 8, h: 2 });
    const s2 = deck.addSlide();
    s2.addTable([[{ text: 'Name' }, { text: 'Jane Doe' }], [{ text: 'Mail' }, { text: 'jane@example.com' }]], { x: 0.5, y: 0.5, w: 6 });
    s2.addNotes('Call Jane Doe on 415-555-0132');
    add('deck.pptx', await deck.write({ outputType: 'nodebuffer' }));
    const empty = new PptxGenJS();
    add('deck-empty.pptx', await empty.write({ outputType: 'nodebuffer' }), { secrets: [], note: 'no slides' });
    const blank = new PptxGenJS();
    blank.addSlide();
    add('deck-blank-slide.pptx', await blank.write({ outputType: 'nodebuffer' }), { secrets: [] });
    const many = new PptxGenJS();
    for (let i = 0; i < 120; i++) many.addSlide().addText(i === 100 ? LINES.join('\n') : `Slide ${i}`, { x: 0.5, y: 0.5, w: 8, h: 2 });
    add('deck-120.pptx', await many.write({ outputType: 'nodebuffer' }), { note: '120 slides' });
    const pics = new PptxGenJS();
    pics.addSlide().addImage({ data: `data:image/png;base64,${(await pic.clone().png().toBuffer()).toString('base64')}`, x: 0.5, y: 0.5, w: 8, h: 2.7 });
    add('deck-picture.pptx', await pics.write({ outputType: 'nodebuffer' }), { note: 'text only in a picture' });
    add('deck-random.pptx', rnd(5000), { opens: false });
    const z = await JSZip.loadAsync(await deck.write({ outputType: 'nodebuffer' }));
    z.remove('ppt/presentation.xml');
    add('deck-no-presentation.pptx', await z.generateAsync({ type: 'nodebuffer' }), { opens: false });
    try {
      const src = path.join(out, 'deck.pptx');
      soffice(src, 'odp', out);
      copyFileSync(path.join(out, 'deck.odp'), path.join(out, '_deck.odp'));
      soffice(path.join(out, '_deck.odp'), 'pptx', out);
      add('libreoffice.pptx', readFileSync(path.join(out, '_deck.pptx')), { note: 'saved by LibreOffice' });
    } catch {
      /* LibreOffice missing */
    }
  }

  // Spreadsheets
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('People');
    ws.addRow(['Name', 'Email', 'Phone', 'Born']);
    ws.addRow(['Jane Doe', 'jane@example.com', '415-555-0132', new Date('1985-03-15')]);
    ws.addRow([{ richText: [{ text: 'Jane ' }, { text: 'Doe', font: { bold: true } }] }, { formula: 'CONCAT("jane","@example.com")', result: 'jane@example.com' }, 4155550132]);
    ws.mergeCells('A5:C5');
    ws.getCell('A5').value = 'Merged: Jane Doe';
    ws.getCell('B2').note = 'Checked by Jane Doe';
    add('sheet.xlsx', await wb.xlsx.writeBuffer().then(Buffer.from));
    const odd = new ExcelJS.Workbook();
    odd.addWorksheet("It's <&> \"odd\"").addRow(['Jane Doe', 'jane@example.com', '415-555-0132']);
    odd.addWorksheet('Hidden', { state: 'hidden' }).addRow(['jane@example.com']);
    odd.addWorksheet('Empty');
    add('sheet-odd-names.xlsx', await odd.xlsx.writeBuffer().then(Buffer.from), { note: 'quotes and & in sheet names, hidden and empty sheets' });
    const empty = new ExcelJS.Workbook();
    empty.addWorksheet('Sheet1');
    add('sheet-empty.xlsx', await empty.xlsx.writeBuffer().then(Buffer.from), { secrets: [] });
    const big = new ExcelJS.Workbook();
    const bs = big.addWorksheet('Big');
    for (let r = 0; r < 20_000; r++) bs.addRow([`row ${r}`, r, r === 19_000 ? 'Jane Doe jane@example.com 415-555-0132' : `x${r}`, r * 2, `y${r}`]);
    add('sheet-100k-cells.xlsx', await big.xlsx.writeBuffer().then(Buffer.from), { note: '100k cells' });
    const far = new ExcelJS.Workbook();
    const fs2 = far.addWorksheet('Far');
    fs2.getCell('XFD1048576').value = 'Jane Doe';
    fs2.getCell('A1').value = 'jane@example.com 415-555-0132';
    add('sheet-far-cell.xlsx', await far.xlsx.writeBuffer().then(Buffer.from), { note: 'a cell at XFD1048576' });
    add('sheet-random.xlsx', rnd(5000), { opens: false });
    add('sheet-xls-named.xlsx', Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), rnd(4000)]), { opens: false, note: 'old .xls bytes with a .xlsx name' });
    add('old.xls', Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), { opens: false });
    try {
      const src = path.join(out, 'sheet.xlsx');
      soffice(src, 'ods', out);
      add('sheet.ods', readFileSync(path.join(out, 'sheet.ods')).subarray(0), { note: 'saved by LibreOffice' });
      copyFileSync(path.join(out, 'sheet.ods'), path.join(out, '_s.ods'));
      soffice(path.join(out, '_s.ods'), 'xlsx', out);
      add('libreoffice.xlsx', readFileSync(path.join(out, '_s.xlsx')), { note: 'saved by LibreOffice' });
    } catch {
      /* LibreOffice missing */
    }
  }

  // Audio: speech is stood in for by /api/transcribe, so only decoding and export are real.
  add('tone.wav', wav(3));
  add('stereo-48k.wav', wav(3, { rate: 48000, channels: 2 }));
  add('8bit-8k.wav', wav(3, { rate: 8000, bits: '8' }));
  add('short.wav', wav(0.05), { secrets: [], note: '50 ms' });
  add('silent-header.wav', wav(0), { opens: false, note: 'header only' });
  add('random.mp3', rnd(20_000), { opens: false });
  add('truncated.wav', wav(3).subarray(0, 30), { opens: false });
  {
    const src = path.join(out, 'tone.wav');
    for (const [name, args, note] of [
      ['tone.mp3', ['-b:a', '64k'], ''],
      ['tone.m4a', ['-c:a', 'aac'], ''],
      ['tone.ogg', ['-c:a', 'libvorbis'], 'Vorbis'],
      ['tone.opus', ['-c:a', 'libopus'], ''],
      ['tone.flac', [], ''],
      ['tone.aac', ['-c:a', 'aac', '-f', 'adts'], 'ADTS'],
      ['video.webm', ['-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=3', '-shortest', '-c:a', 'libopus', '-c:v', 'libvpx'], 'has a video track'],
      ['tagged.mp3', ['-metadata', 'title=Call with Jane Doe', '-metadata', 'artist=jane@example.com'], 'ID3 tags'],
      ['long-9min.mp3', ['-f', 'lavfi', '-i', 'sine=frequency=300:duration=540', '-map', '1:a', '-b:a', '32k'], '9 minutes, three parts'],
    ]) {
      try {
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, ...args, path.join(out, name)], { timeout: 120_000 });
        cases.push({ file: name, slug: '', opens: name !== 'video.webm', secrets: SECRETS, note, group: path.extname(name).slice(1) });
      } catch {
        /* ffmpeg missing or codec missing */
      }
    }
  }
  // Parts a browser's XML parser rejects, holding secrets: the download must not keep them as they are.
  {
    const utf16 = (xml) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml.replace('encoding="UTF-8"', 'encoding="UTF-16"'), 'utf16le')]);
    const hdr = (t) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${W}><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:hdr>`;
    add('word-utf16-header.docx', await docx(para('Body text') + para('jane@example.com 415-555-0132'), { files: { 'word/header1.xml': utf16(hdr('Jane Doe')) } }), { note: 'header saved as UTF-16' });
    add('word-bad-char-header.docx', await docx(para('Body text') + para('jane@example.com 415-555-0132'), { files: { 'word/header1.xml': hdr('Jane Doe&#1;') } }), { secrets: ['jane@example.com', '415-555-0132'], note: 'header with a character XML forbids' });
    add('word-utf16-body.docx', await (async () => {
      const z = await JSZip.loadAsync(await docx(LINES.map(para).join('')));
      z.file('word/document.xml', utf16(await z.file('word/document.xml').async('string')));
      return z.generateAsync({ type: 'nodebuffer' });
    })(), { note: 'body saved as UTF-16' });
    const deck = new PptxGenJS();
    deck.addSlide().addText('Jane Doe', { x: 0.5, y: 0.5, w: 8, h: 1 });
    deck.addSlide().addText('jane@example.com 415-555-0132', { x: 0.5, y: 0.5, w: 8, h: 1 });
    const z = await JSZip.loadAsync(await deck.write({ outputType: 'nodebuffer' }));
    z.file('ppt/slides/slide2.xml', (await z.file('ppt/slides/slide2.xml').async('string')).replace('415-555-0132', '415-555-0132&#1;'));
    add('deck-bad-char-slide.pptx', await z.generateAsync({ type: 'nodebuffer' }), { secrets: ['Jane Doe'], note: 'slide with a character XML forbids' });
    const z2 = await JSZip.loadAsync(await deck.write({ outputType: 'nodebuffer' }));
    z2.file('ppt/slides/slide2.xml', utf16(await z2.file('ppt/slides/slide2.xml').async('string')));
    add('deck-utf16-slide.pptx', await z2.generateAsync({ type: 'nodebuffer' }), { note: 'slide saved as UTF-16' });
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('A').addRow(['Jane Doe', 'jane@example.com']);
    wb.addWorksheet('B').addRow(['415-555-0132']);
    const z3 = await JSZip.loadAsync(Buffer.from(await wb.xlsx.writeBuffer()));
    const sst = Object.keys(z3.files).find((n) => /sharedStrings/.test(n));
    z3.file(sst, (await z3.file(sst).async('string')).replace('Jane Doe', 'Jane Doe&#1;'));
    add('sheet-bad-char-strings.xlsx', await z3.generateAsync({ type: 'nodebuffer' }), { secrets: [], note: 'shared strings with a character XML forbids' });
    const z4 = await JSZip.loadAsync(Buffer.from(await wb.xlsx.writeBuffer()));
    z4.file(sst, utf16(await z4.file(sst).async('string')));
    add('sheet-utf16-strings.xlsx', await z4.generateAsync({ type: 'nodebuffer' }), { note: 'shared strings saved as UTF-16' });
  }

  // Mutants: damaged copies of valid files. Each may open or be refused, but must never hang or crash the page.
  const MUTANT_SEEDS = ['plain.txt', 'valid.json', 'text.pdf', 'form.pdf', 'text.png', 'text.jpg', 'text.tiff', 'plain.svg', 'word-basic.docx', 'libreoffice-rich.docx', 'deck.pptx', 'sheet.xlsx', 'sheet.ods', 'tone.wav', 'tone.mp3'];
  let seedNo = 1;
  for (const seedFile of MUTANT_SEEDS) {
    if (!existsSync(path.join(out, seedFile))) continue;
    const orig = readFileSync(path.join(out, seedFile));
    const ext = path.extname(seedFile);
    for (let m = 0; m < 6; m++) {
      const noise = rnd(64, seedNo++);
      const at = (k) => Math.floor((noise[k] / 256) * orig.length);
      let data = Buffer.from(orig);
      let how;
      if (/\.(docx|pptx|xlsx|ods)$/.test(ext) && m < 4) {
        // Damage one XML part inside the zip, so the zip itself still opens.
        const z = await JSZip.loadAsync(orig);
        const parts = Object.keys(z.files).filter((n) => n.endsWith('.xml') && !z.files[n].dir);
        const part = parts[noise[1] % parts.length];
        let xml = await z.file(part).async('string');
        const a = Math.floor((noise[2] / 256) * xml.length);
        const b = Math.min(xml.length, a + 1 + noise[3] * 4);
        how = ['cut a stretch from', 'doubled a stretch in', 'put garbage in', 'cut the end off'][m];
        xml = m === 0 ? xml.slice(0, a) + xml.slice(b) : m === 1 ? xml.slice(0, b) + xml.slice(a, b) + xml.slice(b) : m === 2 ? xml.slice(0, a) + '<&\u0000"' + xml.slice(a) : xml.slice(0, a);
        z.file(part, xml);
        data = await z.generateAsync({ type: 'nodebuffer' });
        how += ` ${part}`;
      } else if (m % 3 === 0) {
        data = data.subarray(0, at(0));
        how = `cut at byte ${data.length}`;
      } else if (m % 3 === 1) {
        for (let k = 0; k < 8; k++) data[at(k + 8)] ^= 1 << (noise[k + 20] % 8);
        how = 'flipped 8 bits';
      } else {
        const a = at(4);
        data = Buffer.concat([data.subarray(0, a), rnd(200, seedNo), data.subarray(a)]);
        how = `200 random bytes at ${a}`;
      }
      const name = `mut-${m}-${seedFile.replace(/^\./, '')}`;
      writeFileSync(path.join(out, name), data);
      cases.push({ file: name, slug: seedFile.endsWith('-on-sheet.csv') ? 'redact-excel' : '', opens: null, secrets: [], note: how, group: 'mutant' });
    }
  }
  writeFileSync(path.join(out, 'cases.json'), JSON.stringify(cases, null, 1));
  return cases;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cases = await build(path.resolve(process.argv[2] || 'fuzz-out'));
  console.log(`${cases.length} files`);
}
