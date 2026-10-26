// Sign-in for paying users: an emailed link (via Cloudflare Email Service) or Google. Free use
// needs no account. Sessions are random tokens in an HttpOnly cookie; only
// their SHA-256 hashes are stored.
import { crossOrigin, hex, json, now, rateLimited, type Limiter } from './http.ts';

export interface AccountsEnv {
  DB?: D1Database;
  DETECT_LIMITER?: Limiter;
  EMAIL?: { send(message: { from: string; to: string; subject: string; text: string }): Promise<{ messageId: string }> };
  EMAIL_FROM?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

export interface User {
  id: string;
  email: string | null;
  stripe_customer: string | null;
  sub_id: string | null;
  sub_pages: number;
  sub_used: number;
  sub_period_end: number;
  pack_pages: number;
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
  return m ? decodeURIComponent(m[1]) : null;
}

const setCookie = (name: string, value: string, maxAge: number) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

// Readable by page scripts only to label the header link; carries no identity.
const signedInHint = (on: boolean) => `signed_in=${on ? 1 : ''}; Path=/; Secure; SameSite=Lax; Max-Age=${on ? SESSION_DAYS * 86400 : 0}`;

const redirect = (location: string, cookies: string[] = []) => {
  const headers = new Headers({ location });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(null, { status: 302, headers });
};

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

async function sendLoginEmail(env: AccountsEnv, origin: string, email: string): Promise<Response> {
  if (!env.EMAIL) return json({ error: 'Email sign-in is not set up yet.' }, 503);
  const token = randomToken();
  await env.DB!.prepare('INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), email, now() + LOGIN_MINUTES * 60)
    .run();
  const link = `${origin}/auth/email/verify?token=${encodeURIComponent(token)}`;
  try {
    await env.EMAIL.send({
      from: env.EMAIL_FROM || 'sign-in@anyredact.app',
      to: email,
      subject: 'Your AnyRedact sign-in link',
      text: `Click to sign in to AnyRedact:\n\n${link}\n\nThe link works once and expires in ${LOGIN_MINUTES} minutes. If you didn't ask for it, ignore this email.`,
    });
  } catch (err) {
    console.error('email send failed', (err as { code?: string }).code, (err as Error).message);
    return json({ error: 'Could not send the email. Please try again.' }, 502);
  }
  return json({ ok: true });
}

/** Handles /auth/* and /api/me. Returns null for other paths. */
export async function handleAccounts(request: Request, env: AccountsEnv, url: URL): Promise<Response | null> {
  const path = url.pathname;
  if (!path.startsWith('/auth/') && path !== '/api/me') return null;
  if (!env.DB) return json({ error: 'Accounts are not set up on this server.' }, 503);
  const origin = url.origin;

  if (path === '/api/me') {
    const user = await currentUser(request, env);
    if (!user) return json({ user: null, signIn: { email: !!env.EMAIL, google: !!env.GOOGLE_CLIENT_ID } });
    const subActive = !!user.sub_id && user.sub_period_end > now();
    return json({
      user: {
        email: user.email,
        subscription: subActive ? { pages: user.sub_pages, used: user.sub_used, renews: user.sub_period_end } : null,
        packPages: user.pack_pages,
        canManage: !!user.stripe_customer,
      },
    });
  }

  if (path === '/auth/email' && request.method === 'POST') {
    if (crossOrigin(request)) return json({ error: 'Forbidden' }, 403);
    if (await rateLimited(request, env.DETECT_LIMITER, 'login:')) return json({ error: 'Too many requests. Please wait a minute.' }, 429);
    const { email } = (await request.json().catch(() => ({}))) as { email?: unknown };
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) return json({ error: 'Please enter a valid email address.' }, 400);
    return sendLoginEmail(env, origin, email.trim().toLowerCase());
  }

  if (path === '/auth/email/verify') {
    const token = url.searchParams.get('token') || '';
    const row = await env.DB.prepare('DELETE FROM login_tokens WHERE token_hash = ? RETURNING email, expires_at')
      .bind(await sha256(token))
      .first<{ email: string; expires_at: number }>();
    if (!row || row.expires_at < now()) return redirect('/account?error=link');
    const userId = await upsertUser(env, row.email);
    return redirect('/account', [await startSession(env, userId), signedInHint(true)]);
  }

  if (path === '/auth/google') {
    if (!env.GOOGLE_CLIENT_ID) return redirect('/account?error=google');
    const state = randomToken();
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: `${origin}/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email',
      state,
      prompt: 'select_account',
    });
    return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, [setCookie('oauth_state', state, 600)]);
  }

  if (path === '/auth/google/callback') {
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
        redirect_uri: `${origin}/auth/google/callback`,
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

  if (path === '/auth/logout' && request.method === 'POST') {
    const token = cookie(request, 'session');
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    return json({ ok: true }, 200, [setCookie('session', '', 0), signedInHint(false)]);
  }

  return json({ error: 'Not found' }, 404);
}
