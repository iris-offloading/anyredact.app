// Small helpers shared by the Worker's routes.

export const now = () => Math.floor(Date.now() / 1000);

export const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export function json(body: unknown, status = 200, cookies: string[] = []) {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  for (const c of cookies) headers.append('set-cookie', c);
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

/** Counts the request against the per-IP limiter; true when over the limit. */
export async function rateLimited(request: Request, limiter: Limiter | undefined, prefix = ''): Promise<boolean> {
  if (!limiter) return false;
  const { success } = await limiter.limit({ key: prefix + (request.headers.get('cf-connecting-ip') || 'anon') });
  return !success;
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

/** aiGuard, then the parsed JSON body. Returns the body, or the error response to send. */
export async function readAiPost(request: Request, env: { AI?: unknown; DETECT_LIMITER?: Limiter }, unavailable: string): Promise<Response | Record<string, unknown>> {
  const refused = await aiGuard(request, env.AI, env.DETECT_LIMITER, unavailable);
  if (refused) return refused;
  try {
    const body = await request.json();
    // Valid JSON that isn't an object carries no fields; each route answers it as empty input.
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
}
