// Small helpers shared by the Worker's routes.

export const now = () => Math.floor(Date.now() / 1000);

export const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Headers with a Set-Cookie line per cookie. */
export function withCookies(init: Record<string, string>, cookies: string[]): Headers {
  const headers = new Headers(init);
  for (const c of cookies) headers.append('set-cookie', c);
  return headers;
}

export function json(body: unknown, status = 200, cookies: string[] = []) {
  const headers = withCookies({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, cookies);
  return new Response(JSON.stringify(body), { status, headers });
}

/** True when a browser sent the request from another site. */
export function crossOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch {
    // "null" (sandboxed frames, file:// pages) or garbage: not this site.
    return true;
  }
}

export interface Limiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

/**
 * The visitor's network for limits and allowances: the IPv4 address, or the
 * /64 prefix of an IPv6 address, since one connection is usually handed a whole
 * /64 and could otherwise start over with every address in it.
 */
export function clientNetwork(request: Request): string {
  const ip = request.headers.get('cf-connecting-ip') || 'anon';
  if (!ip.includes(':')) return ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

/** Counts the request against the per-IP limiter; true when over the limit. */
export async function rateLimited(request: Request, limiter: Limiter | undefined, prefix = ''): Promise<boolean> {
  if (!limiter) return false;
  const { success } = await limiter.limit({ key: prefix + clientNetwork(request) });
  return !success;
}

/**
 * Preview-only benchmark features (choosing the model, batches, raw calls). Preview
 * URLs are public, so they also need the TRIAL_KEY secret in an x-trial-key header.
 */
export function trialsAllowed(request: Request, env: { MODEL_TRIALS?: string; TRIAL_KEY?: string }): boolean {
  return env.MODEL_TRIALS === '1' && !!env.TRIAL_KEY && request.headers.get('x-trial-key') === env.TRIAL_KEY;
}

export function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The checks every AI route runs first. Returns the error response to send, or null. */
export async function aiGuard(request: Request, ai: unknown, limiter: Limiter | undefined, unavailable: string, prefix = ''): Promise<Response | null> {
  if (!ai) return json({ error: unavailable }, 503);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (crossOrigin(request)) return json({ error: 'Forbidden' }, 403);
  if (await rateLimited(request, limiter, prefix)) return json({ error: 'Too many requests. Please wait a minute and try again.' }, 429);
  return null;
}

// A 4 MB picture as a base64 data URL, with room for the JSON around it.
export const MAX_POST_BYTES = 6 * 1024 * 1024;

/** aiGuard, then the parsed JSON body. Returns the body, or the error response to send. */
export async function readAiPost(request: Request, env: { AI?: unknown; DETECT_LIMITER?: Limiter }, unavailable: string, maxBytes = MAX_POST_BYTES): Promise<Response | Record<string, unknown>> {
  const refused = await aiGuard(request, env.AI, env.DETECT_LIMITER, unavailable);
  if (refused) return refused;
  if (Number(request.headers.get('content-length')) > maxBytes) return json({ error: 'Request is too large.' }, 413);
  try {
    const body = await request.json();
    // Valid JSON that isn't an object carries no fields; each route answers it as empty input.
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
}

/** A model's answer as an object: as given, or the first {...} in its text. */
export function modelJson(content: unknown): unknown {
  if (typeof content !== 'string') return content;
  const m = content.match(/\{[\s\S]*\}/);
  try {
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}
