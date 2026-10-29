// Free daily AI allowance. Each visitor (a random browser ID) and each IP
// address gets its own Durable Object holding today's credit count, so
// concurrent requests can't overspend. The IP allowance is larger, so people
// behind a shared office or mobile network don't block each other, but it
// still stops someone who clears their browser ID to start over.

import { FREE_CREDITS } from '../shared/pricing.ts';
import { clientNetwork } from './http.ts';
import { turnstileSiteKey, verifyTurnstile, type TurnstileEnv } from './turnstile.ts';

export interface QuotaEnv extends TurnstileEnv {
  QUOTA?: DurableObjectNamespace;
}

export const IP_MULTIPLIER = 5;
// An unused free-check pass is dropped after this, so a scan's Durable Object doesn't keep storage forever.
const PASS_MS = 7 * 86_400_000;

export interface QuotaState {
  used: number;
  limit: number;
}

interface QuotaReply extends QuotaState {
  ok: boolean;
  /** Passed Turnstile today. */
  human?: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);

/** One counter per key and day. Plain fetch interface, so it needs no runtime-only imports. */
export class Quota {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const { amount = 0, limit, dryRun = false, grant = false, redeem = false, human = false } = (await request.json()) as {
      amount?: number;
      limit: number;
      dryRun?: boolean;
      grant?: boolean;
      redeem?: boolean;
      /** Marks the key as having passed Turnstile today. */
      human?: boolean;
    };
    // A one-time pass for up to `limit` characters, such as a scan's free final check: granted once, redeemed once.
    if (grant) {
      await this.state.storage.put('pass', limit);
      await this.state.storage.setAlarm(Date.now() + PASS_MS);
      return Response.json({ ok: true, used: 0, limit });
    }
    if (redeem) {
      const pass = await this.state.storage.get<number | boolean>('pass');
      // Passes granted before the size limit hold `true`.
      const ok = pass === true || (typeof pass === 'number' && amount <= pass);
      if (ok) await this.state.storage.delete('pass');
      return Response.json({ ok, used: 0, limit });
    }
    const day = today();
    // Counts kept in characters before credits, under 'usage', are ignored.
    const stored = (await this.state.storage.get<{ day: string; used: number }>('credits')) ?? { day, used: 0 };
    const used = stored.day === day ? stored.used : 0;
    // Like the allowance, a pass lasts until midnight UTC.
    const passed = human || (await this.state.storage.get<string>('human')) === day;
    // A first request larger than the whole allowance is still allowed once a day.
    const fits = used === 0 || used + amount <= limit;
    if (dryRun || !fits) return Response.json({ ok: fits, used, limit, human: passed });
    if (human) await this.state.storage.put('human', day);
    // A negative amount gives back a charge whose model call failed.
    const next = Math.max(0, used + amount);
    await this.state.storage.put('credits', { day, used: next });
    return Response.json({ ok: true, used: next, limit, human: passed });
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }
}

function identities(request: Request): { key: string; limit: number }[] {
  const limit = FREE_CREDITS;
  const out = [{ key: `ip:${clientNetwork(request)}`, limit: limit * IP_MULTIPLIER }];
  const device = request.headers.get('x-device-id');
  if (device && /^[\w-]{8,64}$/.test(device)) out.unshift({ key: `device:${device}`, limit });
  return out;
}

async function call(env: QuotaEnv, key: string, body: object): Promise<QuotaReply> {
  const stub = env.QUOTA!.get(env.QUOTA!.idFromName(key));
  const res = await stub.fetch('https://quota/', { method: 'POST', body: JSON.stringify(body) });
  return res.json();
}

/**
 * Charges `amount` credits to the visitor's allowances. Returns the
 * visitor's own (browser) state, or `exceeded` when any allowance is used up.
 * The first charge of the day needs a Turnstile token (x-turnstile header)
 * unless `exempt` resolves true; without one it returns `unverified` and
 * charges nothing. Without the binding (local dev) everything is allowed.
 */
export async function chargeQuota(
  request: Request,
  env: QuotaEnv,
  amount: number,
  exempt: Promise<boolean> = Promise.resolve(false),
): Promise<{ exceeded: boolean; unverified?: boolean; state?: QuotaState; refund: () => Promise<void> }> {
  const none = async () => {};
  if (!env.QUOTA) return { exceeded: false, refund: none };
  const ids = identities(request);
  const token = request.headers.get('x-turnstile');
  const verified = turnstileSiteKey(env) && token ? verifyTurnstile(request, env, token) : Promise.resolve(false);
  // Check every allowance first so a refused request doesn't use up any of them.
  const checks = await Promise.all(ids.map((id) => call(env, id.key, { dryRun: true, amount, limit: id.limit })));
  const blocked = checks.find((c) => !c.ok);
  if (blocked) return { exceeded: true, state: { used: checks[0].used, limit: checks[0].limit }, refund: none };
  // The browser's own pass counts (the IP's when it sends no ID), so a new browser ID means a new check.
  const human = await verified;
  if (turnstileSiteKey(env) && !checks[0].human && !human && !(await exempt)) return { exceeded: false, unverified: true, refund: none };
  const results = await Promise.all(ids.map((id) => call(env, id.key, { amount, limit: id.limit, human })));
  const first = results[0];
  const refund = async () => {
    await Promise.all(ids.filter((_, i) => results[i].ok).map((id) => call(env, id.key, { amount: -amount, limit: id.limit })));
  };
  return { exceeded: results.some((r) => !r.ok), state: { used: first.used, limit: first.limit }, refund };
}

export async function quotaStatus(request: Request, env: QuotaEnv): Promise<QuotaState | null> {
  if (!env.QUOTA) return null;
  const [id] = identities(request);
  const r = await call(env, id.key, { dryRun: true, limit: id.limit });
  return { used: r.used, limit: r.limit };
}

/**
 * Each scan comes with one free final check of up to `chars` characters:
 * returns its token, or undefined without the binding (local dev). Passing an
 * existing token grants it again, after a check that failed.
 */
export async function grantFreeCheck(env: QuotaEnv, chars: number, token: string = crypto.randomUUID()): Promise<string | undefined> {
  if (!env.QUOTA) return undefined;
  await call(env, `free-check:${token}`, { grant: true, limit: chars });
  return token;
}

/** True when the token is a scan's unused free check that covers `chars`, which it then uses up. */
export async function redeemFreeCheck(env: QuotaEnv, token: unknown, chars: number): Promise<boolean> {
  if (!env.QUOTA || typeof token !== 'string' || !/^[\w-]{36}$/.test(token)) return false;
  return (await call(env, `free-check:${token}`, { redeem: true, amount: chars, limit: 1 })).ok;
}
