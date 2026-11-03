// Sign-in for paying users: an emailed link (via Cloudflare Email Service) or Google. Free use
// needs no account. Sessions are random tokens in an HttpOnly cookie; only
// their SHA-256 hashes are stored.
import { recentActivity } from './activity.ts';
import { stripe } from './billing.ts';
import { loginEmail } from './email.ts';
import { crossOrigin, hex, json, now, rateLimited, withCookies, type Limiter } from './http.ts';
import { turnstileRequired, turnstileSiteKey, verifyTurnstile, type TurnstileEnv } from './turnstile.ts';

export interface AccountsEnv extends TurnstileEnv {
  DB?: D1Database;
  DETECT_LIMITER?: Limiter;
  EMAIL?: { send(message: { from: string; to: string; subject: string; text: string; html?: string }): Promise<{ messageId: string }> };
  EMAIL_FROM?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  STRIPE_SECRET_KEY?: string;
}

export interface User {
  id: string;
  email: string | null;
  stripe_customer: string | null;
  /** The monthly plan's Stripe subscription, its credits per period and how many are used. */
  plan_subscription: string | null;
  plan_credits: number;
  plan_used: number;
  plan_period_end: number;
  /** One-off credits, which never expire. Below zero after a refund or dispute of spent credits. */
  credits: number;
}

const SESSION_DAYS = 30;
const LOGIN_MINUTES = 15;

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

function cookie(request: Request, name: string): string | null {
  const m = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

const setCookie = (name: string, value: string, maxAge: number) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

// Readable by page scripts only to label the header link; carries no identity.
const signedInHint = (on: boolean) => `signed_in=${on ? 1 : ''}; Path=/; Secure; SameSite=Lax; Max-Age=${on ? SESSION_DAYS * 86400 : 0}`;

const redirect = (location: string, cookies: string[] = []) => new Response(null, { status: 302, headers: withCookies({ location }, cookies) });

export async function currentUser(request: Request, env: AccountsEnv): Promise<User | null> {
  const token = cookie(request, 'session');
  if (!token || !env.DB) return null;
  return env.DB.prepare(
    'SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?',
  )
    .bind(await sha256(token), now())
    .first<User>();
}

async function startSession(env: AccountsEnv, userId: string): Promise<string> {
  const token = randomToken();
  await env.DB!.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').bind(userId, now()).run();
  await env.DB!.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), userId, now() + SESSION_DAYS * 86400)
    .run();
  return setCookie('session', token, SESSION_DAYS * 86400);
}

/** Finds or creates the user for a verified email, linking a Google account when given. */
export async function upsertUser(env: AccountsEnv, email: string, googleSub?: string): Promise<string> {
  const db = env.DB!;
  const found = googleSub
    ? await db.prepare('SELECT id FROM users WHERE google_sub = ? OR email = ? ORDER BY google_sub IS NULL LIMIT 1').bind(googleSub, email).first<{ id: string }>()
    : await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
  if (found) {
    if (googleSub) await db.prepare('UPDATE users SET google_sub = ? WHERE id = ? AND google_sub IS NULL').bind(googleSub, found.id).run();
    return found.id;
  }
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO users (id, email, google_sub, created_at) VALUES (?, ?, ?, ?)').bind(id, email, googleSub ?? null, now()).run();
  return id;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

// Unused links per address, so nobody can flood someone's inbox from many IPs.
const MAX_OPEN_LINKS = 3;

async function sendLoginEmail(env: AccountsEnv, origin: string, email: string): Promise<Response> {
  if (!env.EMAIL) return json({ error: 'Email sign-in is not configured on this server.' }, 503);
  await env.DB!.prepare('DELETE FROM login_tokens WHERE expires_at < ?').bind(now()).run();
  const open = await env.DB!.prepare('SELECT COUNT(*) AS n FROM login_tokens WHERE email = ?').bind(email).first<{ n: number }>();
  if ((open?.n ?? 0) >= MAX_OPEN_LINKS) return json({ error: 'Too many sign-in links requested for this address. Please use the latest link or try again in 15 minutes.' }, 429);
  const token = randomToken();
  await env.DB!.prepare('INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), email, now() + LOGIN_MINUTES * 60)
    .run();
  // The token sits in the hash, so only the page's script sends it: a plain fetch of the link spends nothing.
  const link = `${origin}/account#signin=${encodeURIComponent(token)}`;
  try {
    await env.EMAIL.send({
      from: env.EMAIL_FROM || 'sign-in@anyredact.app',
      to: email,
      ...loginEmail(origin, link, LOGIN_MINUTES),
    });
  } catch (err) {
    console.error('email send failed', (err as { code?: string }).code, (err as Error).message);
    return json({ error: 'Could not send the sign-in email. Please try again.' }, 502);
  }
  return json({ ok: true });
}

/**
 * Deletes the signed-in account: its Stripe customer first, which cancels a plan
 * at once so it can't renew, then its sessions, purchases and row. Stripe keeps
 * its own payment records, which tax law needs.
 */
async function deleteAccount(request: Request, env: AccountsEnv): Promise<Response> {
  if (crossOrigin(request)) return json({ error: 'Forbidden' }, 403);
  const user = await currentUser(request, env);
  if (!user) return json({ error: 'Please sign in first.' }, 401);
  if (user.stripe_customer) {
    if (!env.STRIPE_SECRET_KEY) return json({ error: 'Could not delete your account. Please try again.' }, 503);
    try {
      await stripe(env, `customers/${encodeURIComponent(user.stripe_customer)}`, {}, { method: 'DELETE' });
    } catch (err) {
      // Already deleted in Stripe: nothing left to cancel.
      if (!/No such customer/i.test((err as Error).message)) {
        console.error('stripe customer delete failed', err);
        return json({ error: 'Could not delete your account. Please try again.' }, 502);
      }
    }
  }
  const db = env.DB!;
  // On its own, since the table may not exist yet (migration 0003).
  await db.prepare('DELETE FROM activity WHERE user_id = ?').bind(user.id).run().catch(() => {});
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM purchases WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM login_tokens WHERE email = ?').bind(user.email ?? ''),
    db.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
  return json({ ok: true }, 200, [setCookie('session', '', 0), signedInHint(false)]);
}

/** Whether a plan was cancelled and stops at the end of its period. False when Stripe can't say. */
async function planEnding(env: AccountsEnv, subscription: string): Promise<boolean> {
  if (!env.STRIPE_SECRET_KEY) return false;
  try {
    const sub = await stripe<{ cancel_at_period_end?: boolean; cancel_at?: number | null }>(env, `subscriptions/${encodeURIComponent(subscription)}`, {}, { method: 'GET' });
    return !!(sub.cancel_at_period_end || sub.cancel_at);
  } catch {
    return false;
  }
}

/** Handles /api/auth/* and /api/me. Returns null for other paths. */
/** What /api/me returns, also written into the /account page so it renders without a request. */
export async function me(request: Request, env: AccountsEnv) {
  const user = env.DB ? await currentUser(request, env) : null;
  if (!user) return { user: null, signIn: { email: !!env.EMAIL, google: !!env.GOOGLE_CLIENT_ID, turnstile: turnstileSiteKey(env) } };
  const planActive = !!user.plan_subscription && user.plan_period_end > now();
  return {
    user: {
      email: user.email,
      plan: planActive ? { credits: user.plan_credits, used: user.plan_used, renews: user.plan_period_end, ending: await planEnding(env, user.plan_subscription!) } : null,
      credits: user.credits,
      canManage: !!user.stripe_customer,
      activity: (await recentActivity(env.DB!, user.id)).filter((a) => a.credits),
    },
  };
}

export async function handleAccounts(request: Request, env: AccountsEnv, url: URL): Promise<Response | null> {
  const path = url.pathname;
  if (!path.startsWith('/api/auth/') && path !== '/api/me') return null;
  if (!env.DB) return json({ error: 'Accounts are not configured on this server.' }, 503);
  const origin = url.origin;

  if (path === '/api/me' && request.method === 'DELETE') return deleteAccount(request, env);

  if (path === '/api/me') return json(await me(request, env));

  if (path === '/api/auth/email' && request.method === 'POST') {
    if (crossOrigin(request)) return json({ error: 'Forbidden' }, 403);
    if (await rateLimited(request, env.DETECT_LIMITER, 'login:')) return json({ error: 'Too many requests. Please wait a minute and try again.' }, 429);
    const { email, turnstile } = (await request.json().catch(() => ({}))) as { email?: unknown; turnstile?: unknown };
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) return json({ error: 'Please enter a valid email address.' }, 400);
    // Every link needs a fresh pass, so nobody can script sign-in emails to other people.
    if (turnstileSiteKey(env) && !(await verifyTurnstile(request, env, turnstile))) return turnstileRequired(env, 'Please complete the security check below and try again.');
    return sendLoginEmail(env, origin, email.trim().toLowerCase());
  }

  if (path === '/api/auth/email/verify' && request.method === 'POST') {
    if (crossOrigin(request)) return json({ error: 'Forbidden' }, 403);
    const { token } = (await request.json().catch(() => ({}))) as { token?: unknown };
    const row = await env.DB.prepare('DELETE FROM login_tokens WHERE token_hash = ? RETURNING email, expires_at')
      .bind(await sha256(typeof token === 'string' ? token : ''))
      .first<{ email: string; expires_at: number }>();
    if (!row || row.expires_at < now()) return json({ error: 'This sign-in link has expired or has already been used. Please request a new one.' }, 400);
    const userId = await upsertUser(env, row.email);
    return json({ ok: true }, 200, [await startSession(env, userId), signedInHint(true)]);
  }

  if (path === '/api/auth/google') {
    if (!env.GOOGLE_CLIENT_ID) return redirect('/account?error=google');
    const state = randomToken();
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: `${origin}/api/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email',
      state,
      prompt: 'select_account',
    });
    return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, [setCookie('oauth_state', state, 600)]);
  }

  if (path === '/api/auth/google/callback') {
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    if (!state || !code || state !== cookie(request, 'oauth_state') || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      return redirect('/account?error=google');
    }
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${origin}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = (await res.json().catch(() => ({}))) as { id_token?: string };
    // The ID token comes straight from Google over TLS, so its claims can be read without re-verifying the signature.
    const claims = tokens.id_token ? JSON.parse(atob(tokens.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) : null;
    if (!res.ok || !claims?.sub || !claims.email || !claims.email_verified || claims.aud !== env.GOOGLE_CLIENT_ID) {
      return redirect('/account?error=google');
    }
    const userId = await upsertUser(env, String(claims.email).toLowerCase(), String(claims.sub));
    return redirect('/account', [await startSession(env, userId), signedInHint(true), setCookie('oauth_state', '', 0)]);
  }

  if (path === '/api/auth/logout' && request.method === 'POST') {
    const token = cookie(request, 'session');
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    return json({ ok: true }, 200, [setCookie('session', '', 0), signedInHint(false)]);
  }

  return json({ error: 'Not found' }, 404);
}
