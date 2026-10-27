// Free daily AI allowance. Each visitor (a random browser ID) and each IP
// address gets its own Durable Object holding today's character count, so
// concurrent requests can't overspend. The IP allowance is larger, so people
// behind a shared office or mobile network don't block each other, but it
// still stops someone who clears their browser ID to start over.

import { clientNetwork } from './http.ts';

export interface QuotaEnv {
  QUOTA?: DurableObjectNamespace;
  FREE_CHARS_PER_DAY?: string;
}

// About 30 pages of dense text.
export const DEFAULT_FREE_CHARS = 100_000;
export const IP_MULTIPLIER = 5;

export interface QuotaState {
  used: number;
  limit: number;
}

const today = () => new Date().toISOString().slice(0, 10);

/** One counter per key and day. Plain fetch interface, so it needs no runtime-only imports. */
export class Quota {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const { amount = 0, limit, dryRun = false, once = false } = (await request.json()) as { amount?: number; limit: number; dryRun?: boolean; once?: boolean };
    // A one-time grant, such as the first free final check: ok only the first time.
    if (once) {
      const taken = (await this.state.storage.get<boolean>('once')) ?? false;
      if (!taken) await this.state.storage.put('once', true);
      return Response.json({ ok: !taken, used: 0, limit });
    }
    const day = today();
    const stored = (await this.state.storage.get<{ day: string; used: number }>('usage')) ?? { day, used: 0 };
    const used = stored.day === day ? stored.used : 0;
    // A first request larger than the whole allowance is still allowed once a day.
    const fits = used === 0 || used + amount <= limit;
    if (dryRun || !fits) return Response.json({ ok: fits, used, limit });
    await this.state.storage.put('usage', { day, used: used + amount });
    return Response.json({ ok: true, used: used + amount, limit });
  }
}

export function freeLimit(env: QuotaEnv): number {
  const n = Number(env.FREE_CHARS_PER_DAY);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FREE_CHARS;
}

const deviceOf = (request: Request) => {
  const device = request.headers.get('x-device-id');
  return device && /^[\w-]{8,64}$/.test(device) ? device : null;
};

function identities(request: Request, env: QuotaEnv): { key: string; limit: number }[] {
  const limit = freeLimit(env);
  const out = [{ key: `ip:${clientNetwork(request)}`, limit: limit * IP_MULTIPLIER }];
  const device = deviceOf(request);
  if (device) out.unshift({ key: `device:${device}`, limit });
  return out;
}

async function call(env: QuotaEnv, key: string, body: object): Promise<{ ok: boolean; used: number; limit: number }> {
  const stub = env.QUOTA!.get(env.QUOTA!.idFromName(key));
  const res = await stub.fetch('https://quota/', { method: 'POST', body: JSON.stringify(body) });
  return res.json();
}

/**
 * Charges `amount` characters to the visitor's allowances. Returns the
 * visitor's own (browser) state, or `exceeded` when any allowance is used up.
 * Without the binding (local dev) everything is allowed.
 */
export async function chargeQuota(request: Request, env: QuotaEnv, amount: number): Promise<{ exceeded: boolean; state?: QuotaState }> {
  if (!env.QUOTA) return { exceeded: false };
  const ids = identities(request, env);
  // Check every allowance first so a refused request doesn't use up any of them.
  const checks = await Promise.all(ids.map((id) => call(env, id.key, { dryRun: true, amount, limit: id.limit })));
  const blocked = checks.find((c) => !c.ok);
  if (blocked) return { exceeded: true, state: { used: checks[0].used, limit: checks[0].limit } };
  const results = await Promise.all(ids.map((id) => call(env, id.key, { amount, limit: id.limit })));
  const first = results[0];
  return { exceeded: results.some((r) => !r.ok), state: { used: first.used, limit: first.limit } };
}

export async function quotaStatus(request: Request, env: QuotaEnv): Promise<QuotaState | null> {
  if (!env.QUOTA) return null;
  const [id] = identities(request, env);
  const r = await call(env, id.key, { dryRun: true, limit: id.limit });
  return { used: r.used, limit: r.limit };
}

// Free first checks per network a day, so new browser IDs can't keep getting them.
const FREE_CHECKS_PER_IP = 3;

/** True once per browser: its first final check is free. Without the binding (local dev) never. */
export async function takeFreeCheck(request: Request, env: QuotaEnv): Promise<boolean> {
  const device = deviceOf(request);
  if (!env.QUOTA || !device) return false;
  const ip = `free-check:ip:${clientNetwork(request)}`;
  if (!(await call(env, ip, { dryRun: true, amount: 1, limit: FREE_CHECKS_PER_IP })).ok) return false;
  if (!(await call(env, `free-check:device:${device}`, { once: true, limit: 1 })).ok) return false;
  await call(env, ip, { amount: 1, limit: FREE_CHECKS_PER_IP });
  return true;
}
