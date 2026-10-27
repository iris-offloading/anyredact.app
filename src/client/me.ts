// The signed-in account as /api/me returns it, shared by /account and /pricing.

export interface Activity {
  /** A format, check, credits (bought once), free (the daily refill), plan, refund or dispute. */
  kind: string;
  /** Signed: spent credits are negative. */
  credits: number;
  cents: number | null;
  at: number;
}

export interface User {
  email: string | null;
  plan: { credits: number; used: number; renews: number; ending: boolean } | null;
  /** One-off credits, which never expire. */
  credits: number;
  canManage: boolean;
  activity?: Activity[];
}

export interface Me {
  user: User | null;
  signIn?: { email: boolean; google: boolean };
}

/** POSTs JSON to an account route. Failures come back as { error }. */
export async function post(path: string, body: unknown = {}): Promise<{ url?: string; error?: string; ok?: boolean }> {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return await res.json().catch(() => ({ error: `Request failed (${res.status}).` }));
  } catch {
    return { error: 'Could not reach the server. Please try again.' };
  }
}

export const fetchMe = (): Promise<Me> =>
  fetch('/api/me')
    .then((r) => r.json() as Promise<Me>)
    .catch(() => ({ user: null }));

export const planLeft = (user: User) => (user.plan ? Math.max(0, user.plan.credits - user.plan.used) : 0);

/** Paid credits left: the plan's and the one-off ones. Rises once a payment lands. */
export const paidLeft = (user: User) => planLeft(user) + user.credits;

// The paid balance before checkout, so /account can tell when the payment has landed.
const PAID_BASE_KEY = 'anyredact-paid-base';

export function rememberPaidBase(user: User | null) {
  try {
    if (user) sessionStorage.setItem(PAID_BASE_KEY, String(paidLeft(user)));
  } catch {}
}

export function paidBase(): number | null {
  try {
    const v = sessionStorage.getItem(PAID_BASE_KEY);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}

export function forgetPaidBase() {
  try {
    sessionStorage.removeItem(PAID_BASE_KEY);
  } catch {}
}
