// Runs every corpus file through the editor in Chromium: open, preview, consent,
// detection, matching, download, then checks the download on its own.
// Usage: npm run dev:local (in another shell), then node test/fuzz/run.mjs <outdir> [filter]
// The model, the final check and speech-to-text are stood in for, so only the browser side is under test.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { build, SECRETS } from './corpus.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:8787';
const out = path.resolve(process.argv[2] || 'fuzz-out');
const filter = process.argv[3] ? new RegExp(process.argv[3]) : null;
const files = path.join(out, 'files');
const downloads = path.join(out, 'downloads');
const shots = path.join(out, 'shots');
for (const d of [files, downloads, shots]) mkdirSync(d, { recursive: true });
const cases = (await build(files)).filter((c) => !filter || filter.test(c.file));
const STEP_TIMEOUT = Number(process.env.STEP_TIMEOUT || 180_000);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Each secret as the stand-in model would return it: as written in the text, any spacing. */
function fakeEntities(text) {
  const entities = [];
  for (const value of SECRETS) {
    const re = new RegExp(value.split(/\s+/).map(escapeRe).join('\\s+'), 'g');
    for (const m of text.matchAll(re)) entities.push({ text: m[0], type: value.includes('@') ? 'email' : /\d/.test(value) ? 'phone' : 'name', owner: 'person' });
  }
  return entities;
}

/** Speech for a WAV chunk: the secrets said one word a third of a second apart. */
function fakeWords(body) {
  const seconds = Math.max(0, (body.length - 44) / 32000);
  const said = 'my name is Jane Doe my email is jane@example.com and my phone is 415-555-0132'.split(' ');
  const step = Math.min(0.35, seconds / said.length);
  return step > 0.01 ? said.map((text, i) => ({ text, start: i * step, end: (i + 0.9) * step })) : [];
}

const browser = await chromium.launch();
const results = [];
for (const c of cases) {
  const r = { file: c.file, group: c.group, note: c.note, expectOpen: c.opens, steps: {}, problems: [], errors: [] };
  results.push(r);
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => r.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of 50[23]/.test(m.text())) r.errors.push(`console: ${m.text().slice(0, 300)}`);
  });
  page.on('dialog', (d) => {
    r.problems.push(`dialog opened: ${d.message()}`);
    d.dismiss();
  });
  const sent = [];
  await page.route('**/api/detect', (route) => {
    const { text } = JSON.parse(route.request().postData() || '{}');
    sent.push(text);
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ entities: fakeEntities(text) }) });
  });
  await page.route('**/api/check', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ risks: {}, free: true }) }));
  await page.route('**/api/transcribe*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ words: fakeWords(route.request().postDataBuffer() ?? Buffer.alloc(0)), language: 'en' }) }));
  const t0 = Date.now();
  const lap = (name) => (r.steps[name] = Date.now() - t0);
  try {
    await page.goto(`${BASE}/${c.slug}`);
    await page.setInputFiles('#file-input', path.join(files, c.file));
    // Opened (consent, findings or an empty list) or refused with a message.
    const state = await page.waitForFunction(
      () => {
        const status = document.querySelector('.status');
        if (status && !status.hidden && status.classList.contains('error') && document.querySelector('.workspace')?.hidden) return { error: status.textContent };
        const consent = document.querySelector('.consent');
        if (consent && !consent.hidden && consent.querySelector('button.primary')) return { consent: true };
        const ws = document.querySelector('.workspace');
        if (ws && !ws.hidden && !(status && !status.hidden && status.classList.contains('busy')) && document.querySelector('.findings')?.children.length) return { open: true };
        return null;
      },
      null,
      { timeout: STEP_TIMEOUT, polling: 250 },
    ).then((h) => h.jsonValue());
    lap('open');
    r.opened = !state.error;
    if (state.error) r.message = state.error;
    if (c.opens !== null && r.opened !== c.opens) r.problems.push(c.opens ? `did not open: ${state.error}` : 'opened, expected a refusal');
    if (state.error) {
      if (/^[A-Z][a-z]+Error|undefined|null|\bat\b.*\.js|Cannot read|is not a function|Invalid|Unexpected|DataError|zip|central directory|could not be decoded|No password|i\.e\./.test(state.error)) r.problems.push(`raw error shown to the user: ${state.error}`);
      continue;
    }
    r.notes = await page.$$eval('.notes li', (els) => els.map((e) => e.textContent));
    if (state.consent) {
      await page.click('.consent button.primary');
      await page.waitForFunction(
        () => {
          const status = document.querySelector('.status');
          const consent = document.querySelector('.consent');
          return (!status || status.hidden || !status.classList.contains('busy')) && (!consent || consent.hidden) && document.querySelector('.findings')?.children.length;
        },
        null,
        { timeout: STEP_TIMEOUT, polling: 250 },
      );
      lap('detect');
    }
    r.status = await page.$eval('.status', (s) => (s.hidden ? '' : s.textContent)).catch(() => '');
    r.found = await page.$$eval('label.finding:not(.off) .ftext', (els) => els.map((e) => e.textContent));
    r.sentChars = sent.reduce((n, t) => n + t.length, 0);
    const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
    const missed = c.secrets.filter((s) => !r.found.some((f) => norm(f) === norm(s)));
    if (missed.length) r.problems.push(`not found: ${missed.join(', ')}${sent.length ? '' : ' (no text sent)'}`);
    if (await page.locator('.status.error:not([hidden])').count()) r.problems.push(`error after opening: ${r.status}`);
    // Hand-drawn box on the first page, for formats with pages.
    const canvas = page.locator('.preview canvas').first();
    if ((await canvas.count()) && (await canvas.isVisible())) {
      const b = await canvas.boundingBox();
      if (b && b.width > 20 && b.height > 20) {
        await page.mouse.move(b.x + 5, b.y + 5);
        await page.mouse.down();
        await page.mouse.move(b.x + Math.min(60, b.width - 5), b.y + Math.min(20, b.height - 5), { steps: 4 });
        await page.mouse.up();
        r.drewBox = (await page.locator('.manual-count').count()) > 0;
        if (!r.drewBox) r.problems.push('drawing a box on the page did nothing');
      }
    }
    await page.screenshot({ path: path.join(shots, `${c.file}.png`) });
    lap('preview');
    // Download
    const dlP = page.waitForEvent('download', { timeout: STEP_TIMEOUT });
    await page.click('.panel-foot > button.primary');
    const dl = await Promise.race([
      dlP,
      page.waitForSelector('.panel-foot .status.error:not([hidden])', { timeout: STEP_TIMEOUT }).then(async (el) => ({ error: await el.textContent() })),
    ]);
    lap('download');
    if (dl.error) {
      r.problems.push(`download failed: ${dl.error}`);
      continue;
    }
    const saved = path.join(downloads, `${c.file}--${dl.suggestedFilename()}`);
    await dl.saveAs(saved);
    r.output = dl.suggestedFilename();
    r.outputBytes = readFileSync(saved).length;
    await verify(c, saved, r);
    lap('verify');
  } catch (err) {
    r.problems.push(`stuck: ${String(err.message).split('\n')[0]}`);
    r.status = await page.$eval('.status', (s) => s.textContent).catch(() => '');
    await page.screenshot({ path: path.join(shots, `${c.file}-stuck.png`) }).catch(() => {});
  } finally {
    r.ms = Date.now() - t0;
    // Errors the page logs while showing the user a message are expected; uncaught ones are not.
    const errs = r.errors.filter((e) => e.startsWith('pageerror'));
    if (errs.length) r.problems.push(`uncaught: ${errs.slice(0, 3).join(' | ')}`);
    console.log(`${r.problems.length ? 'FAIL' : 'ok  '} ${c.file} (${(r.ms / 1000).toFixed(1)} s)${r.problems.length ? '\n     ' + r.problems.join('\n     ') : ''}`);
    await ctx.close();
  }
}
await browser.close();
writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 1));
const bad = results.filter((r) => r.problems.length);
console.log(`\n${results.length} files, ${bad.length} with problems`);

/** Checks the download outside the browser: it opens, and the secrets are gone. */
async function verify(c, file, r) {
  const ext = path.extname(r.output).slice(1).toLowerCase();
  const leak = (text, where) => {
    const left = SECRETS.filter((s) => text.includes(s));
    if (left.length) r.problems.push(`${where} still holds ${left.join(', ')}`);
  };
  const buf = readFileSync(file);
  if (['docx', 'pptx', 'xlsx', 'ods'].includes(ext)) {
    let zip;
    try {
      zip = await JSZip.loadAsync(buf);
    } catch (e) {
      return r.problems.push(`download is not a zip: ${e.message}`);
    }
    let all = '';
    for (const f of Object.values(zip.files)) if (!f.dir && /\.(xml|rels)$/.test(f.name)) all += await f.async('string');
    leak(all, 'download XML');
    // LibreOffice must be able to read it back.
    try {
      const dir = path.join(out, 'reopen');
      mkdirSync(dir, { recursive: true });
      if (/far-cell/.test(c.file)) return; // a million rows as CSV takes LibreOffice minutes
      const target = ext === 'xlsx' || ext === 'ods' ? 'csv' : 'txt';
      const copy = path.join(dir, `x.${ext}`);
      writeFileSync(copy, buf);
      execFileSync('soffice', ['--headless', '--convert-to', target, '--outdir', dir, copy], { stdio: 'ignore', timeout: 120_000 });
      const txt = readFileSync(path.join(dir, `x.${target}`), 'utf8');
      leak(txt, 'download as read by LibreOffice');
      if (ext !== 'pptx' && c.secrets.length && !txt.replace(/[█\s]/g, '')) r.problems.push('LibreOffice reads an empty document');
    } catch (e) {
      r.problems.push(`LibreOffice cannot open the download: ${e.message.split('\n')[0]}`);
    }
  } else if (ext === 'pdf') {
    try {
      const pdf = await PDFDocument.load(buf);
      r.outPages = pdf.getPageCount();
      if (buf.includes('Jane')) r.problems.push('PDF download holds text');
    } catch (e) {
      r.problems.push(`download PDF does not load: ${e.message}`);
    }
  } else if (/^(png|jpe?g|webp|gif|tiff?|avif|bmp)$/.test(ext)) {
    try {
      const m = await sharp(buf).metadata();
      r.outSize = `${m.width}x${m.height}${m.pages > 1 ? ` x${m.pages}` : ''}`;
      if (m.exif || m.xmp || m.iptc) r.problems.push('download keeps metadata');
    } catch (e) {
      r.problems.push(`download image does not decode: ${e.message}`);
    }
  } else if (/^(mp3|m4a|wav|ogg|opus|flac|aac|webm)$/.test(ext)) {
    try {
      const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:format_tags', '-of', 'json', file]).toString();
      const j = JSON.parse(probe);
      r.outSeconds = Number(j.format.duration);
      if (j.format.tags && Object.values(j.format.tags).some((v) => /Jane|example/.test(v))) r.problems.push('audio download keeps tags');
    } catch (e) {
      r.problems.push(`download audio does not decode: ${e.message.split('\n')[0]}`);
    }
  } else {
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(buf);
    leak(text, 'download');
    const src = readFileSync(path.join(files, c.file));
    const lost = (c.keep ?? []).filter((k) => !text.includes(k));
    if (lost.length) r.problems.push(`download lost ${lost.map((k) => JSON.stringify(k)).join(', ')}`);
    if (text.includes('�') && !src.toString('utf8').includes('�')) r.problems.push('download has replacement characters (�) the file did not');
    if (/\.(json)$/.test(c.file)) {
      try {
        JSON.parse(src.toString('utf8').replace(/^﻿/, ''));
        try {
          JSON.parse(text.replace(/^﻿/, ''));
        } catch {
          r.problems.push('valid JSON came back invalid');
        }
      } catch {
        /* the input was not JSON either */
      }
    }
    if (src.length > 0 && text.length === 0) r.problems.push('download is empty');
  }
}
