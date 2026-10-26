// End-to-end check of every format in a real browser.
// Usage: npm run dev:local (in another shell), then node test/e2e/run.mjs <outdir>
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Playwright is not a dependency; use a globally installed copy.
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:8787';
const out = path.resolve(process.argv[2] || 'e2e-out');
mkdirSync(out, { recursive: true });
const fx = (f) => path.join(out, f);
await import('./fixtures.mjs').catch(() => {}); // fixtures.mjs writes into argv[2]

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

async function run(slug, file, wait = 'label.finding') {
  await page.goto(`${BASE}/${slug}`);
  await page.setInputFiles('#file-input', file);
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

// Final check: a warning stops the download until the user chooses
{
  let sent = '';
  await page.route('**/api/check', (route) => {
    sent = JSON.parse(route.request().postData() || '{}').text;
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ risks: { name: 0.93, contact: 0.1 } }) });
  });
  apiCalls.length = 0;
  await run('redact-text', fx('sample.txt'));
  check((await page.isVisible('.consent')) && apiCalls.length === 0, `nothing sent before consent ${JSON.stringify(apiCalls)}`);
  await page.click('text=Find personal info with AI');
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

// Home page, and the fallback when the AI binding is missing
{
  await page.goto(BASE);
  await page.screenshot({ path: fx('home.png'), fullPage: true });
  await page.setInputFiles('#file-input', fx('sample.txt'));
  await page.waitForSelector('label.finding');
  await page.click('text=Find personal info with AI');
  await page.waitForFunction(() => /built-in rules only/i.test(document.querySelector('.status')?.textContent ?? ''));
  const status = await page.textContent('.status');
  check(/built-in rules only/i.test(status), `ai fallback status: ${status}`);
}

check(errors.filter((e) => !/api\/detect|503/.test(e)).length === 0, `no page errors ${JSON.stringify(errors)}`);
await browser.close();
process.exit(failed ? 1 : 0);
