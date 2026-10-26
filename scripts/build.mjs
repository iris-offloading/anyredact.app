// Builds the static site into dist/: bundles the client, then renders one
// HTML page per tool plus the home page, sitemap and robots.txt.
import { build } from 'esbuild';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { HOME, SITE, TOOLS } from './pages.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const require = createRequire(import.meta.url);

// Overwrite in place and prune stale assets at the end, rather than deleting
// dist/ up front: `wrangler dev` serves from it while rebuilding.
await mkdir(path.join(dist, 'assets'), { recursive: true });

const pdfjsVersion = require('pdfjs-dist/package.json').version;
const pdfWorker = `/assets/pdf.worker-${pdfjsVersion}.min.mjs`;

const result = await build({
  entryPoints: { app: path.join(root, 'src/client/main.ts') },
  outdir: path.join(dist, 'assets'),
  bundle: true,
  splitting: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  entryNames: '[name]-[hash]',
  chunkNames: 'chunk-[hash]',
  metafile: true,
  define: { __PDF_WORKER_SRC__: JSON.stringify(pdfWorker) },
  logLevel: 'warning',
});
const appJs = Object.entries(result.metafile.outputs).find(([, o]) => o.entryPoint)[0];
const appSrc = '/' + path.relative(dist, path.join(root, appJs)).split(path.sep).join('/');

await cp(require.resolve('pdfjs-dist/build/pdf.worker.min.mjs'), path.join(dist, pdfWorker));
await cp(path.join(root, 'static'), dist, { recursive: true });
const css = await readFile(path.join(root, 'static/styles.css'));
const cssHash = (await import('node:crypto')).createHash('sha256').update(css).digest('hex').slice(0, 8);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const url = (slug) => `${SITE.origin}/${slug}`;

function nav(current) {
  const links = [{ slug: '', nav: 'All formats' }, ...TOOLS]
    .map((t) => `<a href="/${t.slug}"${t.slug === current ? ' aria-current="page"' : ''}>${esc(t.nav)}</a>`)
    .join('');
  return `<header class="site-header"><div class="wrap">
  <a class="logo" href="/"><img class="logo-mark" src="/favicon.svg" width="26" height="26" alt="">AnyRedact</a>
  <nav aria-label="Tools">${links}</nav>
</div></header>`;
}

function footer() {
  const tools = TOOLS.map((t) => `<li><a href="/${t.slug}">${esc(t.h1)}</a></li>`).join('');
  return `<footer class="site-footer"><div class="wrap">
  <div><strong>AnyRedact</strong><p>${esc(SITE.tagline)}. Free to use.</p></div>
  <div><h2>Tools</h2><ul>${tools}</ul></div>
  <div><h2>About</h2><ul><li><a href="/privacy">Privacy</a></li></ul></div>
</div></footer>`;
}

function jsonLd(page) {
  const graph = [
    {
      '@type': 'WebApplication',
      name: page.slug ? `${SITE.name} – ${page.h1}` : SITE.name,
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
<meta name="theme-color" content="#111318">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE.name}">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:url" content="${url(page.slug)}">
<meta name="twitter:card" content="summary">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles.css?v=${cssHash}">
${page.jsonLd === false ? '' : `<script type="application/ld+json">${jsonLd(page)}</script>`}
${page.tool ? `<script type="module" src="${appSrc}"></script>` : ''}
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
  const points = page.points
    .map(([t, d]) => `<div class="point"><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`)
    .join('');
  const faq = page.faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('');
  const others = TOOLS.filter((t) => t.slug !== page.slug)
    .map((t) => `<a class="card" href="/${t.slug}"><strong>${esc(t.h1)}</strong><span>${esc(t.lead)}</span></a>`)
    .join('');
  return layout(
    { ...page, tool: true },
    `<section class="hero wrap">
  <h1>${esc(page.h1)}</h1>
  <p class="lead">${esc(page.lead)}</p>
</section>
<section class="wrap">
  <div id="tool" class="tool" data-format="${page.format}" data-hint="${esc(page.hint)}">
    <noscript><p class="status error">AnyRedact runs in your browser and needs JavaScript enabled.</p></noscript>
  </div>
</section>
<section class="wrap points">${points}</section>
<section class="wrap how">
  <h2>How it works</h2>
  <ol>
    <li><strong>Open your file.</strong> It is read inside your browser and its text is checked by AI. The file itself is not uploaded.</li>
    <li><strong>Review what was found.</strong> Untick anything you want to keep, add your own words, or draw boxes.</li>
    <li><strong>Download the redacted copy.</strong> The sensitive content is removed from the file itself.</li>
  </ol>
</section>
<section class="wrap faq"><h2>Frequently asked questions</h2>${faq}</section>
<section class="wrap more"><h2>${page.slug ? 'More redaction tools' : 'Tools for each format'}</h2><div class="cards">${others}</div></section>`,
  );
}

const pages = [
  [HOME, 'index.html'],
  ...TOOLS.map((t) => [t, `${t.slug}.html`]),
];
for (const [page, file] of pages) await writeFile(path.join(dist, file), toolPage(page));

const privacy = {
  slug: 'privacy',
  title: 'Privacy – AnyRedact',
  description: 'How AnyRedact handles your files: redacted in your browser, only text sent for AI detection, nothing stored, no accounts and no tracking.',
  jsonLd: false,
};
await writeFile(
  path.join(dist, 'privacy.html'),
  layout(
    privacy,
    `<article class="wrap prose">
<h1>Privacy</h1>
<p>AnyRedact is built so that your documents stay with you.</p>
<h2>Your file</h2>
<p>Files are opened and redacted inside your browser, and the redacted copy is created there too. The file itself is never sent to our servers. To read text in images and scanned PDFs, your browser downloads the open-source Tesseract OCR engine and its English language data from the jsDelivr CDN; your images are not sent anywhere.</p>
<h2>AI detection</h2>
<p>To find personal information, the <em>text</em> read from your file is sent over HTTPS to our Cloudflare Worker and analysed by a language model on Cloudflare Workers AI. We do not store the text or the results, and we do not use them for training. Cloudflare processes the request as our infrastructure provider.</p>
<h2>What we collect</h2>
<p>No accounts, no cookies and no third-party analytics. Our hosting provider keeps standard, short-lived request logs (such as IP address and URL) for security and abuse prevention, and we rate-limit the AI endpoint per IP address.</p>
<h2>Check before you share</h2>
<p>Automatic detection can miss things. Always review the redacted file before sharing it.</p>
</article>`,
  ),
);

await writeFile(
  path.join(dist, '404.html'),
  layout(
    { slug: '404', title: 'Page not found – AnyRedact', description: 'Page not found.', jsonLd: false },
    `<article class="wrap prose"><h1>Page not found</h1><p>Try the <a href="/">redaction tool</a> instead.</p></article>`,
  ).replace('<link rel="canonical" href="https://anyredact.app/404">', '<meta name="robots" content="noindex">'),
);

const today = new Date().toISOString().slice(0, 10);
const sitemapUrls = ['', ...TOOLS.map((t) => t.slug), 'privacy'];
await writeFile(
  path.join(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map((s) => `  <url><loc>${url(s)}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`,
);
await writeFile(path.join(dist, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE.origin}/sitemap.xml\n`);

const keep = new Set([...Object.keys(result.metafile.outputs).map((f) => path.basename(f)), path.basename(pdfWorker)]);
for (const f of await readdir(path.join(dist, 'assets'))) {
  if (!keep.has(f)) await rm(path.join(dist, 'assets', f), { force: true });
}

console.log(`Built ${pages.length + 2} pages into dist/ (app: ${appSrc})`);
