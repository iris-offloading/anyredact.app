// Footer badge wall on the home page. Directory badge codes are stored in D1 as pasted
// (scripts/badges.mjs adds them); the Worker reads each code's link, image and
// alt text and writes its own markup, so nothing from a code reaches the page
// as HTML. The page gets the wall through HTMLRewriter, and its CSP gets the
// badge image origins in img-src.

export interface BadgesEnv {
  DB?: D1Database;
}

export interface Badge {
  href: string;
  src: string;
  alt: string;
  width?: number;
  height?: number;
}

interface Wall {
  html: string;
  origins: string[];
}

const TTL = 300;
const HEIGHT = 32;
const CACHE_KEY = 'https://anyredact.app/__badge-wall';
let memo: { at: number; wall: Wall } | null = null;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function httpsUrl(value: string | null): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

const size = (value: string | null) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 2000 ? n : undefined;
};

/** The first link and the first image in a pasted badge code, or null when either is missing or not https. */
export async function parseBadge(code: string): Promise<Badge | null> {
  let href: string | null = null;
  let title: string | null = null;
  let img: { src: string | null; alt: string | null; width: string | null; height: string | null } | null = null;
  await new HTMLRewriter()
    .on('a[href]', {
      element(el) {
        if (href === null) {
          href = el.getAttribute('href');
          title = el.getAttribute('title');
        }
      },
    })
    .on('img[src]', {
      element(el) {
        img ??= { src: el.getAttribute('src'), alt: el.getAttribute('alt'), width: el.getAttribute('width'), height: el.getAttribute('height') };
      },
    })
    .transform(new Response(code, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
    .arrayBuffer();
  const link = httpsUrl(href);
  const found = img as { src: string | null; alt: string | null; width: string | null; height: string | null } | null;
  const src = httpsUrl(found?.src ?? null);
  if (!link || !src || !found) return null;
  const alt = (found.alt || title || link.hostname).replace(/\s+/g, ' ').trim().slice(0, 120);
  return { href: link.href, src: src.href, alt, width: size(found.width), height: size(found.height) };
}

/** The wall's markup: two copies of the list scroll as one strip, the second hidden from screen readers and keyboards. */
export function wallHtml(badges: Badge[]): string {
  if (!badges.length) return '';
  const item = (b: Badge, copy: boolean) => {
    const width = b.width && b.height ? ` width="${Math.round((b.width * HEIGHT) / b.height)}"` : '';
    return `<li><a href="${esc(b.href)}" target="_blank" rel="noopener"${copy ? ' tabindex="-1"' : ''}><img src="${esc(b.src)}" alt="${copy ? '' : esc(b.alt)}"${width} height="${HEIGHT}" loading="lazy" decoding="async"></a></li>`;
  };
  const list = (copy: boolean) => `<ul${copy ? ' aria-hidden="true"' : ''}>${badges.map((b) => item(b, copy)).join('')}</ul>`;
  return `<div class="badge-wall" style="--badges:${badges.length}"><div class="badge-track">${list(false)}${list(true)}</div></div>`;
}

async function loadWall(env: BadgesEnv): Promise<Wall> {
  if (!env.DB) return { html: '', origins: [] };
  const { results } = await env.DB.prepare('SELECT code FROM badges ORDER BY position, id').all<{ code: string }>();
  const badges = (await Promise.all(results.map((r) => parseBadge(r.code)))).filter((b): b is Badge => !!b);
  return { html: wallHtml(badges), origins: [...new Set(badges.map((b) => new URL(b.src).origin))] };
}

/** The wall, cached for five minutes in this isolate and in the data centre's cache. */
export async function badgeWall(env: BadgesEnv, ctx?: ExecutionContext): Promise<Wall> {
  if (memo && Date.now() - memo.at < TTL * 1000) return memo.wall;
  const cache = typeof caches === 'undefined' ? null : caches.default;
  const hit = await cache?.match(CACHE_KEY).catch(() => undefined);
  let wall: Wall;
  if (hit) {
    wall = await hit.json();
  } else {
    wall = await loadWall(env).catch((err) => {
      console.error('badge wall', err);
      return { html: '', origins: [] };
    });
    const put = cache?.put(CACHE_KEY, new Response(JSON.stringify(wall), { headers: { 'cache-control': `max-age=${TTL}` } })).catch(() => {});
    if (put) ctx?.waitUntil(put);
  }
  memo = { at: Date.now(), wall };
  return wall;
}

/** A page with the wall in the footer's brand column and the badge image origins allowed by its CSP. */
export async function withBadgeWall(page: Response, env: BadgesEnv, ctx?: ExecutionContext): Promise<Response> {
  if (!(page.headers.get('content-type') ?? '').startsWith('text/html')) return page;
  const wall = await badgeWall(env, ctx);
  if (!wall.html) return page;
  const res = new HTMLRewriter()
    .on('.site-footer .footer-brand', {
      element(el) {
        el.append(wall.html, { html: true });
      },
    })
    .transform(page);
  const headers = new Headers(res.headers);
  headers.delete('etag');
  const csp = headers.get('content-security-policy');
  if (csp && wall.origins.length) headers.set('content-security-policy', csp.replace('img-src ', `img-src ${wall.origins.join(' ')} `));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
