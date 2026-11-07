// Paid credits through Stripe: Checkout for the monthly plans and one-off credits,
// the customer portal for managing the plan, and a webhook that credits
// accounts. Credits are spent after the free daily allowance: the monthly plan
// first, then one-off credits, which never expire.
import { isPaymentError, type Payment, type PaymentEvent } from '@iris-offloading/payments';
import { createStripeProvider, type StripeProvider } from '@iris-offloading/payments/stripe';
import { findProduct } from '../shared/pricing.ts';
import { currentUser, type AccountsEnv, type User } from './accounts.ts';
import { logActivity, type ActivityKind } from './activity.ts';
import { crossOrigin, json, now, rateLimited } from './http.ts';

export interface BillingEnv extends AccountsEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

/**
 * The Stripe account behind this server (the payments library). Live keys take only live events.
 * Refunds and disputes of one-off credits are found in purchases, so webhooks ask Stripe what a
 * payment was for only when it isn't there (takeBack).
 */
export const payments = (env: { STRIPE_SECRET_KEY?: string; STRIPE_WEBHOOK_SECRET?: string }): StripeProvider =>
  createStripeProvider({ secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET, resolvePayments: false });

/** The subscription a payment paid for, the end of the period it paid (seconds), and its price before tax. */
function paymentSubscription(payment: Payment): { subscription: string; periodEnd?: number; base: number } | null {
  const p = payment.purpose;
  if (p.kind !== 'subscription') return null;
  const end = p.lines[0]?.period.end;
  return { subscription: p.subscription, periodEnd: end ? end / 1000 : undefined, base: p.lines.reduce((n, l) => n + l.amount, 0) };
}

/**
 * A second plan for an account that already has one (two checkouts finished in
 * different tabs): refunds its first payment and cancels it at once. The
 * payment is recorded as a purchase of no credits, so its refund leaves the
 * first plan alone. The cancel comes last because cancelling twice fails: a
 * retried event redoes the idempotent refund, then cancels.
 */
async function refundSecondPlan(env: BillingEnv, userId: string, subscription: string, invoice: unknown): Promise<void> {
  const pay = payments(env);
  if (typeof invoice === 'string') {
    // Older API versions name the payment intent on the invoice, newer ones under its payments.
    const inv = await pay.request<{ payment_intent?: string | null; payments?: { data?: { payment?: { payment_intent?: string } }[] } }>(
      'GET',
      `/v1/invoices/${encodeURIComponent(invoice)}`,
      { expand: ['payments'] },
    );
    const paymentIntent = inv.payment_intent ?? inv.payments?.data?.[0]?.payment?.payment_intent;
    if (paymentIntent) {
      await env.DB!.prepare('INSERT OR IGNORE INTO purchases (payment_intent, user_id, credits, created_at) VALUES (?, ?, 0, ?)').bind(paymentIntent, userId, now()).run();
      await pay.refund({ payment: paymentIntent, metadata: { reason: 'second plan' }, idempotencyKey: `second-plan-refund-${subscription}` });
    }
  }
  await pay.cancelSubscription(subscription);
}

/** Whether a subscription was cancelled, so a late or retried payment event must not start it again. */
async function subscriptionEnded(env: BillingEnv, subscription: string): Promise<boolean> {
  const sub = await payments(env).getSubscription(subscription);
  return !sub || sub.status === 'canceled' || sub.status === 'incomplete_expired';
}

/**
 * Stripe charges a renewal about an hour after the period ends, longer when the
 * card needs 3D Secure, so a plan stays usable this long past its period end
 * until invoice.paid renews it. A plan cancelled at period end is cleared by
 * customer.subscription.deleted instead.
 */
export const PLAN_GRACE = 86_400;

type PlanRow = Pick<User, 'plan_subscription' | 'plan_period_end'>;

/** Whether the account's plan can be used now. */
export const planActive = (u: PlanRow): boolean => !!u.plan_subscription && u.plan_period_end + PLAN_GRACE > now();

/** Whether the account still has a plan Stripe may charge for, so a new one would be a second. */
async function planHeld(env: BillingEnv, u: PlanRow): Promise<boolean> {
  return planActive(u) || (!!u.plan_subscription && !(await subscriptionEnded(env, u.plan_subscription)));
}

async function customerFor(env: BillingEnv, user: User): Promise<string> {
  if (user.stripe_customer) return user.stripe_customer;
  // Two checkouts started at once (a double click) get the same customer, so renewals and refunds find the account.
  const customer = await payments(env).ensureCustomer({ userId: user.id, email: user.email });
  await env.DB!.prepare('UPDATE users SET stripe_customer = ? WHERE id = ? AND stripe_customer IS NULL').bind(customer, user.id).run();
  const row = await env.DB!.prepare('SELECT stripe_customer FROM users WHERE id = ?').bind(user.id).first<{ stripe_customer: string | null }>();
  return row?.stripe_customer ?? customer;
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
    const planLeft = planActive(u) ? Math.max(0, u.plan_credits - u.plan_used) : 0;
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

/** The Stripe object an event carries, for the fields the payments library doesn't normalize. */
const stripeObject = (event: PaymentEvent): Record<string, any> => (event.raw as { data?: { object?: Record<string, any> } })?.data?.object ?? {};

async function applyEvent(env: BillingEnv, event: PaymentEvent): Promise<void> {
  const db = env.DB!;
  // A delayed payment method (a bank debit) completes the session unpaid and confirms later.
  if (event.type === 'checkout.completed' || event.type === 'checkout.paid') {
    const obj = stripeObject(event);
    const product = findProduct(event.metadata.product);
    const userId = event.metadata.user_id ?? event.clientReference;
    if (!product || !userId) return;
    // Plans too: a bank debit that later fails must not have started one.
    const paid = event.type === 'checkout.paid' || (event.type === 'checkout.completed' && event.paid);
    if (event.mode === 'one_time' && paid) {
      const grant = db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').bind(product.credits, userId);
      // Recorded in the same transaction as the credits, so a refund or dispute can always take them back.
      const record = db
        .prepare('INSERT OR IGNORE INTO purchases (payment_intent, user_id, credits, cents, created_at) SELECT ?, id, ?, ?, ? FROM users WHERE id = ?')
        .bind(event.payment, product.credits, obj.amount_subtotal ?? product.cents, now(), userId);
      await (event.payment ? db.batch([grant, record]) : grant.run());
      await logActivity(db, userId, event.id, 'credits', product.credits, obj.amount_total ?? product.cents);
    } else if (event.mode === 'subscription' && paid && event.subscription) {
      const current = await db.prepare('SELECT plan_subscription, plan_period_end FROM users WHERE id = ?').bind(userId).first<PlanRow>();
      if (!current) return;
      if (current.plan_subscription !== event.subscription) {
        // Including a plan whose renewal is still being charged, which would otherwise keep billing next to the new one.
        if (await planHeld(env, current)) {
          await refundSecondPlan(env, userId, event.subscription, obj.invoice);
          return;
        }
        if (await subscriptionEnded(env, event.subscription)) return;
        // invoice.paid sets the exact period end; until then allow a month. When it came first, the plan is already started.
        await db
          .prepare('UPDATE users SET plan_subscription = ?, plan_credits = ?, plan_used = 0, plan_period_end = ?, stripe_customer = COALESCE(stripe_customer, ?) WHERE id = ?')
          .bind(event.subscription, product.credits, now() + 31 * 86400, event.customer, userId)
          .run();
      }
      await logActivity(db, userId, event.id, 'plan', product.credits, obj.amount_total ?? product.cents);
    }
  } else if (event.type === 'invoice.paid' && event.subscription) {
    const obj = stripeObject(event);
    const end = event.lines[0]?.period.end;
    const periodEnd = end ? end / 1000 : now() + 31 * 86400;
    // The plan's size, for a plan whose first payment confirmed after checkout (a bank debit).
    const meta = obj.parent?.subscription_details?.metadata ?? obj.subscription_details?.metadata;
    const plan = findProduct(meta?.product);
    const subscription = event.subscription;
    const current = await db.prepare('SELECT plan_subscription, plan_period_end FROM users WHERE stripe_customer = ?').bind(event.customer).first<PlanRow>();
    if (!current) return;
    // Starting a plan, not renewing it: a late retry for a plan a refund or dispute cancelled must not bring it back.
    const starts = current.plan_subscription !== subscription && !planActive(current);
    if (starts && (await subscriptionEnded(env, subscription))) return;
    // Renews the account's plan, or starts one when it has none; a second plan's invoice changes nothing.
    await db
      .prepare('UPDATE users SET plan_subscription = ?1, plan_credits = COALESCE(?2, plan_credits), plan_used = 0, plan_period_end = ?3 WHERE stripe_customer = ?4 AND (plan_subscription IS NULL OR plan_subscription = ?1 OR plan_period_end <= ?5)')
      .bind(subscription, plan?.monthly ? plan.credits : null, periodEnd, event.customer, now() - PLAN_GRACE)
      .run();
    // The first payment shows with its checkout; later ones are renewals.
    if (event.reason === 'cycle') {
      const owner = await db.prepare('SELECT id, plan_credits FROM users WHERE stripe_customer = ? AND plan_subscription = ?').bind(event.customer, subscription).first<{ id: string; plan_credits: number }>();
      if (owner) await logActivity(db, owner.id, event.id, 'plan', owner.plan_credits, event.amount.amount);
    }
  } else if (event.type === 'payment.refunded' && event.payment.amount.amount > 0) {
    const { payment } = event;
    const paid = async () => ({ ...payment, purpose: await payments(env).paymentPurpose(payment.id) });
    await takeBack(env, event.id, 'refund', payment.id, paid, event.refunded, payment.amount.amount);
  } else if (event.type === 'dispute.opened') {
    const ref = event.dispute.charge ?? event.dispute.payment;
    await takeBack(env, event.id, 'dispute', event.dispute.payment, async () => (ref ? payments(env).resolvePayment(ref) : null), Infinity, 1);
  } else if (event.type === 'dispute.closed' && (event.dispute.stage === 'won' || event.dispute.status === 'warning_closed')) {
    await giveBackDispute(env, event.id, event.dispute.payment);
  } else if (event.type === 'subscription.deleted') {
    await db.prepare('UPDATE users SET plan_subscription = NULL, plan_credits = 0, plan_used = 0, plan_period_end = 0 WHERE plan_subscription = ?').bind(event.subscription.id).run();
  }
}

/**
 * Takes back the credits a refunded or disputed payment bought, in proportion to
 * the amount returned out of the price before tax, so refunding part of the base
 * price takes back that share. One-off credits come off the balance even when
 * already spent, which can leave it negative. A plan payment ends this period's
 * credits, and a dispute or full refund of one also cancels the plan.
 */
async function takeBack(
  env: BillingEnv,
  eventId: string,
  kind: ActivityKind,
  paymentIntent: string | null,
  /** The payment, with what it paid for; null when Stripe has none. Asked only when no purchase row has it. */
  payment: () => Promise<Payment | null>,
  /** Cents returned so far; Infinity for a dispute, which takes everything. */
  returned: number,
  /** Cents charged, tax included, for payments with no recorded base price. */
  total: number,
): Promise<void> {
  const db = env.DB!;
  const share = (base: number | null | undefined) => Math.min(1, returned / (base || total));
  const purchase = paymentIntent
    ? await db
        .prepare('SELECT user_id, credits, cents, taken FROM purchases WHERE payment_intent = ?')
        .bind(paymentIntent)
        .first<{ user_id: string; credits: number; cents: number | null; taken: number }>()
    : null;
  if (purchase) {
    const due = Math.min(purchase.credits, Math.ceil(purchase.credits * share(purchase.cents))) - purchase.taken;
    if (due <= 0) return;
    // Both or neither, and only while no other refund or dispute event has taken credits since the read above.
    const [, marked] = await db.batch([
      db.prepare('UPDATE users SET credits = credits - ? WHERE id = ? AND (SELECT taken FROM purchases WHERE payment_intent = ?) = ?').bind(due, purchase.user_id, paymentIntent, purchase.taken),
      // A dispute's share is kept apart, to give back if it closes in our favour.
      db
        .prepare('UPDATE purchases SET taken = taken + ?1, disputed = disputed + ?2 WHERE payment_intent = ?3 AND taken = ?4')
        .bind(due, kind === 'dispute' ? due : 0, paymentIntent, purchase.taken),
    ]);
    // Stripe retries the event, which then works out what is still due.
    if (!marked.meta.changes) throw new Error(`purchase ${paymentIntent} changed while taking credits back`);
    await logActivity(db, purchase.user_id, eventId, kind, -due);
    return;
  }
  const paid = await payment();
  if (!paid?.customer) return;
  const user = await db
    .prepare('SELECT id, plan_subscription, plan_credits - plan_used AS left FROM users WHERE stripe_customer = ? AND plan_subscription IS NOT NULL')
    .bind(paid.customer)
    .first<{ id: string; plan_subscription: string; left: number }>();
  if (!user) return;
  // Only a payment for the account's current plan touches it, not an older plan's or a charge with no purchase row.
  const bought = paymentSubscription(paid);
  if (bought?.subscription !== user.plan_subscription) return;
  // A refunded earlier month (a duplicate charge) leaves this month's credits and the plan alone; a dispute of any month still ends it.
  if (kind === 'refund' && bought.periodEnd && bought.periodEnd + PLAN_GRACE <= now()) return;
  // A dispute, or a refund of the whole payment, ends the plan so it doesn't renew.
  if (kind === 'dispute' || share(bought.base) >= 1) {
    try {
      await payments(env).cancelSubscription(user.plan_subscription, { idempotencyKey: `plan-cancel-${eventId}` });
    } catch (err) {
      // Cancelled already, in the dashboard or by an earlier try.
      if (!isPaymentError(err, 'not_found') && !/canceled|cancelled|No such subscription/i.test((err as Error).message)) throw err;
    }
    await db
      .prepare('UPDATE users SET plan_subscription = NULL, plan_credits = 0, plan_used = 0, plan_period_end = 0 WHERE id = ? AND plan_subscription = ?')
      .bind(user.id, user.plan_subscription)
      .run();
  } else {
    await db.prepare('UPDATE users SET plan_used = plan_credits WHERE id = ? AND plan_subscription = ?').bind(user.id, user.plan_subscription).run();
  }
  await logActivity(db, user.id, eventId, kind, -Math.max(0, user.left));
}

/**
 * A dispute closed in our favour (won, or an inquiry that never became a
 * chargeback) returns the one-off credits it took. A plan it cancelled stays
 * cancelled.
 */
async function giveBackDispute(env: BillingEnv, eventId: string, paymentIntent: unknown): Promise<void> {
  if (typeof paymentIntent !== 'string') return;
  const db = env.DB!;
  const purchase = await db
    .prepare('SELECT user_id, disputed FROM purchases WHERE payment_intent = ?')
    .bind(paymentIntent)
    .first<{ user_id: string; disputed: number }>();
  if (!purchase || purchase.disputed <= 0) return;
  const [, marked] = await db.batch([
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ? AND (SELECT disputed FROM purchases WHERE payment_intent = ?) = ?').bind(purchase.disputed, purchase.user_id, paymentIntent, purchase.disputed),
    db.prepare('UPDATE purchases SET taken = taken - disputed, disputed = 0 WHERE payment_intent = ? AND disputed = ?').bind(paymentIntent, purchase.disputed),
  ]);
  if (!marked.meta.changes) throw new Error(`purchase ${paymentIntent} changed while giving credits back`);
  await logActivity(db, purchase.user_id, eventId, 'dispute', purchase.disputed);
}

/** Handles /api/checkout, /api/portal and /api/stripe/webhook. Returns null for other paths. */
export async function handleBilling(request: Request, env: BillingEnv, url: URL): Promise<Response | null> {
  const path = url.pathname;
  if (path !== '/api/checkout' && path !== '/api/portal' && path !== '/api/stripe/webhook') return null;
  if (!env.DB || !env.STRIPE_SECRET_KEY) return json({ error: 'Payments are not configured on this server.' }, 503);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (path === '/api/stripe/webhook') {
    let event: PaymentEvent;
    try {
      // Verified, and for refunds and disputes, resolved to what the payment paid for. Events from the
      // other mode come back unhandled, so a sandbox test payment can't credit a real account.
      event = await payments(env).parseWebhook(request);
    } catch (err) {
      if (isPaymentError(err, 'bad_signature') || isPaymentError(err, 'not_configured')) return json({ error: 'Bad signature' }, 400);
      // Stripe couldn't say what a payment was for: its retry tries again.
      console.error('stripe event failed', err);
      return json({ error: 'Could not apply the event.' }, 500);
    }
    if (event.type === 'unhandled') return json({ received: true });
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
  if (await rateLimited(request, env.DETECT_LIMITER, 'billing:')) return json({ error: 'Too many requests. Please wait a minute and try again.' }, 429);
  const user = await currentUser(request, env);
  if (!user) return json({ error: 'Please sign in first.' }, 401);

  if (path === '/api/portal') {
    if (!user.stripe_customer) return json({ error: 'No purchases yet.' }, 400);
    const portal = await payments(env).portal({ customer: user.stripe_customer, returnUrl: `${url.origin}/account` });
    return json({ url: portal.url });
  }

  const { product: id } = (await request.json().catch(() => ({}))) as { product?: unknown };
  const product = findProduct(id);
  if (!product) return json({ error: 'Unknown product.' }, 400);
  // A second plan would charge twice while the account tracks only one.
  if (product.monthly && (await planHeld(env, user))) return json({ error: 'You already have an active plan. Manage or cancel it under Manage plan first.' }, 409);
  const customer = await customerFor(env, user);
  const metadata = { user_id: user.id, product: product.id };
  const session = await payments(env).checkout({
    mode: product.monthly ? 'subscription' : 'one_time',
    customer,
    clientReference: user.id,
    items: [
      {
        price: {
          inline: {
            amount: product.cents,
            currency: 'usd',
            name: product.monthly ? `AnyRedact ${product.name} (${product.credits.toLocaleString('en-US')} credits/month)` : `AnyRedact ${product.name}`,
            interval: product.monthly ? 'month' : undefined,
            // Managed Payments (on by default) rejects items without an eligible tax code. AI as a service, cloud based, personal use.
            taxCode: 'txcd_10105001',
          },
        },
      },
    ],
    metadata,
    successUrl: `${url.origin}/account?paid=1`,
    cancelUrl: `${url.origin}/account`,
  });
  return json({ url: session.url });
}
