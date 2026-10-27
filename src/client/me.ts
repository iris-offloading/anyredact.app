// The signed-in account as /api/me returns it, shared by /account and /pricing.

export interface User {
  email: string | null;
  plan: { credits: number; used: number; renews: number; ending: boolean } | null;
  /** One-off credits, which never expire. */
  credits: number;
  canManage: boolean;
}

export interface Me {
  user: User | null;
  signIn?: { email: boolean; google: boolean };
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
