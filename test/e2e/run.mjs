// End-to-end check of every format in a real browser.
// Usage: npm run dev:local (in another shell), then node test/e2e/run.mjs <outdir>
import { createRequire } from 'node:module';
import exifr from 'exifr';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  route.fulfill({ contentType: 'application/json', body: JSON.stringify({ entities }) });
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
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.panel > button.primary')]);
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
}

// DOCX with pictures
{
  const found = await run('redact-word', fx('pictures.docx'));
  check(found.includes('123-45-6789') && found.includes('415-555-0132'), `docx picture and alt text findings: ${found.join(', ')}`);
  check((await page.$$('.page')).length === 2 && (await page.$$('.text-preview .unit')).length >= 2, 'docx shows text and both pictures');
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
  await page.locator('.meta').scrollIntoViewIfNeeded();
  await page.screenshot({ path: fx('metadata-phone.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  const { path: p, filename } = await download('photo-out.jpg');
  const left = await exifr.parse(readFileSync(p), { xmp: true, iptc: true, mergeOutput: true }).catch(() => undefined);
  check(filename === 'photo-redacted.jpg' && !left, `metadata stripped from ${filename}: ${JSON.stringify(left)}`);
}

// Final check: a warning stops the download until the user chooses
{
  let sent = '';
  await page.route('**/api/check', (route) => {
    sent = JSON.parse(route.request().postData() || '{}').text;
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ risks: { name: 0.93, contact: 0.1 } }) });
  });
  apiCalls.length = 0;
  await run('redact-text', fx('sample.txt'), '.consent');
  check((await page.isVisible('.consent')) && apiCalls.length === 0, `nothing sent before consent ${JSON.stringify(apiCalls)}`);
  await page.click('.consent button.primary');
  await page.waitForSelector('.consent', { state: 'hidden' });
  await page.click('.panel > button.primary');
  await page.waitForSelector('.warn-text');
  const warning = await page.textContent('.warn-text');
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
