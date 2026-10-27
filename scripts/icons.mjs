// Writes the logo files into static/: favicon.svg, apple-touch-icon.png and the
// 1200 x 630 social image. Run with `npm run icons` after changing scripts/logo.mjs
// and commit the results; the site build only copies them.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { COLORS, faviconSvg, iconSvg } from './logo.mjs';
import { HOME } from './pages.mjs';

const root = path.resolve(import.meta.dirname, '..');
const out = (file) => path.join(root, 'static', file);

await writeFile(out('favicon.svg'), faviconSvg);
await sharp(Buffer.from(iconSvg(180, { radius: 0 }))).png().toFile(out('apple-touch-icon.png'));

const font = (await readFile(path.join(root, 'node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2'))).toString('base64');
const h1 = HOME.h1.replace('finds', '<span class="redacted">finds</span>');
const html = `<!doctype html><html><head><style>
@font-face { font-family: Geist; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 100 900; }
html, body { margin: 0; }
body { width: 1200px; height: 630px; box-sizing: border-box; padding: 72px 80px; background: #f6f5f1; color: ${COLORS.light.bg}; font-family: Geist; display: flex; flex-direction: column; justify-content: space-between; }
.logo { display: flex; align-items: center; gap: 18px; font-size: 44px; font-weight: 700; letter-spacing: -0.01em; }
h1 { margin: 0; font-size: 84px; line-height: 1.04; letter-spacing: -0.035em; font-weight: 700; max-width: 1000px; }
.redacted { display: inline-block; line-height: 0.86; padding: 0 10px; border-radius: 8px; background: ${COLORS.light.bg}; color: ${COLORS.light.bg}; }
</style></head><body>
<div class="logo">${iconSvg(64)}AnyRedact</div>
<h1>${h1}</h1>
</body></html>`;

const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: out('social.png') });
await browser.close();
