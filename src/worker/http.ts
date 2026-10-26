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
  return !!origin && new URL(origin).host !== new URL(request.url).host;
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

/** The checks every AI route runs first. Returns the parsed JSON body, or the error response to send. */
export async function readAiPost(request: Request, env: { AI?: unknown; DETECT_LIMITER?: Limiter }, unavailable: string): Promise<Response | Record<string, unknown>> {
  if (!env.AI) return json({ error: unavailable }, 503);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (crossOrigin(request)) return json({ error: 'Forbidden' }, 403);
  if (await rateLimited(request, env.DETECT_LIMITER)) return json({ error: 'Too many requests. Please wait a minute and try again.' }, 429);
  try {
    const body = await request.json();
    if (body && typeof body === 'object') return body as Record<string, unknown>;
  } catch {}
  return json({ error: 'Invalid JSON' }, 400);
}
