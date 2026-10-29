// End-to-end check of every format in a real browser.
// Usage: npm run dev:local (in another shell), then node test/e2e/run.mjs <outdir>
import { createRequire } from 'node:module';
import exifr from 'exifr';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Playwright is not a dependency; use a globally installed copy.
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:8787';
const out = path.resolve(process.argv[2] || 'e2e-out');
mkdirSync(out, { recursive: true });
const fx = (f) => path.join(out, f);
const { withMetadata } = await import('./fixtures.mjs'); // fixtures.mjs writes into argv[2]

const browser = await chromium.launch();
const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
const errors = [];
const apiCalls = [];
// Only requests that carry document content count; /api/quota sends just the browser ID.
page.on('request', (r) => /\/api\/(detect|check)/.test(r.url()) && apiCalls.push(r.url()));
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
let failed = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed++;
};

// Stands in for the model: returns each known value as it appears in the text.
const AI_VALUES = [
  ['Jane Doe', 'name'], ['Maria Gonzalez', 'name'], ['jane@example.com', 'email'], ['jane.doe@example.com', 'email'], ['bob@corp.io', 'email'],
  ['+1 (415) 555-0132', 'phone'], ['415-555- 0132', 'phone'], ['415-555- 0199', 'phone'], ['0800 123 4567', 'phone', 'organization'],
  ['415-555-0177', 'phone'], ['4155550132', 'phone'], ['15/03/1985', 'date'],
  ['10.0.0.12', 'ip'], ['123-45-6789', 'ssn'], ['4111 1111 1111 1111', 'card'],
];
async function fakeDetect(route) {
  const { text } = JSON.parse(route.request().postData() || '{}');
  const entities = [];
  for (const [value, type, owner] of AI_VALUES) {
    const re = new RegExp(value.split(/\s+/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'));
    const m = text.match(re);
    if (m) entities.push({ text: m[0], type, owner: owner ?? 'person' });
  }
  route.fulfill({ contentType: 'application/json', body: JSON.stringify({ entities, checkToken: 'scan-token' }) });
}
await page.route('**/api/detect', fakeDetect);

/** Opens a file and, unless waiting for something else, agrees to the upload. */
async function run(slug, file, wait = 'label.finding') {
  await page.goto(`${BASE}/${slug}`);
  await page.setInputFiles('#file-input', file);
  if (wait === 'label.finding') {
    await page.waitForSelector('.consent button.primary', { timeout: 90_000 });
    await page.click('.consent button.primary');
  }
  await page.waitForSelector(wait, { timeout: 90_000 });
  return page.$$eval('label.finding .ftext', (els) => els.map((e) => e.textContent));
}

async function download(name) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.panel-foot > button.primary')]);
  const p = fx(name);
  await dl.saveAs(p);
  return { path: p, filename: dl.suggestedFilename() };
}

// Text
{
  const found = await run('redact-text', fx('sample.txt'));
  check(found.includes('jane@example.com') && found.includes('415-555-0132') && found.includes('10.0.0.12'), `text findings: ${found.join(', ')}`);
  await page.fill('textarea[aria-label="Words to always redact"]', 'Jane Doe');
  await page.waitForFunction(() => [...document.querySelectorAll('.ftext')].some((e) => e.textContent === 'Jane Doe'));
  await page.screenshot({ path: fx('text.png'), fullPage: false });
  const { path: p, filename } = await download('out.txt');
  const txt = readFileSync(p, 'utf8');
  check(filename === 'sample-redacted.txt', `text filename ${filename}`);
  check(txt.includes('Next steps') && txt.includes('0800 123 4567'), 'text keeps headings and helpline numbers');
  check(!/jane|415|0199|10\.0\.0/i.test(txt), `text output: ${JSON.stringify(txt)}`);
}

// Selected text, redacted in one spot only
{
  await page.goto(`${BASE}/redact-text`);
  await page.setInputFiles('#file-input', fx('sample.txt'));
  await page.waitForSelector('.unit');
  await page.evaluate(() => {
    const unit = document.querySelector('.unit');
    const w = document.createTreeWalker(unit, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const at = n.data.indexOf('Server');
      if (at >= 0) {
        const r = document.createRange();
        r.setStart(n, at);
        r.setEnd(n, at + 6);
        getSelection().removeAllRanges();
        getSelection().addRange(r);
        unit.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return;
      }
    }
  });
  check((await page.evaluate(() => CSS.highlights.get('same-text')?.size)) === 1, 'selection marks where its text appears');
  await page.click('.sel-add >> text=Redact here');
  await page.waitForFunction(() => [...document.querySelectorAll('.ftext')].some((e) => e.textContent === 'Server'));
  check(!(await page.evaluate(() => CSS.highlights.has('same-text'))), 'matches cleared once redacted');
  const { path: p } = await download('pick.txt');
  const txt = readFileSync(p, 'utf8');
  const terms = await page.inputValue('textarea[aria-label="Words to always redact"]');
  check(txt.includes('\n██████: ') && !terms, `one spot redacted, no term added: ${JSON.stringify(txt)}`);
  // A drag released outside the text box still offers the selection.
  const at = await page.evaluate(() => {
    const n = document.querySelector('.unit').firstChild;
    const r = document.createRange();
    r.setStart(n, 0);
    r.setEnd(n, 4);
    const b = r.getBoundingClientRect();
    return { x: b.x + 1, y: b.y + b.height / 2 };
  });
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 300, at.y + 600, { steps: 8 });
  await page.mouse.up();
  check((await page.locator('.sel-add').count()) === 1, 'drag released outside the text offers to redact');
  await page.mouse.click(5, 5);
}

// DOCX
{
  const found = await run('redact-word', fx('sample.docx'));
  check(found.includes('bob@corp.io') && found.includes('123-45-6789'), `docx findings: ${found.join(', ')}`);
  // The address spans two runs, so it shows as two pieces of one highlight.
  const email = await page.$$eval('.sheet section.docx mark.on', (m) => m.filter((e) => e.dataset.key === m.find((x) => x.textContent === 'bob@')?.dataset.key).map((e) => e.textContent).join(''));
  check(email === 'bob@corp.io', `docx highlights sit on the laid-out page: ${email}`);
  const mark = page.locator('.sheet mark', { hasText: '123-45-6789' }).first();
  await mark.click();
  check((await mark.getAttribute('class')) === 'off', 'docx clicking a highlight on the page keeps it');
  await mark.click();
  check((await mark.getAttribute('class')) === 'on', 'docx clicking a kept highlight on the page redacts it');
  // Selecting a word on the page redacts that spot.
  await page.evaluate(() => {
    const sheet = document.querySelector('.sheet');
    const w = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const at = n.data.indexOf('today');
      if (at >= 0) {
        const r = document.createRange();
        r.setStart(n, at);
        r.setEnd(n, at + 5);
        getSelection().removeAllRanges();
        getSelection().addRange(r);
        n.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return;
      }
    }
  });
  await page.click('.sel-add >> text=Redact here');
  await page.waitForFunction(() => [...document.querySelectorAll('.sheet mark.on')].some((e) => e.textContent === 'today'));
  await page.screenshot({ path: fx('docx.png') });
  const { path: p } = await download('out.docx');
  const zip = await JSZip.loadAsync(readFileSync(p));
  const doc = await zip.file('word/document.xml').async('string');
  const rels = await zip.file('word/_rels/document.xml.rels').async('string');
  const core = await zip.file('docProps/core.xml').async('string');
  check(!doc.includes('bob@') && !doc.includes('corp.io') && !doc.includes('123-45') && doc.includes('Contact: '), 'docx body redacted, formatting text kept');
  check(!/Gonzalez|0132|0199/.test(doc) && doc.includes('<w:br/>'), 'docx name and wrapped phones redacted, line break kept');
  check(!doc.includes('Bob Author') && !core.includes('Bob Author'), 'docx authors removed');
  check(!rels.includes('mailto'), 'docx hyperlink target removed');
  check(!doc.includes('anyredact-'), 'docx download has no layout bookmarks');
  check(!doc.includes('today') && doc.includes('Call '), 'docx spot picked on the page redacted');
  check(!doc.includes('jane@example.com') && doc.includes('growth=5%'), 'docx simple field code redacted');
  const store = await zip.file('customXml/item1.xml').async('string');
  check(!doc.includes('dataBinding') && !store.includes('123-45'), 'docx bound content control unbound and its data redacted');
}

// DOCX with pictures
{
  const found = await run('redact-word', fx('pictures.docx'));
  check(found.includes('123-45-6789') && found.includes('415-555-0132'), `docx picture and alt text findings: ${found.join(', ')}`);
  check((await page.$$('.sheet .page.placed')).length === 2, 'docx shows both pictures in place');
  check((await page.$$('.text-preview .unit')).length >= 1, 'docx shows alt text below the pages');
  await page.screenshot({ path: fx('docx-pictures.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: fx('docx-pictures-phone.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  const { path: p } = await download('out-pictures.docx');
  const zip = await JSZip.loadAsync(readFileSync(p));
  const photo = await zip.file('word/media/image1.jpeg').async('nodebuffer');
  const tags = await exifr.parse(photo, { gps: true }).catch(() => null);
  check(!tags?.latitude && !tags?.Artist && !tags?.Make, `docx picture metadata stripped: ${JSON.stringify(tags)}`);
  // The SSN number sits at x 150 to 430, y 170 to 215 in the 900x300 photo; a burned box makes it dark.
  const { channels } = await sharp(await sharp(photo).extract({ left: 160, top: 178, width: 250, height: 30 }).toBuffer()).stats();
  check(channels[0].mean < 60, `docx picture SSN covered (mean ${channels[0].mean.toFixed(0)})`);
  const doc = await zip.file('word/document.xml').async('string');
  check(!doc.includes('0132') && !doc.includes('passport'), 'docx alt text and picture file names redacted');
  const rels = await zip.file('word/_rels/document.xml.rels').async('string');
  const types = await zip.file('[Content_Types].xml').async('string');
  check(!zip.file('word/media/image2.gif') && zip.file('word/media/image2.png') && rels.includes('media/image2.png') && types.includes('Extension="png"'), 'docx GIF saved as PNG and relinked');
  const root = await zip.file('_rels/.rels').async('string');
  check(!zip.file('docProps/thumbnail.jpeg') && !root.includes('thumbnail'), 'docx thumbnail removed');
}

// PowerPoint
{
  const found = await run('redact-powerpoint', fx('sample.pptx'));
  check(['jane.doe@example.com', 'bob@corp.io', '+1 (415) 555-0132', 'Maria Gonzalez', '123-45-6789', '4111 1111 1111 1111', '415-555-0177', '415-555-0199'].every((f) => found.includes(f)), `pptx findings: ${found.join(', ')}`);
  check((await page.$$('.sheet .slide-page')).length === 4, 'pptx shows every slide');
  const email = await page.$$eval('.sheet .slide-page mark.on', (m) => m.map((e) => e.textContent));
  check(email.includes('jane.doe@example.com') && email.includes('4111 1111 1111 1111'), `pptx highlights sit on the slides: ${email.join(', ')}`);
  check((await page.$$('.sheet .page.placed')).length === 1, 'pptx shows the picture in place');
  const notes = await page.textContent('.notes');
  check(notes.includes('Includes hidden slides: 4') && notes.includes('Embedded files and chart data are removed'), `pptx hidden slide flagged: ${notes}`);
  const rest = await page.textContent('.text-preview');
  check(rest.includes('Slide 1 notes') && rest.includes('Slide 1 comments') && rest.includes('Slide 3 chart') && rest.includes('Alt text'), 'pptx lists notes, comments, chart text and alt text below the slides');
  await page.screenshot({ path: fx('pptx.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: fx('pptx-phone.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  const { path: p, filename } = await download('out.pptx');
  check(filename === 'sample-redacted.pptx', `pptx filename ${filename}`);
  const zip = await JSZip.loadAsync(readFileSync(p));
  const all = (await Promise.all(Object.keys(zip.files).filter((n) => n.endsWith('.xml') || n.endsWith('.rels')).map((n) => zip.file(n).async('string')))).join('\n');
  check(!/jane\.doe|corp\.io|0132|0177|0199|Gonzalez|123-45|4111|Bob Author|Acme/.test(all), 'pptx slides, notes, comments, links, alt text and authors redacted');
  const slide = await zip.file('ppt/slides/slide1.xml').async('string');
  check(slide.includes('Onboarding: ') && slide.includes('srgbClr val="1F3A5F"'), 'pptx formatting kept');
  check(!zip.file('docProps/thumbnail.jpeg'), 'pptx thumbnail removed');
  const chart = await zip.file('ppt/charts/chart1.xml').async('string');
  check(!Object.keys(zip.files).some((n) => n.startsWith('ppt/embeddings/') && !zip.files[n].dir) && !chart.includes('externalData') && chart.includes('Team B'), 'pptx chart labels redacted, workbook removed');
  const photo = await zip.file(Object.keys(zip.files).find((n) => n.startsWith('ppt/media/') && !zip.files[n].dir)).async('nodebuffer');
  const tags = await exifr.parse(photo, { gps: true }).catch(() => null);
  check(!tags?.latitude && !tags?.Make, `pptx picture metadata stripped: ${JSON.stringify(tags)}`);
  const { channels } = await sharp(await sharp(photo).extract({ left: 160, top: 178, width: 250, height: 30 }).toBuffer()).stats();
  check(channels[0].mean < 60, `pptx picture SSN covered (mean ${channels[0].mean.toFixed(0)})`);
}

// DOCX with a chart: labels found and redacted, the workbook behind it removed
{
  const found = await run('redact-word', fx('chart.docx'));
  check(found.includes('Maria Gonzalez') && found.includes('Jane Doe'), `docx chart findings: ${found.join(', ')}`);
  const { path: p } = await download('out-chart.docx');
  const zip = await JSZip.loadAsync(readFileSync(p));
  const chart = await zip.file('word/charts/chart1.xml').async('string');
  const rels = await zip.file('word/charts/_rels/chart1.xml.rels').async('string');
  check(!/Gonzalez|Jane/.test(chart) && chart.includes('Team B') && !chart.includes('externalData'), 'docx chart text redacted');
  check(!Object.keys(zip.files).some((n) => n.startsWith('word/embeddings/') && !zip.files[n].dir) && !rels.includes('embeddings'), 'docx chart workbook removed');
}

// PowerPoint: markup smuggled in through a chart stays out of the page
{
  await run('redact-powerpoint', fx('injected.pptx'), '.sheet .slide-page');
  await page.waitForTimeout(500);
  check(!(await page.$('#injected, #injected-link')), 'pptx markup from the file is dropped');
  check((await page.$$('.sheet .slide-page svg path, .sheet .slide-page svg circle')).length > 0, 'pptx chart still drawn');
}

// Spreadsheets
{
  const found = await run('redact-excel', fx('sample.xlsx'));
  check(['jane.doe@example.com', 'bob@corp.io', '415-555-0199', '415-555-0177', '4155550132', '123-45-6789', '15/03/1985'].every((f) => found.includes(f)), `xlsx findings: ${found.join(', ')}`);
  const notes = await page.textContent('.notes');
  check(notes.includes('Includes hidden sheets: Old'), `xlsx hidden sheet flagged: ${notes}`);
  // The grid: one tab per sheet, hidden ones included, and a click on a highlight keeps it.
  await page.waitForSelector('.sheet-view >> text=Old (hidden)');
  check((await page.locator('.sheet-view >> text=Orders').count()) === 1, 'xlsx grid shows every sheet tab');
  await page.evaluate(() => document.querySelector('.preview').scrollIntoView());
  const grid = await page.locator('.sheet-view').boundingBox();
  const bob = page.locator('label.finding', { hasText: 'bob@corp.io' }).locator('input');
  await page.waitForTimeout(1000); // the grid takes a moment to start listening after it draws
  await page.mouse.click(grid.x + 260, grid.y + 71); // cell B3
  await page.waitForFunction(() => ![...document.querySelectorAll('label.finding')].find((l) => l.textContent.includes('bob@corp.io'))?.querySelector('input').checked);
  check(!(await bob.isChecked()), 'xlsx clicking a highlight keeps it');
  check((await page.textContent('.cell-bar .cell-ref')) === 'B3' && (await page.locator('.cell-bar mark', { hasText: 'bob@corp.io' }).count()) === 1, 'xlsx cell bar shows the clicked cell with its highlights');
  await bob.check();
  await page.evaluate(() => document.querySelector('.preview').scrollIntoView());
  await page.screenshot({ path: fx('xlsx.png') });
  await page.click('.sheet-view >> text=Orders');
  await page.waitForTimeout(500);
  await page.screenshot({ path: fx('xlsx-orders.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: fx('xlsx-phone.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  const { path: p, filename } = await download('out.xlsx');
  check(filename === 'sample-redacted.xlsx', `xlsx filename ${filename}`);
  const zip = await JSZip.loadAsync(readFileSync(p));
  const xml = (await Promise.all(Object.values(zip.files).filter((f) => !f.dir).map((f) => f.async('string')))).join('\n');
  check(!/jane|Jane Doe|bob@|corp\.io|0199|0177|123-45|Bob Author|Acme/.test(xml), 'xlsx has no redacted values, authors or company left');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(readFileSync(p));
  const s = book.getWorksheet('Customers');
  check(s.getCell('A1').font?.bold && s.getCell('A1').fill?.fgColor?.argb === 'FFFFE699' && s.getColumn(2).width === 28, 'xlsx styles and widths kept');
  check(s.getCell('A2').value === 'Customer' && s.getCell('D3').value === 'Helpline: 0800 123 4567', 'xlsx untouched cells kept');
  check(/^█+$/.test(s.getCell('B2').value) && /^█+$/.test(s.getCell('C2').value) && !s.getCell('D2').formula, `xlsx cells redacted: ${s.getCell('B2').value} ${s.getCell('C2').value}`);
  check(book.getWorksheet('Old').state === 'hidden', 'xlsx hidden sheet stays hidden');
  check(/^[█/]+$/.test(s.getCell('B4').value) && !xml.includes('31121'), `xlsx date of birth found as shown and redacted: ${s.getCell('B4').value}`);
}
if (existsSync(fx('sample.ods'))) {
  const found = await run('redact-excel', fx('sample.ods'));
  check(found.includes('jane.doe@example.com') && found.includes('123-45-6789') && found.includes('4155550132'), `ods findings: ${found.join(', ')}`);
  await page.waitForSelector('.sheet-view >> text=Old (hidden)');
  check((await page.textContent('.notes')).includes('Includes hidden sheets: Old'), 'ods hidden sheet flagged');
  const { path: p, filename } = await download('out.ods');
  const zip = await JSZip.loadAsync(readFileSync(p));
  const content = await zip.file('content.xml').async('string');
  check(filename === 'sample-redacted.ods' && Object.keys(zip.files)[0] === 'mimetype', 'ods filename and mimetype first');
  check(!/jane|bob@|0199|0177|123-45|4155550132/.test(content) && content.includes('Helpline: 0800 123 4567'), 'ods cells redacted');
  check(!/Bob Author/.test(await zip.file('meta.xml').async('string')) && !zip.file('Thumbnails/thumbnail.png'), 'ods author and thumbnail removed');
} else console.log('skip ods (LibreOffice not installed)');

// PDF
{
  const found = await run('redact-pdf', fx('sample.pdf'));
  check(found.includes('jane.doe@example.com') && found.includes('+1 (415) 555-0132') && found.includes('4111 1111 1111 1111'), `pdf findings: ${found.join(', ')}`);
  // Draw a manual box over the name line.
  const box = await page.locator('.page-overlay').first().boundingBox();
  await page.mouse.move(box.x + box.width * 0.11, box.y + box.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.13, { steps: 5 });
  await page.mouse.up();
  check((await page.textContent('.findings')).includes('hand-drawn box'), 'pdf manual box added');
  await page.screenshot({ path: fx('pdf.png') });
  const { path: p } = await download('out.pdf');
  const bytes = readFileSync(p);
  const pdf = await PDFDocument.load(bytes);
  check(pdf.getPageCount() === 1 && Math.round(pdf.getPage(0).getWidth()) === 612, 'pdf page size kept');
  check(!bytes.toString('latin1').includes('jane') && pdf.getAuthor() === undefined, 'pdf has no original text or author');
  const [jpg] = [...bytes.toString('latin1').matchAll(/\xFF\xD8[\s\S]*?\xFF\xD9/g)].map((m) => Buffer.from(m[0], 'latin1'));
  const meta = await sharp(jpg).metadata();
  const s = meta.width / 612;
  // The field sits at x 72 to 372, y 520 to 550 in PDF points (from the bottom).
  const { channels } = await sharp(jpg).extract({ left: Math.round(72 * s), top: Math.round((792 - 550) * s), width: Math.round(300 * s), height: Math.round(30 * s) }).stats();
  check(channels[0].min < 100, `pdf form field value drawn on the page (min ${channels[0].min})`);
}

// Image (OCR loads from CDN, so allow time)
{
  await page.setContent('<div id="x" style="font:28px Arial;padding:30px;background:#fff;width:700px">Support ticket from Jane<br>Email: jane.doe@example.com<br>Phone: 415-555-0132</div>');
  await page.locator('#x').screenshot({ path: fx('sample.png') });
  const found = await run('redact-image', fx('sample.png'));
  check(found.some((f) => f.includes('jane.doe@example.com')), `image findings: ${found.join(', ')}`);
  await page.screenshot({ path: fx('image.png') });
  const { filename } = await download('out.png');
  check(filename === 'sample-redacted.png', `image filename ${filename}`);
}

// Image metadata: listed in the panel, gone from the download
{
  writeFileSync(fx('photo.jpg'), await withMetadata(await page.screenshot({ type: 'jpeg' })));
  await run('redact-image', fx('photo.jpg'), '.meta dl');
  const meta = await page.$$eval('.meta > dl dt, .meta > dl dd', (els) => els.map((e) => e.textContent));
  const value = (label) => meta[meta.indexOf(label) + 1];
  check(value('Location') === '37.77500, -122.42000' && value('Camera') === 'Canon EOS R6' && value('Author') === 'Jane Doe' && value('Place') === 'San Francisco', `metadata listed: ${meta.join(' | ')}`);
  await page.locator('.meta').scrollIntoViewIfNeeded();
  await page.screenshot({ path: fx('metadata.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  // Phones show the panel under the Found tab.
  await page.click('.tabs [data-view="found"]');
  await page.locator('.meta').scrollIntoViewIfNeeded();
  await page.screenshot({ path: fx('metadata-phone.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  const { path: p, filename } = await download('photo-out.jpg');
  const left = await exifr.parse(readFileSync(p), { xmp: true, iptc: true, mergeOutput: true }).catch(() => undefined);
  check(filename === 'photo-redacted.jpg' && !left, `metadata stripped from ${filename}: ${JSON.stringify(left)}`);
}

// iPhone photo (HEIC): decoded in the browser, metadata listed, saved as JPG
{
  await run('redact-image', path.join(import.meta.dirname, 'photo.heic'));
  const found = await page.$$eval('label.finding .ftext', (els) => els.map((e) => e.textContent));
  check(found.some((f) => f.includes('jane.doe@example.com')), `heic findings: ${found.join(', ')}`);
  const meta = await page.$$eval('.meta > dl dt, .meta > dl dd', (els) => els.map((e) => e.textContent));
  check(meta[meta.indexOf('Camera') + 1] === 'Apple iPhone 17 Pro' && meta.includes('Location'), `heic metadata listed: ${meta.join(' | ')}`);
  await page.screenshot({ path: fx('heic.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: fx('heic-phone.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  const { path: p, filename } = await download('photo-heic-out.jpg');
  const info = await sharp(readFileSync(p)).metadata();
  const left = await exifr.parse(readFileSync(p)).catch(() => undefined);
  check(filename === 'photo-redacted.jpg' && info.format === 'jpeg' && info.width === 760 && !left, `heic saved as ${filename} (${info.format} ${info.width}px)`);
}

// More image formats: multi-page TIFF stays TIFF, animated GIF keeps one frame, SVG is flattened to PNG
{
  const card = (t) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="300"><rect width="100%" height="100%" fill="#fff"/><text x="30" y="160" font-family="Arial" font-size="40">${t}</text></svg>`)).png().toBuffer();
  const pages = [await card('Email: jane.doe@example.com'), await card('Contact bob@corp.io today')];
  writeFileSync(fx('scan.tiff'), await sharp(pages, { join: { animated: true } }).tiff({ compression: 'lzw' }).toBuffer());
  let found = await run('redact-image', fx('scan.tiff'));
  check(found.some((f) => f.includes('jane.doe@example.com')) && found.some((f) => f.includes('bob@corp.io')) && (await page.locator('.page-img').count()) === 2, `tiff findings on 2 pages: ${found.join(', ')}`);
  await page.screenshot({ path: fx('tiff.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: fx('tiff-phone.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  let { path: p, filename } = await download('scan-out.tiff');
  const tiff = await sharp(readFileSync(p), { pages: -1 }).metadata();
  const box = await sharp(readFileSync(p), { page: 1 }).extract({ left: 190, top: 130, width: 200, height: 40 }).greyscale().raw().toBuffer();
  const mean = box.reduce((a, v) => a + v, 0) / box.length;
  check(filename === 'scan-redacted.tiff' && tiff.format === 'tiff' && tiff.pages === 2 && tiff.width === 800 && mean < 20, `tiff saved as ${filename} (${tiff.format}, ${tiff.pages} pages, ${tiff.width}px, page 2 box mean ${mean.toFixed(0)})`);

  writeFileSync(fx('animated.gif'), await sharp(pages, { join: { animated: true } }).gif().toBuffer());
  found = await run('redact-image', fx('animated.gif'));
  const notes = await page.locator('.notes, .note').allTextContents();
  check(found.some((f) => f.includes('jane.doe@example.com')) && notes.join(' ').includes('first frame'), `gif first frame: ${found.join(', ')} | ${notes.join(' ')}`);
  ({ filename } = await download('animated-out.png'));
  check(filename === 'animated-redacted.png', `gif saved as ${filename}`);

  writeFileSync(fx('photo.avif'), await sharp(pages[0]).avif().toBuffer());
  found = await run('redact-image', fx('photo.avif'));
  ({ path: p, filename } = await download('photo-out.webp'));
  check(found.some((f) => f.includes('jane.doe@example.com')) && filename === 'photo-redacted.webp' && (await sharp(readFileSync(p)).metadata()).format === 'webp', `avif saved as ${filename}`);

  const drawing = `<svg xmlns="http://www.w3.org/2000/svg" width="105.8333mm" height="39.6875mm"><title>Org chart for Jane Doe</title><metadata>Made by bob@corp.io</metadata><script>parent.svgRan = true</script><image href="https://example.com/track.png" width="1" height="1"/><a href="https://example.com/jane"><text x="10" y="80" font-family="Arial" font-size="20">Manager: jane.doe@example.com</text></a></svg>`;
  writeFileSync(fx('chart.svg'), drawing);
  const external = [];
  const onRequest = (r) => r.url().includes('example.com') && external.push(r.url());
  page.on('request', onRequest);
  found = await run('redact-image', fx('chart.svg'));
  const meta = await page.$$eval('.meta > dl dt, .meta > dl dd', (els) => els.map((e) => e.textContent));
  check(found.some((f) => f.includes('jane.doe@example.com')) && meta.includes('Org chart for Jane Doe') && meta.includes('https://example.com/jane'), `svg findings and metadata: ${found.join(', ')} | ${meta.join(' | ')}`);
  await page.screenshot({ path: fx('svg.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: fx('svg-phone.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  ({ path: p, filename } = await download('chart-out.png'));
  const svgInfo = await sharp(readFileSync(p)).metadata();
  check(filename === 'chart-redacted.png' && svgInfo.format === 'png' && svgInfo.width === 1600 && !(await page.evaluate(() => window.svgRan)) && !external.length, `svg flattened to ${filename} (${svgInfo.format} ${svgInfo.width}px), no script or external load`);
  page.off('request', onRequest);
}

// Turned scans and photos: OCR reads them, preview and download come out upright
{
  const card = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="300"><rect width="100%" height="100%" fill="#fff"/><text x="30" y="110" font-family="Arial" font-size="40">Email: jane.doe@example.com</text><text x="30" y="200" font-family="Arial" font-size="40">Contact bob@corp.io today</text></svg>')).png().toBuffer();
  // Dark share of a region of the redacted download.
  const dark = async (file, left, top, width, height) => {
    const px = await sharp(readFileSync(file)).extract({ left, top, width, height }).greyscale().raw().toBuffer();
    return px.filter((v) => v < 60).length / px.length;
  };
  // "bob@corp.io" sits at about x 175 to 385, y 170 to 205 on the upright card.
  const region = [175, 170, 210, 35];
  const cases = [
    ['upside-down', await sharp(card).rotate(180).png().toBuffer()],
    ['turned-right', await sharp(card).rotate(90).png().toBuffer()],
    ['turned-left', await sharp(card).rotate(270).png().toBuffer()],
    // Pixels stored upside down, EXIF says to turn them: the browser shows it upright.
    ['exif-turned', await sharp(await sharp(card).rotate(180).jpeg().toBuffer()).withMetadata({ orientation: 3 }).toBuffer()],
  ];
  for (const [name, bytes] of cases) {
    const file = fx(`${name}.${name.startsWith('exif') ? 'jpg' : 'png'}`);
    writeFileSync(file, bytes);
    const found = await run('redact-image', file);
    check(found.some((f) => f.includes('jane.doe@example.com')) && found.some((f) => f.includes('bob@corp.io')), `${name} findings: ${found.join(', ')}`);
    if (name === 'upside-down') {
      await page.screenshot({ path: fx('upside-down.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: fx('upside-down-phone.png') });
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    const { path: p } = await download(`${name}-out.png`);
    const { width, height } = await sharp(readFileSync(p)).metadata();
    const share = await dark(p, ...region);
    check(width === 800 && height === 300 && share > 0.85, `${name} saved upright (${width}x${height}), box over the email (${Math.round(share * 100)}% dark)`);
  }

  const pdf = await PDFDocument.create();
  const scan = await pdf.embedPng(await sharp(card).rotate(180).png().toBuffer());
  pdf.addPage([800, 300]).drawImage(scan, { x: 0, y: 0, width: 800, height: 300 });
  writeFileSync(fx('upside-down.pdf'), await pdf.save());
  const found = await run('redact-pdf', fx('upside-down.pdf'));
  check(found.some((f) => f.includes('jane.doe@example.com')), `upside-down pdf findings: ${found.join(', ')}`);
  const { path: p } = await download('upside-down-out.pdf');
  const [jpg] = [...readFileSync(p).toString('latin1').matchAll(/\xFF\xD8[\s\S]*?\xFF\xD9/g)].map((m) => Buffer.from(m[0], 'latin1'));
  const s = (await sharp(jpg).metadata()).width / 800;
  const box = await sharp(jpg).extract({ left: Math.round(175 * s), top: Math.round(170 * s), width: Math.round(210 * s), height: Math.round(35 * s) }).greyscale().raw().toBuffer();
  const share = box.filter((v) => v < 60).length / box.length;
  check(share > 0.85, `upside-down pdf saved upright, box over the email (${Math.round(share * 100)}% dark)`);

  // A real-looking scan: a letter on grey paper, slightly skewed, blurred and heavily compressed.
  await page.setViewportSize({ width: 827, height: 1169 });
  await page.setContent(`<div style="font:13px 'Times New Roman';padding:70px;line-height:1.5;background:#fff"><p>14 March 2025</p><p>Ms Maria Gonzalez<br>12 Elm Street, Springfield</p>${'<p>Thank you for your letter regarding the outstanding balance on your account. We have reviewed the payments received and can confirm that the amount due has been adjusted. Please contact our office on 415-555-0132 if you have any questions about this statement.</p>'.repeat(3)}<p>Yours sincerely,<br>John Smith</p></div>`);
  const letter = await sharp(await page.screenshot()).grayscale().linear(0.85, 20).rotate(181.2, { background: '#e8e8e8' }).blur(0.6).jpeg({ quality: 55 }).toBuffer();
  await page.setViewportSize({ width: 1280, height: 900 });
  const { width: lw, height: lh } = await sharp(letter).metadata();
  const scanned = await PDFDocument.create();
  scanned.addPage([lw * 0.75, lh * 0.75]).drawImage(await scanned.embedJpg(letter), { x: 0, y: 0, width: lw * 0.75, height: lh * 0.75 });
  writeFileSync(fx('letter-scan.pdf'), await scanned.save());
  const letterFound = await run('redact-pdf', fx('letter-scan.pdf'));
  check(letterFound.some((f) => f.includes('Maria Gonzalez')) && letterFound.some((f) => f.includes('415-555')), `upside-down letter scan findings: ${letterFound.join(', ')}`);
}

// Subtitles keep their numbering and timings
{
  writeFileSync(fx('call.srt'), '1\n00:00:01,000 --> 00:00:04,000\nHi, this is Jane Doe.\n\n2\n00:00:05,000 --> 00:00:08,000\nMy email is jane@example.com\n');
  const found = await run('redact-text', fx('call.srt'));
  check(found.includes('jane@example.com'), `srt findings: ${found.join(', ')}`);
  const { path: p, filename } = await download('call-out.srt');
  const srt = readFileSync(p, 'utf8');
  check(filename === 'call-redacted.srt' && srt.startsWith('1\n00:00:01,000 --> 00:00:04,000\n') && srt.includes('\n2\n00:00:05,000 --> 00:00:08,000\n') && !srt.includes('jane@'), `srt output: ${JSON.stringify(srt)}`);
}

// JSON and XML stay valid after redaction
{
  writeFileSync(fx('users.json'), JSON.stringify({ users: [{ name: 'Jane Doe', email: 'jane@example.com', phone: 4155550132, ip: '10.0.0.12' }] }, null, 2));
  const found = await run('redact-text', fx('users.json'));
  check(found.includes('jane@example.com') && found.includes('4155550132'), `json findings: ${found.join(', ')}`);
  await page.screenshot({ path: fx('json.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: fx('json-phone.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  let { path: p, filename } = await download('users-out.json');
  let data;
  try {
    data = JSON.parse(readFileSync(p, 'utf8'));
  } catch {}
  const user = data?.users?.[0];
  check(filename === 'users-redacted.json' && user && /^█+$/.test(user.email) && typeof user.phone === 'string' && !user.phone.includes('415'), `json output: ${readFileSync(p, 'utf8')}`);

  await page.selectOption('select[aria-label="Redaction style"]', 'label');
  ({ path: p } = await download('users-label.json'));
  try {
    data = JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    data = undefined;
  }
  check(data?.users?.[0]?.email === '[EMAIL]' && data.users[0].phone === '[PHONE]', `json labels: ${readFileSync(p, 'utf8')}`);

  writeFileSync(fx('contact.xml'), '<?xml version="1.0"?>\n<contact email="jane@example.com">\n  <name>Jane Doe</name>\n  <phone>415-555-0132</phone>\n</contact>\n');
  await run('redact-text', fx('contact.xml'));
  ({ path: p, filename } = await download('contact-out.xml'));
  const xml = readFileSync(p, 'utf8');
  const ok = await page.evaluate((x) => !new DOMParser().parseFromString(x, 'application/xml').querySelector('parsererror'), xml);
  check(filename === 'contact-redacted.xml' && ok && xml.includes('<name>') && !/jane|415/i.test(xml), `xml output: ${JSON.stringify(xml)}`);
}

// Final check: a warning stops the download until the user chooses
{
  let sent = '';
  let sentToken = '';
  await page.route('**/api/check', (route) => {
    ({ text: sent, checkToken: sentToken } = JSON.parse(route.request().postData() || '{}'));
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ risks: { name: 0.93, contact: 0.1 }, free: true }) });
  });
  apiCalls.length = 0;
  await run('redact-text', fx('sample.txt'), '.consent');
  check((await page.isVisible('.consent')) && apiCalls.length === 0, `nothing sent before consent ${JSON.stringify(apiCalls)}`);
  await page.click('.consent button.primary');
  await page.waitForSelector('.consent', { state: 'hidden' });
  await page.waitForSelector('.check-row:has-text("free")');
  check(await page.isChecked('.check-row input'), "the scan's free final check is ticked");
  await page.click('.panel-foot > button.primary');
  await page.waitForSelector('.warn-text');
  const warning = await page.textContent('.warn-text');
  const notes = await page.$$eval('.warn-text', (els) => els.map((e) => e.textContent).join(' '));
  check(/This check was free/.test(notes), `free check explained: ${notes}`);
  check(sentToken === 'scan-token', 'check sends the scan token');
  check(!(await page.isChecked('.check-row input')) && /1 credit/.test(await page.textContent('.check-row')), 'later checks start unticked and cost a credit');
  check(/names may still be readable/.test(warning) && !/phone/.test(warning), `check warning: ${warning}`);
  check(sent.includes('████') && !sent.includes('jane@example.com'), 'check gets masked text only');
  await page.screenshot({ path: fx('check.png') });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Download anyway')]);
  check(dl.suggestedFilename() === 'sample-redacted.txt', 'download anyway works');
  await page.unroute('**/api/check');
}

// Picture redaction: off by default, local pass first, server pass only after consent
{
  const visionCalls = [];
  await page.route('**/api/vision', (route) => {
    visionCalls.push(JSON.parse(route.request().postData() || '{}'));
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ regions: [{ kind: 'plate', box: [100, 100, 300, 200] }] }) });
  });
  await page.unroute('**/api/detect');
  await page.route('**/api/detect', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ entities: [] }) }));
  await run('redact-image', fx('sample.png'), '.consent');
  const pictureChips = page.locator('label.chip', { hasText: 'Number plates' });
  check((await pictureChips.count()) === 1 && !(await pictureChips.locator('input').isChecked()), 'picture options shown and off by default');
  await pictureChips.click();
  await page.waitForFunction(() => !/Looking for faces/.test(document.querySelector('.status')?.textContent ?? ''), null, { timeout: 60_000 });
  check(visionCalls.length === 0, 'no picture sent before consent');
  await page.click('.consent button.primary');
  await page.waitForSelector('label.finding:has-text("Number plate 1")', { timeout: 30_000 });
  check(visionCalls.length === 1 && /^data:image\/jpeg;base64,/.test(visionCalls[0].image) && visionCalls[0].kinds.join() === 'plate', 'picture sent after consent with the ticked kinds');
  await page.screenshot({ path: fx('pictures.png') });
  await pictureChips.click(); // leave the option off for later tests
  await page.unroute('**/api/vision');
  await page.unroute('**/api/detect');
}

// Home page, and the fallback when the AI binding is missing
{
  await page.goto(BASE);
  await page.screenshot({ path: fx('home.png'), fullPage: true });
  await page.setInputFiles('#file-input', fx('sample.txt'));
  await page.click('.consent button.primary');
  await page.waitForSelector('.status.error');
  const status = await page.textContent('.status');
  const empty = await page.textContent('.findings .empty');
  check(/not configured/i.test(status) && /^Nothing detected/.test(empty), `ai fallback: ${status} ${empty}`);
  await page.screenshot({ path: fx('fallback.png') });
}

check(errors.filter((e) => !/api\/detect|503/.test(e)).length === 0, `no page errors ${JSON.stringify(errors)}`);
await browser.close();
process.exit(failed ? 1 : 0);
