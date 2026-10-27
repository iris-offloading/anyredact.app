// Paid pages through Stripe: Checkout for the monthly plans and one-off packs,
// the customer portal for managing the plan, and a webhook that credits
// accounts. Pages are spent after the free daily allowance: the monthly plan
// first, then packs, which never expire.
import { PRODUCTS, type Product } from '../shared/pricing.ts';
import { currentUser, type AccountsEnv, type User } from './accounts.ts';
import { crossOrigin, hex, json, now } from './http.ts';

export interface BillingEnv extends AccountsEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

/** Flattens nested params into Stripe's form encoding: a[b][0][c]=x. */
export function stripeForm(params: Record<string, unknown>, prefix = '', out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') stripeForm(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripe<T>(env: BillingEnv, path: string, params: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: stripeForm(params),
  });
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message || `Stripe ${path} failed (${res.status})`);
  return data;
}

async function customerFor(env: BillingEnv, user: User): Promise<string> {
  if (user.stripe_customer) return user.stripe_customer;
  const customer = await stripe<{ id: string }>(env, 'customers', { email: user.email ?? undefined, metadata: { user_id: user.id } });
  await env.DB!.prepare('UPDATE users SET stripe_customer = ? WHERE id = ?').bind(customer.id, user.id).run();
  return customer.id;
}

/** Verifies a Stripe-Signature header (HMAC-SHA256 over "timestamp.body"). */
export async function verifyStripeSignature(body: string, header: string | null, secret: string, toleranceSec = 300): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  const signatures = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!t || !signatures.length || Math.abs(now() - t) > toleranceSec) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`));
  const expected = hex(mac);
  return signatures.some((s) => s.length === expected.length && [...s].every((c, i) => c === expected[i]));
}

export interface PaidSpend {
  fromSub: number;
  fromPack: number;
}

/**
 * Spends paid pages: the monthly plan first, then packs. Returns null when the
 * account doesn't have enough. Uses compare-and-set so parallel requests can't overspend.
 */
export async function spendPaidPages(env: BillingEnv, userId: string, pages: number): Promise<PaidSpend | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const u = await env.DB!.prepare('SELECT sub_id, sub_pages, sub_used, sub_period_end, pack_pages FROM users WHERE id = ?')
      .bind(userId)
      .first<Pick<User, 'sub_id' | 'sub_pages' | 'sub_used' | 'sub_period_end' | 'pack_pages'>>();
    if (!u) return null;
    const subLeft = u.sub_id && u.sub_period_end > now() ? Math.max(0, u.sub_pages - u.sub_used) : 0;
    const fromSub = Math.min(subLeft, pages);
    const fromPack = pages - fromSub;
    if (fromPack > u.pack_pages) return null;
    const res = await env.DB!.prepare(
      'UPDATE users SET sub_used = sub_used + ?, pack_pages = pack_pages - ? WHERE id = ? AND sub_used = ? AND pack_pages = ?',
    )
      .bind(fromSub, fromPack, userId, u.sub_used, u.pack_pages)
      .run();
    if (res.meta.changes) return { fromSub, fromPack };
  }
  return null;
}

/** Gives back pages spent on a request whose model call failed. */
export async function refundPaidPages(env: BillingEnv, userId: string, spent: PaidSpend): Promise<void> {
  await env.DB!.prepare('UPDATE users SET sub_used = MAX(0, sub_used - ?), pack_pages = pack_pages + ? WHERE id = ?')
    .bind(spent.fromSub, spent.fromPack, userId)
    .run();
}

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, any> };
}

// Newer Stripe API versions moved the invoice's subscription under parent.subscription_details.
const invoiceSubscription = (invoice: Record<string, any>): string | undefined =>
  invoice.subscription ?? invoice.parent?.subscription_details?.subscription ?? undefined;

async function applyEvent(env: BillingEnv, event: StripeEvent): Promise<void> {
  const db = env.DB!;
  const obj = event.data.object;
  // A delayed payment method (a bank debit) completes the session unpaid and confirms later.
  const delayed = event.type === 'checkout.session.async_payment_succeeded';
  if (event.type === 'checkout.session.completed' || delayed) {
    const product = PRODUCTS.find((p) => p.id === obj.metadata?.product);
    const userId = obj.metadata?.user_id ?? obj.client_reference_id;
    if (!product || !userId) return;
    if (obj.mode === 'payment' && obj.payment_status === 'paid') {
      await db.prepare('UPDATE users SET pack_pages = pack_pages + ? WHERE id = ?').bind(product.pages, userId).run();
      // Kept for refunds. Never fails the event: the credits above are already granted, and a retry would grant them again.
      if (obj.payment_intent) {
        await db
          .prepare('INSERT OR IGNORE INTO purchases (payment_intent, user_id, pages, created_at) VALUES (?, ?, ?, ?)')
          .bind(obj.payment_intent, userId, product.pages, now())
          .run()
          .catch((err: unknown) => console.error('purchase not recorded', obj.payment_intent, err));
      }
    } else if (obj.mode === 'subscription' && !delayed) {
      // invoice.paid sets the exact period end; until then allow a month.
      await db
        .prepare('UPDATE users SET sub_id = ?, sub_pages = ?, sub_used = 0, sub_period_end = MAX(sub_period_end, ?), stripe_customer = COALESCE(stripe_customer, ?) WHERE id = ?')
        .bind(obj.subscription, product.pages, now() + 31 * 86400, obj.customer, userId)
        .run();
    }
  } else if (event.type === 'invoice.paid' && invoiceSubscription(obj)) {
    const periodEnd = obj.lines?.data?.[0]?.period?.end ?? now() + 31 * 86400;
    await db.prepare('UPDATE users SET sub_id = ?, sub_used = 0, sub_period_end = ? WHERE stripe_customer = ?').bind(invoiceSubscription(obj), periodEnd, obj.customer).run();
  } else if (event.type === 'charge.refunded' && obj.amount > 0) {
    await takeBack(db, obj.payment_intent, obj.customer, obj.amount_refunded / obj.amount);
  } else if (event.type === 'charge.dispute.created') {
    await takeBack(db, obj.payment_intent, null, 1);
  } else if (event.type === 'customer.subscription.deleted') {
    await db.prepare('UPDATE users SET sub_id = NULL, sub_pages = 0, sub_used = 0, sub_period_end = 0 WHERE sub_id = ?').bind(obj.id).run();
  }
}

/**
 * Takes back the credits a refunded or disputed payment bought, in proportion to
 * the amount returned. A pack's credits come off the balance even when already
 * spent, which can leave it negative. A plan payment ends this period's credits.
 */
async function takeBack(db: D1Database, paymentIntent: string | null, customer: string | null, share: number): Promise<void> {
  const purchase = paymentIntent
    ? await db.prepare('SELECT user_id, pages, taken FROM purchases WHERE payment_intent = ?').bind(paymentIntent).first<{ user_id: string; pages: number; taken: number }>()
    : null;
  if (purchase) {
    const due = Math.min(purchase.pages, Math.ceil(purchase.pages * share)) - purchase.taken;
    if (due <= 0) return;
    await db.prepare('UPDATE users SET pack_pages = pack_pages - ? WHERE id = ?').bind(due, purchase.user_id).run();
    await db.prepare('UPDATE purchases SET taken = taken + ? WHERE payment_intent = ?').bind(due, paymentIntent).run();
  } else if (customer) {
    await db.prepare('UPDATE users SET sub_used = sub_pages WHERE stripe_customer = ? AND sub_id IS NOT NULL').bind(customer).run();
  }
}

/** Handles /api/checkout, /api/portal and /api/stripe/webhook. Returns null for other paths. */
export async function handleBilling(request: Request, env: BillingEnv, url: URL): Promise<Response | null> {
  const path = url.pathname;
  if (path !== '/api/checkout' && path !== '/api/portal' && path !== '/api/stripe/webhook') return null;
  if (!env.DB || !env.STRIPE_SECRET_KEY) return json({ error: 'Payments are not set up yet.' }, 503);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (path === '/api/stripe/webhook') {
    const body = await request.text();
    if (!env.STRIPE_WEBHOOK_SECRET || !(await verifyStripeSignature(body, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET))) {
      return json({ error: 'Bad signature' }, 400);
    }
    const event = JSON.parse(body) as StripeEvent;
    const fresh = await env.DB.prepare('INSERT OR IGNORE INTO stripe_events (id, created_at) VALUES (?, ?)').bind(event.id, now()).run();
    if (fresh.meta.changes) {
      try {
        await applyEvent(env, event);
      } catch (err) {
        // Forget the event so Stripe's retry applies it, rather than losing the credits.
        console.error('stripe event failed', event.id, err);
        await env.DB.prepare('DELETE FROM stripe_events WHERE id = ?').bind(event.id).run();
        return json({ error: 'Could not apply the event.' }, 500);
      }
    }
    return json({ received: true });
  }

  if (crossOrigin(request)) return json({ error: 'Forbidden' }, 403);
  const user = await currentUser(request, env);
  if (!user) return json({ error: 'Please sign in first.' }, 401);

  if (path === '/api/portal') {
    if (!user.stripe_customer) return json({ error: 'No purchases yet.' }, 400);
    const portal = await stripe<{ url: string }>(env, 'billing_portal/sessions', { customer: user.stripe_customer, return_url: `${url.origin}/account` });
    return json({ url: portal.url });
  }

  const { product: id } = (await request.json().catch(() => ({}))) as { product?: string };
  const product: Product | undefined = PRODUCTS.find((p) => p.id === id);
  if (!product) return json({ error: 'Unknown product.' }, 400);
  // A second plan would charge twice while the account tracks only one.
  if (product.monthly && user.sub_id && user.sub_period_end > now()) return json({ error: 'You already have a plan. Cancel it under Manage plan first.' }, 409);
  const customer = await customerFor(env, user);
  const priceData = {
    currency: 'usd',
    unit_amount: product.cents,
    product_data: { name: product.monthly ? `AnyRedact ${product.name}, ${product.pages.toLocaleString('en-US')} credits a month` : `AnyRedact ${product.name}` },
    ...(product.monthly ? { recurring: { interval: 'month' } } : {}),
  };
  const session = await stripe<{ url: string }>(env, 'checkout/sessions', {
    mode: product.monthly ? 'subscription' : 'payment',
    customer,
    client_reference_id: user.id,
    line_items: [{ price_data: priceData, quantity: 1 }],
    metadata: { user_id: user.id, product: product.id },
    ...(product.monthly ? { subscription_data: { metadata: { user_id: user.id, product: product.id } } } : {}),
    success_url: `${url.origin}/account?paid=1`,
    cancel_url: `${url.origin}/account`,
  });
  return json({ url: session.url });
}
