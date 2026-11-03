// Cloudflare Turnstile, which asks bots to prove they're people: a signed-out
// visitor's first AI request of the day (src/worker/quota.ts) and every
// sign-in email (src/worker/accounts.ts). Off until both keys are set.

import { json } from './http.ts';

export interface TurnstileEnv {
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** The site key the page renders the widget with, or undefined while Turnstile is off. */
export const turnstileSiteKey = (env: TurnstileEnv) => (env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY ? env.TURNSTILE_SITE_KEY : undefined);

/** True when Cloudflare accepts the widget's token. Each token works once. */
export async function verifyTurnstile(request: Request, env: TurnstileEnv, token: unknown): Promise<boolean> {
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET_KEY!);
  form.append('response', token);
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) form.append('remoteip', ip);
  try {
    const res = await fetch(VERIFY_URL, { method: 'POST', body: form });
    const result = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
    if (!result.success) console.warn('turnstile refused', result['error-codes']);
    return !!result.success;
  } catch (err) {
    console.error('turnstile verify failed', err);
    return false;
  }
}

/** The 403 a page answers by showing the widget and sending the request again with its token. */
export const turnstileRequired = (env: TurnstileEnv, error = 'Please confirm you are human.') =>
  json({ error, code: 'turnstile', siteKey: turnstileSiteKey(env) }, 403);
