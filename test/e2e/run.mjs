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
  ['415-555-0177', 'phone'], ['4155550132', 'phone'],
  ['10.0.0.12', 'other'], ['123-45-6789', 'ssn'], ['4111 1111 1111 1111', 'card'],
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
  await page.click('.sel-add >> text=Redact here');
  await page.waitForFunction(() => [...document.querySelectorAll('.ftext')].some((e) => e.textContent === 'Server'));
  const { path: p } = await download('pick.txt');
  const txt = readFileSync(p, 'utf8');
  const terms = await page.inputValue('textarea[aria-label="Words to always redact"]');
  check(txt.includes('\n██████: ') && !terms, `one spot redacted, no term added: ${JSON.stringify(txt)}`);
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
  check(['jane.doe@example.com', 'bob@corp.io', '415-555-0199', '415-555-0177', '4155550132', '123-45-6789'].every((f) => found.includes(f)), `xlsx findings: ${found.join(', ')}`);
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
