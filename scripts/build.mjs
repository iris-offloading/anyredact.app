// Builds the static site into dist/: bundles the client, then renders one
// HTML page per tool plus the home page, sitemap and robots.txt.
import { build, transform } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { GUIDES, GUIDES_INDEX, PUBLISHED } from './guides.mjs';
import { howItWorks } from './diagrams.mjs';
import { CONTACT, LEGAL, UPDATED } from './legal.mjs';
import { logoMark } from './logo.mjs';
import { HOME, SITE, TOOLS } from './pages.mjs';
import { PRICING } from './pricing.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const require = createRequire(import.meta.url);

// Sitemap lastmod: the last commit that touched a page's content. Without git
// history the build date stands in.
const today = new Date().toISOString().slice(0, 10);
const modified = (...files) => {
  try {
    return execFileSync('git', ['log', '-1', '--format=%cs', '--', ...files], { cwd: root, encoding: 'utf8' }).trim() || today;
  } catch {
    return today;
  }
};
const toolsModified = modified('scripts/pages.mjs', 'scripts/diagrams.mjs');
const guidesModified = modified('scripts/guides.mjs', 'scripts/diagrams.mjs');

// Overwrite in place and prune stale assets at the end, rather than deleting
// dist/ up front: `wrangler dev` serves from it while rebuilding.
await mkdir(path.join(dist, 'assets'), { recursive: true });

const pdfjsVersion = require('pdfjs-dist/package.json').version;
const pdfWorker = `/assets/pdf.worker-${pdfjsVersion}.min.mjs`;
const univerVersion = JSON.parse(await readFile(path.join(root, 'node_modules/@univerjs/preset-sheets-core/package.json'), 'utf8')).version;
const univerCss = `/assets/univer-${univerVersion}.css`;
const mediapipeVersion = JSON.parse(await readFile(path.join(root, 'node_modules/@mediapipe/tasks-vision/package.json'), 'utf8')).version;

const result = await build({
  entryPoints: { app: path.join(root, 'src/client/main.ts'), account: path.join(root, 'src/client/account.ts'), pricing: path.join(root, 'src/client/pricing.ts') },
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
const pricingSrc = entrySrc('pricing');

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

function nav(current) {
  const links = [{ slug: '', nav: 'All formats' }, ...TOOLS]
    .map((t) => `<a href="/${t.slug}"${t.slug === current ? ' aria-current="page"' : ''}>${esc(t.nav)}</a>`)
    .join('');
  return `<header class="site-header"><div class="wrap">
  <a class="logo" href="/">${logoMark(28)}AnyRedact</a>
  <nav aria-label="Tools">${links}</nav>
  <div class="header-actions"><a class="header-link guides-link" href="/guides"${current.startsWith('guides') ? ' aria-current="page"' : ''}>Guides</a><a class="header-link" href="/pricing"${current === 'pricing' ? ' aria-current="page"' : ''}>Pricing</a>${themeButton}<a class="btn signin-link" href="/account">Sign in</a></div>
</div></header>`;
}

const GUIDES_INDEX_LINK = { slug: 'guides', nav: 'Guides' };

function footer() {
  const tools = TOOLS.map((t) => `<li><a href="/${t.slug}">${esc(t.name)}</a></li>`).join('');
  const about = [GUIDES_INDEX_LINK, PRICING, ...LEGAL].map((p) => `<li><a href="/${p.slug}">${esc(p.nav)}</a></li>`).join('');
  return `<footer class="site-footer"><div class="wrap">
  <div><strong class="logo">${logoMark(24)}AnyRedact</strong><p>${esc(SITE.tagline)}.</p></div>
  <div><h2>Tools</h2><ul>${tools}</ul></div>
  <div><h2>About</h2><ul>${about}<li><button type="button" class="footer-link" data-consent>Cookie settings</button></li></ul></div>
</div></footer>`;
}

// Every page's JSON-LD is one @graph: the site and its publisher, the page itself,
// then the page's own nodes, linked by @id.
const ORG = `${SITE.origin}/#organization`;
const WEBSITE = `${SITE.origin}/#website`;
const ref = (id) => ({ '@id': id });

function ld(page, { type = 'WebPage', nodes = [], crumbs = [], extra = {} } = {}) {
  const pageUrl = url(page.slug);
  const trail = page.slug ? [[SITE.name, ''], ...crumbs, [page.h1, page.slug]] : [];
  const graph = [
    { '@type': 'WebSite', '@id': WEBSITE, url: url(''), name: SITE.name, description: SITE.tagline, inLanguage: 'en', publisher: ref(ORG) },
    { '@type': 'Organization', '@id': ORG, name: SITE.name, url: url(''), logo: { '@type': 'ImageObject', url: url('apple-touch-icon.png'), width: '180', height: '180' }, email: CONTACT },
    {
      '@type': type,
      '@id': `${pageUrl}#webpage`,
      url: pageUrl,
      name: page.title,
      description: page.description,
      inLanguage: 'en',
      isPartOf: ref(WEBSITE),
      ...(page.lastmod && { dateModified: page.lastmod }),
      ...(trail.length && { breadcrumb: ref(`${pageUrl}#breadcrumb`) }),
      ...extra,
    },
    ...nodes,
  ];
  if (trail.length) {
    graph.push({
      '@type': 'BreadcrumbList',
      '@id': `${pageUrl}#breadcrumb`,
      itemListElement: trail.map(([name, slug], i) => ({ '@type': 'ListItem', position: i + 1, name, item: url(slug) })),
    });
  }
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
}

// The home page describes AnyRedact itself (/pricing adds its offers); each tool page its own format.
const appId = (page) => (page.slug ? `${url(page.slug)}#app` : `${SITE.origin}/#app`);

function toolLd(page) {
  const app = {
    '@type': 'WebApplication',
    '@id': appId(page),
    name: page.slug ? `${SITE.name}: ${page.h1}` : SITE.name,
    url: url(page.slug),
    description: page.description,
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any (web browser)',
    browserRequirements: 'Requires JavaScript',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    provider: ref(ORG),
  };
  const faq = page.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } }));
  return ld(page, { type: 'FAQPage', nodes: [app], extra: { about: ref(app['@id']), mainEntity: faq } });
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
<meta property="og:type" content="${page.slug.startsWith('guides/') ? 'article' : 'website'}">
<meta property="og:site_name" content="${SITE.name}">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:url" content="${url(page.slug)}">
<meta property="og:image" content="${url('social.png')}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="AnyRedact">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/fonts/geist-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/styles.css?v=${cssHash}">
<script src="/theme.js?v=${themeHash}"></script>
<script src="/analytics.js?v=${analyticsHash}"></script>
${page.jsonLd ? `<script type="application/ld+json">${page.jsonLd}</script>` : ''}
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
  const points = page.points.map(([t, d]) => `<div class="point"><h2>${esc(t)}</h2><p>${esc(d)}</p></div>`).join('');
  const faq = page.faq.map((f, i) => `<details${i ? '' : ' open'}><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('');
  return layout(
    { ...page, tool: true, jsonLd: toolLd(page) },
    `<section class="hero wrap">
  <div class="hero-copy">
    <h1>${page.slug ? esc(page.h1) : esc(page.h1).replace('finds', '<span class="redacted">finds</span>')}</h1>
    <p class="lead">${esc(page.also ? `${page.lead} ${page.also}` : page.lead)}</p>
    ${page.cost ? `<p class="cost">${esc(page.cost(plans))}. <a href="/pricing">${plans.FREE_CREDITS} free credits a day</a></p>` : ''}
  </div>
  <div id="tool" class="tool" data-format="${page.format}" data-hint="${esc(page.hint)}">
    <noscript><p class="status error">AnyRedact runs in your browser and needs JavaScript enabled.</p></noscript>
  </div>
</section>
<section class="band"><div class="wrap points">${points}</div></section>
${page.slug ? howSection(page) : homeSections(page)}
<section class="wrap section faq"><h2>Frequently asked questions</h2><div class="faq-list">${faq}</div></section>
${page.slug ? relatedGuides(page.slug) : ''}`,
  );
}

const howSection = (page) => `<section class="wrap section"><h2>${esc(page.howTitle)}</h2>${howItWorks(page.art, page.how)}</section>
${page.topics.map(topicSection).join('\n')}`;

// Tool pages: a guide's subject as an H2, with its main points as H3s.
const topicSection = (t) =>
  `<section class="wrap section topic"><h2>${esc(t.h2)}</h2><p class="topic-intro">${esc(t.intro)}</p><div class="topic-items">${t.items.map(([h, d]) => `<div><h3>${esc(h)}</h3><p>${esc(d)}</p></div>`).join('')}</div></section>`;

const guideCards = (list) => `<div class="cards">${list.map((g) => `<a class="card" href="/guides/${g.slug}"><strong>${esc(g.h1)}</strong><span>${esc(g.summary)}</span></a>`).join('')}</div>`;

// Home only: the steps, a card per format, what detection covers and the latest guides.
function homeSections(page) {
  const steps = page.steps.map(([t, d]) => `<li><h3>${esc(t)}</h3><p>${esc(d)}</p></li>`).join('');
  const formats = TOOLS.map((t) => `<a class="card" href="/${t.slug}"><strong>${esc(t.name)}</strong><span>${esc(t.card)}</span></a>`).join('');
  const finds = page.finds.map(([t, d]) => `<div><dt>${esc(t)}</dt><dd>${esc(d)}</dd></div>`).join('');
  return `<section class="wrap section"><h2>Redact a file in three steps</h2><ol class="steps">${steps}</ol></section>
<section class="wrap section"><h2>Pick a format</h2><div class="cards">${formats}</div></section>
<section class="wrap section"><h2>What the AI looks for</h2><dl class="finds">${finds}</dl></section>
<section class="wrap section"><h2>Guides</h2>${guideCards(GUIDES.slice(0, 6))}<p class="more"><a href="/guides">All ${GUIDES.length} guides</a></p></section>`;
}

function relatedGuides(slug) {
  const list = GUIDES.filter((g) => g.tools?.includes(slug));
  return list.length ? `<section class="wrap section"><h2>Guides</h2>${guideCards(list)}</section>` : '';
}

// The pricing page and each tool page's cost read src/shared/pricing.ts, so they can't drift from checkout.
const pricingTs = await transform(await readFile(path.join(root, 'src/shared/pricing.ts'), 'utf8'), { loader: 'ts', format: 'esm' });
const plans = await import(`data:text/javascript;base64,${Buffer.from(pricingTs.code).toString('base64')}`);

const pages = [
  [HOME, 'index.html'],
  ...TOOLS.map((t) => [t, `${t.slug}.html`]),
];
for (const [page, file] of pages) await writeFile(path.join(dist, file), toolPage(page));

for (const page of LEGAL) {
  await writeFile(
    path.join(dist, `${page.slug}.html`),
    layout({ ...page, jsonLd: ld(page, { type: page.slug === 'contact' ? 'ContactPage' : 'WebPage' }) }, `<article class="wrap prose">\n<h1>${esc(page.h1)}</h1>${page.body}\n${page.dated === false ? '' : `<p class="updated">Last updated ${UPDATED}</p>\n`}</article>`),
  );
}

await mkdir(path.join(dist, 'guides'), { recursive: true });
// guides/index.html is served at /guides (html_handling drops the trailing slash).
await writeFile(
  path.join(dist, 'guides/index.html'),
  layout(
    {
      ...GUIDES_INDEX,
      jsonLd: ld(GUIDES_INDEX, {
        type: 'CollectionPage',
        extra: { mainEntity: { '@type': 'ItemList', itemListElement: GUIDES.map((g, i) => ({ '@type': 'ListItem', position: i + 1, name: g.h1, url: url(`guides/${g.slug}`) })) } },
      }),
    },
    `<article class="wrap guides"><h1>${esc(GUIDES_INDEX.h1)}</h1><p class="lead">${esc(GUIDES_INDEX.lead)}</p>${guideCards(GUIDES)}</article>`,
  ),
);
for (const g of GUIDES) {
  const page = { ...g, slug: `guides/${g.slug}` };
  const article = {
    '@type': 'Article',
    '@id': `${url(page.slug)}#article`,
    headline: g.h1,
    description: g.description,
    datePublished: PUBLISHED,
    dateModified: guidesModified,
    url: url(page.slug),
    image: url('social.png'),
    inLanguage: 'en',
    mainEntityOfPage: ref(`${url(page.slug)}#webpage`),
    author: ref(ORG),
    publisher: ref(ORG),
  };
  const pageLd = ld({ ...page, lastmod: guidesModified }, { nodes: [article], crumbs: [[GUIDES_INDEX.h1, 'guides']] });
  const tools = TOOLS.filter((t) => g.tools?.includes(t.slug));
  const others = GUIDES.filter((o) => o !== g && (o.tools ?? []).some((t) => g.tools?.includes(t))).concat(GUIDES.filter((o) => o !== g && !o.tools)).slice(0, 2);
  const next = [
    ...tools.map((t) => `<a class="card" href="/${t.slug}"><strong>${esc(t.name)}</strong><span>${esc(t.card)}</span></a>`),
    ...others.map((o) => `<a class="card" href="/guides/${o.slug}"><strong>${esc(o.h1)}</strong><span>${esc(o.summary)}</span></a>`),
  ].join('');
  await writeFile(
    path.join(dist, `${page.slug}.html`),
    layout(
      { ...page, jsonLd: pageLd },
      `<article class="wrap prose guide">\n<p class="crumbs"><a href="/guides">${esc(GUIDES_INDEX.h1)}</a></p>\n<h1>${esc(g.h1)}</h1>${g.body}</article>\n<section class="wrap guide-next"><h2>Related</h2><div class="cards">${next}</div></section>`,
    ),
  );
}

await writeFile(
  path.join(dist, '404.html'),
  layout(
    { slug: '404', title: 'Page not found | AnyRedact', description: 'Page not found.' },
    `<article class="wrap solo"><h1>Page not found</h1><p>Try the <a href="/">redaction tool</a> instead.</p></article>`,
  ).replace('<link rel="canonical" href="https://anyredact.app/404">', '<meta name="robots" content="noindex">'),
);

await writeFile(
  path.join(dist, 'account.html'),
  layout(
    {
      slug: 'account',
      title: 'Account | AnyRedact',
      description: 'Sign in to see your balance, manage your plan or buy more credits.',
      script: accountSrc,
    },
    `<article class="wrap solo"><div id="account"></div></article>`,
  ).replace('<link rel="canonical" href="https://anyredact.app/account">', '<meta name="robots" content="noindex">'),
);

await writeFile(path.join(dist, 'pricing.html'), layout({ ...PRICING, script: pricingSrc, jsonLd: ld(PRICING, { nodes: [PRICING.app(plans, { '@id': `${SITE.origin}/#app`, url: url(''), provider: ref(ORG) })] }) }, PRICING.body(plans, esc)));

// /account and the 404 page are noindex, so they stay out.
const sitemapUrls = [
  ...['', ...TOOLS.map((t) => t.slug)].map((s) => [s, toolsModified]),
  ...['guides', ...GUIDES.map((g) => `guides/${g.slug}`)].map((s) => [s, guidesModified]),
  ['pricing', modified('scripts/pricing.mjs', 'src/shared/pricing.ts')],
  ...LEGAL.map((p) => [p.slug, modified('scripts/legal.mjs')]),
];
await writeFile(
  path.join(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map(([s, lastmod]) => `  <url><loc>${url(s)}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n')}
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

console.log(`Built ${pages.length + LEGAL.length + GUIDES.length + 4} pages into dist/ (app: ${appSrc})`);
