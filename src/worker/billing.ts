// Paid credits through Stripe: Checkout for the monthly plans and one-off credits,
// the customer portal for managing the plan, and a webhook that credits
// accounts. Credits are spent after the free daily allowance: the monthly plan
// first, then one-off credits, which never expire.
import { findProduct } from '../shared/pricing.ts';
import { currentUser, type AccountsEnv, type User } from './accounts.ts';
import { crossOrigin, hex, json, now, rateLimited } from './http.ts';

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

/** Calls the Stripe API. GET and DELETE send `params` in the query; an idempotency key makes a retried write safe. */
export async function stripe<T>(
  env: { STRIPE_SECRET_KEY?: string },
  path: string,
  params: Record<string, unknown> = {},
  opts: { method?: 'GET' | 'POST' | 'DELETE'; idempotencyKey?: string } = {},
): Promise<T> {
  const method = opts.method ?? 'POST';
  const form = stripeForm(params);
  const query = method !== 'POST' && form.size ? `?${form}` : '';
  const headers: Record<string, string> = { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` };
  if (method === 'POST') headers['content-type'] = 'application/x-www-form-urlencoded';
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  const res = await fetch(`https://api.stripe.com/v1/${path}${query}`, { method, headers, body: method === 'POST' ? form : undefined });
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message || `Stripe ${path} failed (${res.status})`);
  return data;
}

/** The customer a charge belongs to, for a dispute, which doesn't name one. */
async function chargeCustomer(env: BillingEnv, charge: unknown): Promise<string | null> {
  if (typeof charge !== 'string') return null;
  return (await stripe<{ customer?: string | null }>(env, `charges/${encodeURIComponent(charge)}`, {}, { method: 'GET' })).customer ?? null;
}

/**
 * A second plan for an account that already has one (two checkouts finished in
 * different tabs): refunds its first payment and cancels it at once. The
 * payment is recorded as a purchase of no credits, so its refund leaves the
 * first plan alone. The cancel comes last because cancelling twice fails: a
 * retried event redoes the idempotent refund, then cancels.
 */
async function refundSecondPlan(env: BillingEnv, userId: string, subscription: string, invoice: unknown): Promise<void> {
  if (typeof invoice === 'string') {
    // Older API versions name the payment intent on the invoice, newer ones under its payments.
    const inv = await stripe<{ payment_intent?: string | null; payments?: { data?: { payment?: { payment_intent?: string } }[] } }>(
      env,
      `invoices/${encodeURIComponent(invoice)}`,
      { expand: ['payments'] },
      { method: 'GET' },
    );
    const paymentIntent = inv.payment_intent ?? inv.payments?.data?.[0]?.payment?.payment_intent;
    if (paymentIntent) {
      await env.DB!.prepare('INSERT OR IGNORE INTO purchases (payment_intent, user_id, credits, created_at) VALUES (?, ?, 0, ?)').bind(paymentIntent, userId, now()).run();
      await stripe(env, 'refunds', { payment_intent: paymentIntent, metadata: { reason: 'second plan' } }, { idempotencyKey: `second-plan-refund-${subscription}` });
    }
  }
  await stripe(env, `subscriptions/${encodeURIComponent(subscription)}`, {}, { method: 'DELETE' });
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
  fromPlan: number;
  fromCredits: number;
}

/**
 * Spends paid credits: the monthly plan first, then one-off credits. Returns null when the
 * account doesn't have enough. Uses compare-and-set so parallel requests can't overspend.
 */
export async function spendCredits(env: BillingEnv, userId: string, amount: number): Promise<PaidSpend | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const u = await env.DB!.prepare('SELECT plan_subscription, plan_credits, plan_used, plan_period_end, credits FROM users WHERE id = ?')
      .bind(userId)
      .first<Pick<User, 'plan_subscription' | 'plan_credits' | 'plan_used' | 'plan_period_end' | 'credits'>>();
    if (!u) return null;
    const planLeft = u.plan_subscription && u.plan_period_end > now() ? Math.max(0, u.plan_credits - u.plan_used) : 0;
    const fromPlan = Math.min(planLeft, amount);
    const fromCredits = amount - fromPlan;
    if (fromCredits > u.credits) return null;
    const res = await env.DB!.prepare(
      'UPDATE users SET plan_used = plan_used + ?, credits = credits - ? WHERE id = ? AND plan_used = ? AND credits = ?',
    )
      .bind(fromPlan, fromCredits, userId, u.plan_used, u.credits)
      .run();
    if (res.meta.changes) return { fromPlan, fromCredits };
  }
  return null;
}

/** Gives back credits spent on a request whose model call failed. */
export async function refundCredits(env: BillingEnv, userId: string, spent: PaidSpend): Promise<void> {
  await env.DB!.prepare('UPDATE users SET plan_used = MAX(0, plan_used - ?), credits = credits + ? WHERE id = ?')
    .bind(spent.fromPlan, spent.fromCredits, userId)
    .run();
}

interface StripeEvent {
  id: string;
  type: string;
  livemode?: boolean;
  data: { object: Record<string, any> };
}

// Newer Stripe API versions moved the invoice's subscription under parent.subscription_details.
const invoiceSubscription = (invoice: Record<string, any>): string | undefined =>
  invoice.subscription ?? invoice.parent?.subscription_details?.subscription ?? undefined;

async function applyEvent(env: BillingEnv, event: StripeEvent): Promise<void> {
  const db = env.DB!;
  const obj = event.data.object;
  // A delayed payment method (a bank debit) completes the session unpaid and confirms later.
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const product = findProduct(obj.metadata?.product);
    const userId = obj.metadata?.user_id ?? obj.client_reference_id;
    if (!product || !userId) return;
    // Plans too: a bank debit that later fails must not have started one.
    const paid = obj.payment_status === 'paid' || obj.payment_status === 'no_payment_required';
    if (obj.mode === 'payment' && paid) {
      const grant = db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').bind(product.credits, userId);
      // Recorded in the same transaction as the credits, so a refund or dispute can always take them back.
      const record = db
        .prepare('INSERT OR IGNORE INTO purchases (payment_intent, user_id, credits, created_at) SELECT ?, id, ?, ? FROM users WHERE id = ?')
        .bind(obj.payment_intent, product.credits, now(), userId);
      await (obj.payment_intent ? db.batch([grant, record]) : grant.run());
    } else if (obj.mode === 'subscription' && paid) {
      const current = await db.prepare('SELECT plan_subscription, plan_period_end FROM users WHERE id = ?').bind(userId).first<Pick<User, 'plan_subscription' | 'plan_period_end'>>();
      if (current?.plan_subscription && current.plan_subscription !== obj.subscription && current.plan_period_end > now()) {
        await refundSecondPlan(env, userId, obj.subscription, obj.invoice);
        return;
      }
      // invoice.paid sets the exact period end; until then allow a month.
      await db
        .prepare('UPDATE users SET plan_subscription = ?, plan_credits = ?, plan_used = 0, plan_period_end = MAX(plan_period_end, ?), stripe_customer = COALESCE(stripe_customer, ?) WHERE id = ?')
        .bind(obj.subscription, product.credits, now() + 31 * 86400, obj.customer, userId)
        .run();
    }
  } else if (event.type === 'invoice.paid' && invoiceSubscription(obj)) {
    const periodEnd = obj.lines?.data?.[0]?.period?.end ?? now() + 31 * 86400;
    // The plan's size, for a plan whose first payment confirmed after checkout (a bank debit).
    const meta = obj.parent?.subscription_details?.metadata ?? obj.subscription_details?.metadata;
    const plan = findProduct(meta?.product);
    // Renews the account's plan, or starts one when it has none; a second plan's invoice changes nothing.
    await db
      .prepare('UPDATE users SET plan_subscription = ?1, plan_credits = COALESCE(?2, plan_credits), plan_used = 0, plan_period_end = ?3 WHERE stripe_customer = ?4 AND (plan_subscription IS NULL OR plan_subscription = ?1 OR plan_period_end <= ?5)')
      .bind(invoiceSubscription(obj), plan?.monthly ? plan.credits : null, periodEnd, obj.customer, now())
      .run();
  } else if (event.type === 'charge.refunded' && obj.amount > 0) {
    await takeBack(db, obj.payment_intent, async () => obj.customer ?? null, obj.amount_refunded / obj.amount);
  } else if (event.type === 'charge.dispute.created') {
    await takeBack(db, obj.payment_intent, () => chargeCustomer(env, obj.charge), 1);
  } else if (event.type === 'customer.subscription.deleted') {
    await db.prepare('UPDATE users SET plan_subscription = NULL, plan_credits = 0, plan_used = 0, plan_period_end = 0 WHERE plan_subscription = ?').bind(obj.id).run();
  }
}

/**
 * Takes back the credits a refunded or disputed payment bought, in proportion to
 * the amount returned. One-off credits come off the balance even when already
 * spent, which can leave it negative. A plan payment ends this period's credits.
 */
async function takeBack(db: D1Database, paymentIntent: string | null, customer: () => Promise<string | null>, share: number): Promise<void> {
  const purchase = paymentIntent
    ? await db.prepare('SELECT user_id, credits, taken FROM purchases WHERE payment_intent = ?').bind(paymentIntent).first<{ user_id: string; credits: number; taken: number }>()
    : null;
  if (purchase) {
    const due = Math.min(purchase.credits, Math.ceil(purchase.credits * share)) - purchase.taken;
    if (due <= 0) return;
    // Both or neither, and only while no other refund or dispute event has taken credits since the read above.
    const [, marked] = await db.batch([
      db.prepare('UPDATE users SET credits = credits - ? WHERE id = ? AND (SELECT taken FROM purchases WHERE payment_intent = ?) = ?').bind(due, purchase.user_id, paymentIntent, purchase.taken),
      db.prepare('UPDATE purchases SET taken = taken + ? WHERE payment_intent = ? AND taken = ?').bind(due, paymentIntent, purchase.taken),
    ]);
    // Stripe retries the event, which then works out what is still due.
    if (!marked.meta.changes) throw new Error(`purchase ${paymentIntent} changed while taking credits back`);
    return;
  }
  const owner = await customer();
  if (owner) await db.prepare('UPDATE users SET plan_used = plan_credits WHERE stripe_customer = ? AND plan_subscription IS NOT NULL').bind(owner).run();
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
    // Live keys take only live events, so a sandbox test payment sent here can't credit a real account.
    if (event.livemode !== undefined && event.livemode !== /^[rs]k_live_/.test(env.STRIPE_SECRET_KEY)) return json({ received: true });
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
  if (await rateLimited(request, env.DETECT_LIMITER, 'billing:')) return json({ error: 'Too many requests. Please wait a minute.' }, 429);
  const user = await currentUser(request, env);
  if (!user) return json({ error: 'Please sign in first.' }, 401);

  if (path === '/api/portal') {
    if (!user.stripe_customer) return json({ error: 'No purchases yet.' }, 400);
    const portal = await stripe<{ url: string }>(env, 'billing_portal/sessions', { customer: user.stripe_customer, return_url: `${url.origin}/account` });
    return json({ url: portal.url });
  }

  const { product: id } = (await request.json().catch(() => ({}))) as { product?: unknown };
  const product = findProduct(id);
  if (!product) return json({ error: 'Unknown product.' }, 400);
  // A second plan would charge twice while the account tracks only one.
  if (product.monthly && user.plan_subscription && user.plan_period_end > now()) return json({ error: 'You already have a plan. Cancel it under Manage plan first.' }, 409);
  const customer = await customerFor(env, user);
  const priceData = {
    currency: 'usd',
    unit_amount: product.cents,
    product_data: {
      name: product.monthly ? `AnyRedact ${product.name}, ${product.credits.toLocaleString('en-US')} credits a month` : `AnyRedact ${product.name}`,
      // Managed Payments (on by default) rejects items without an eligible tax code. AI as a service, cloud based, personal use.
      tax_code: 'txcd_10105001',
    },
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
