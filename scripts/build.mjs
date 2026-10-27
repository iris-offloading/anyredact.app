// Builds the static site into dist/: bundles the client, then renders one
// HTML page per tool plus the home page, sitemap and robots.txt.
import { build, transform } from 'esbuild';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { CONTACT, LEGAL, UPDATED } from './legal.mjs';
import { HOME, SITE, TOOLS } from './pages.mjs';
import { PRICING } from './pricing.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const require = createRequire(import.meta.url);

// Overwrite in place and prune stale assets at the end, rather than deleting
// dist/ up front: `wrangler dev` serves from it while rebuilding.
await mkdir(path.join(dist, 'assets'), { recursive: true });

const pdfjsVersion = require('pdfjs-dist/package.json').version;
const pdfWorker = `/assets/pdf.worker-${pdfjsVersion}.min.mjs`;
const univerVersion = JSON.parse(await readFile(path.join(root, 'node_modules/@univerjs/preset-sheets-core/package.json'), 'utf8')).version;
const univerCss = `/assets/univer-${univerVersion}.css`;
const mediapipeVersion = JSON.parse(await readFile(path.join(root, 'node_modules/@mediapipe/tasks-vision/package.json'), 'utf8')).version;

const result = await build({
  entryPoints: { app: path.join(root, 'src/client/main.ts'), account: path.join(root, 'src/client/account.ts') },
  outdir: path.join(dist, 'assets'),
  bundle: true,
  splitting: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  // Without sources the maps stay under the 25 MiB Workers asset limit.
  sourcesContent: false,
  entryNames: '[name]-[hash]',
  chunkNames: 'chunk-[hash]',
  metafile: true,
  define: {
    __PDF_WORKER_SRC__: JSON.stringify(pdfWorker),
    __UNIVER_CSS__: JSON.stringify(univerCss),
    __MEDIAPIPE_WASM__: JSON.stringify(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${mediapipeVersion}/wasm`),
  },
  logLevel: 'warning',
});
const entrySrc = (name) => {
  const out = Object.entries(result.metafile.outputs).find(([, o]) => o.entryPoint?.endsWith(`src/client/${name}.ts`))[0];
  return '/' + path.relative(dist, path.join(root, out)).split(path.sep).join('/');
};
const appSrc = entrySrc('main');
const accountSrc = entrySrc('account');

await cp(require.resolve('pdfjs-dist/build/pdf.worker.min.mjs'), path.join(dist, pdfWorker));
await cp(path.join(root, 'node_modules/@univerjs/preset-sheets-core/lib/index.css'), path.join(dist, univerCss));
await cp(path.join(root, 'static'), dist, { recursive: true });
// Geist is served from this domain: the CSP allows fonts from 'self' only, and pages make no third-party requests.
const fontFiles = ['geist/files/geist-latin-wght-normal.woff2', 'geist/files/geist-latin-ext-wght-normal.woff2', 'geist-mono/files/geist-mono-latin-wght-normal.woff2'];
for (const f of fontFiles) await cp(path.join(root, 'node_modules/@fontsource-variable', f), path.join(dist, 'fonts', path.basename(f)));
// Only the CDN packages the app loads may run: the whole of jsDelivr serves any npm package or GitHub file.
const tesseractVersion = require('tesseract.js/package.json').version;
const tesseractCore = require('tesseract.js/package.json').dependencies['tesseract.js-core'].replace(/^\D*/, '');
const cdn = 'https://cdn.jsdelivr.net/npm';
const cdnScripts = [`${cdn}/tesseract.js@v${tesseractVersion}/`, `${cdn}/tesseract.js-core@v${tesseractCore}/`, `${cdn}/@mediapipe/tasks-vision@${mediapipeVersion}/`];
const headers = await readFile(path.join(dist, '_headers'), 'utf8');
await writeFile(path.join(dist, '_headers'), headers.replaceAll('CDN_SCRIPTS', cdnScripts.join(' ')).replaceAll('CDN_DATA', `${cdn}/@tesseract.js-data/`));
const css = await readFile(path.join(root, 'static/styles.css'));
const cssHash = (await import('node:crypto')).createHash('sha256').update(css).digest('hex').slice(0, 8);
const themeHash = (await import('node:crypto')).createHash('sha256').update(await readFile(path.join(root, 'static/theme.js'))).digest('hex').slice(0, 8);
const analyticsHash = (await import('node:crypto')).createHash('sha256').update(await readFile(path.join(root, 'static/analytics.js'))).digest('hex').slice(0, 8);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const url = (slug) => `${SITE.origin}/${slug}`;

// Theme button: system, light and dark in turn; static/theme.js wires it up and reveals it.
const ICONS = {
  system: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  dark: '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>',
};
const themeButton = `<button type="button" class="theme-button" aria-label="Theme: system" hidden>${Object.entries(ICONS)
  .map(([value, path]) => `<svg data-theme-icon="${value}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`)
  .join('')}</button>`;

// The mark takes its colours from CSS, so it can flip in dark mode and in the footer.
const logoMark = (size) =>
  `<svg class="logo-mark" width="${size}" height="${size}" viewBox="0 0 28 28" aria-hidden="true"><rect class="lm-bg" width="28" height="28" rx="7"/><rect class="lm-bar" x="6" y="9" width="16" height="4" rx="1"/><rect class="lm-accent" x="6" y="15" width="10" height="4" rx="1"/></svg>`;

function nav(current) {
  const links = [{ slug: '', nav: 'All formats' }, ...TOOLS]
    .map((t) => `<a href="/${t.slug}"${t.slug === current ? ' aria-current="page"' : ''}>${esc(t.nav)}</a>`)
    .join('');
  return `<header class="site-header"><div class="wrap">
  <a class="logo" href="/">${logoMark(28)}AnyRedact</a>
  <nav aria-label="Tools">${links}</nav>
  <div class="header-actions"><a class="header-link" href="/pricing"${current === 'pricing' ? ' aria-current="page"' : ''}>Pricing</a>${themeButton}<a class="btn signin-link" href="/account">Sign in</a></div>
</div></header>`;
}

function footer() {
  const tools = TOOLS.map((t) => `<li><a href="/${t.slug}">${esc(t.name)}</a></li>`).join('');
  const about = [PRICING, ...LEGAL].map((p) => `<li><a href="/${p.slug}">${esc(p.nav)}</a></li>`).join('');
  return `<footer class="site-footer"><div class="wrap">
  <div><strong class="logo">${logoMark(24)}AnyRedact</strong><p>${esc(SITE.tagline)}.</p></div>
  <div><h2>Tools</h2><ul>${tools}</ul></div>
  <div><h2>About</h2><ul>${about}<li><button type="button" class="footer-link" data-consent>Cookies</button></li></ul></div>
</div></footer>`;
}

function jsonLd(page) {
  const graph = [
    {
      '@type': 'WebApplication',
      name: page.slug ? `${SITE.name}: ${page.h1}` : SITE.name,
      url: url(page.slug),
      description: page.description,
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Any (web browser)',
      browserRequirements: 'Requires JavaScript',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
  ];
  if (page.faq?.length) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: page.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    });
  }
  if (page.slug) {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: SITE.name, item: url('') },
        { '@type': 'ListItem', position: 2, name: page.h1, item: url(page.slug) },
      ],
    });
  }
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
}

function layout(page, main) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
<link rel="canonical" href="${url(page.slug)}">
<meta name="theme-color" content="#f6f5f1" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#111216" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE.name}">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:url" content="${url(page.slug)}">
<meta name="twitter:card" content="summary">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/geist-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/styles.css?v=${cssHash}">
<script src="/theme.js?v=${themeHash}"></script>
<script src="/analytics.js?v=${analyticsHash}"></script>
${page.jsonLd === false ? '' : `<script type="application/ld+json">${typeof page.jsonLd === 'string' ? page.jsonLd : jsonLd(page)}</script>`}
${page.tool ? `<script type="module" src="${appSrc}"></script>` : ''}
${page.script ? `<script type="module" src="${page.script}"></script>` : ''}
</head>
<body>
${nav(page.slug)}
<main>${main}</main>
${footer()}
</body>
</html>
`;
}

function toolPage(page) {
  const points = page.points.map(([t, d]) => `<div class="point"><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join('');
  const faq = page.faq.map((f, i) => `<details${i ? '' : ' open'}><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('');
  return layout(
    { ...page, tool: true },
    `<section class="hero wrap">
  <div class="hero-copy">
    <h1>${page.slug ? esc(page.h1) : esc(page.h1).replace('finds', '<span class="redacted">finds</span>')}</h1>
    <p class="lead">${esc(page.also ? `${page.lead} ${page.also}` : page.lead)}</p>
  </div>
  <div id="tool" class="tool" data-format="${page.format}" data-hint="${esc(page.hint)}">
    <noscript><p class="status error">AnyRedact runs in your browser and needs JavaScript enabled.</p></noscript>
  </div>
</section>
<section class="band"><div class="wrap points">${points}</div></section>
<section class="wrap section faq"><h2>Frequently asked questions</h2><div class="faq-list">${faq}</div></section>`,
  );
}

const pages = [
  [HOME, 'index.html'],
  ...TOOLS.map((t) => [t, `${t.slug}.html`]),
];
for (const [page, file] of pages) await writeFile(path.join(dist, file), toolPage(page));

for (const page of LEGAL) {
  await writeFile(
    path.join(dist, `${page.slug}.html`),
    layout({ ...page, jsonLd: false }, `<article class="wrap prose">\n<h1>${esc(page.h1)}</h1>${page.body}\n${page.dated === false ? '' : `<p class="updated">Last updated ${UPDATED}</p>\n`}</article>`),
  );
}

await writeFile(
  path.join(dist, '404.html'),
  layout(
    { slug: '404', title: 'Page not found | AnyRedact', description: 'Page not found.', jsonLd: false },
    `<article class="wrap solo"><h1>Page not found</h1><p>Try the <a href="/">redaction tool</a> instead.</p></article>`,
  ).replace('<link rel="canonical" href="https://anyredact.app/404">', '<meta name="robots" content="noindex">'),
);

await writeFile(
  path.join(dist, 'account.html'),
  layout(
    {
      slug: 'account',
      title: 'Account | AnyRedact',
      description: 'Free AI redaction credits every day, plus monthly plans and credits that never expire.',
      jsonLd: false,
      script: accountSrc,
    },
    `<article class="wrap solo"><div id="account"><div class="auth-card"><h1>Account</h1><p class="hint">Loading…</p></div></div></article>`,
  ),
);

// The pricing page reads plans and credits from src/shared/pricing.ts, so it can't drift from checkout.
const pricingTs = await transform(await readFile(path.join(root, 'src/shared/pricing.ts'), 'utf8'), { loader: 'ts', format: 'esm' });
const plans = await import(`data:text/javascript;base64,${Buffer.from(pricingTs.code).toString('base64')}`);
await writeFile(path.join(dist, 'pricing.html'), layout({ ...PRICING, jsonLd: PRICING.jsonLd(plans, url) }, PRICING.body(plans, esc)));

const today = new Date().toISOString().slice(0, 10);
const sitemapUrls = ['', ...TOOLS.map((t) => t.slug), 'pricing', 'account', ...LEGAL.map((p) => p.slug)];
await writeFile(
  path.join(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map((s) => `  <url><loc>${url(s)}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`,
);
const expires = new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10);
await mkdir(path.join(dist, '.well-known'), { recursive: true });
await writeFile(path.join(dist, '.well-known/security.txt'), `Contact: mailto:${CONTACT}\nExpires: ${expires}T00:00:00.000Z\nPolicy: ${url('contact')}\n`);
await writeFile(path.join(dist, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE.origin}/sitemap.xml\n`);

const keep = new Set([...Object.keys(result.metafile.outputs).map((f) => path.basename(f)), path.basename(pdfWorker), path.basename(univerCss)]);
for (const f of await readdir(path.join(dist, 'assets'))) {
  if (!keep.has(f)) await rm(path.join(dist, 'assets', f), { force: true });
}

console.log(`Built ${pages.length + LEGAL.length + 3} pages into dist/ (app: ${appSrc})`);
