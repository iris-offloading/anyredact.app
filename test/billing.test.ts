import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { sha256, upsertUser } from '../src/worker/accounts.ts';
import { spendCredits, stripeForm, verifyStripeSignature } from '../src/worker/billing.ts';
import type { Env } from '../src/worker/detect.ts';
import entry from '../src/worker/index.ts';
import { audioCredits } from '../src/shared/pricing.ts';
import { isWav } from '../src/worker/transcribe.ts';

// Minimal D1 over node:sqlite, with the real schema.
function d1(): D1Database {
  const db = new DatabaseSync(':memory:');
  for (const m of readdirSync(new URL('../migrations/', import.meta.url)).sort()) db.exec(readFileSync(new URL(`../migrations/${m}`, import.meta.url), 'utf8'));
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const stmt = {
      bind: (...a: unknown[]) => ((args = a), stmt),
      first: async () => (db.prepare(sql).get(...(args as never[])) as unknown) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
      run: async () => {
        const r = db.prepare(sql).run(...(args as never[]));
        return { meta: { changes: Number(r.changes) } };
      },
    };
    return stmt;
  };
  // D1 runs a batch as one transaction.
  const batch = async (stmts: { run: () => Promise<unknown> }[]) => {
    db.exec('BEGIN');
    try {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      db.exec('COMMIT');
      return out;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
  return { prepare, batch } as unknown as D1Database;
}

const SECRET = 'whsec_test';

async function sign(body: string, t = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`));
  return `t=${t},v1=${[...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function env(db: D1Database, ai: unknown = { entities: [] }): Env {
  return {
    ASSETS: { fetch: async () => new Response('asset') } as unknown as Fetcher,
    AI: { run: async () => ({ response: ai }) } as unknown as Ai,
    DB: db,
    STRIPE_SECRET_KEY: 'sk_test',
    STRIPE_WEBHOOK_SECRET: SECRET,
  };
}

const fetchWorker = (req: Request, e: Env) => entry.fetch(req as Parameters<typeof entry.fetch>[0], e as never);

test('encodes nested Stripe params', () => {
  const form = stripeForm({ mode: 'payment', line_items: [{ price_data: { unit_amount: 300 }, quantity: 1 }], skip: undefined });
  assert.equal(decodeURIComponent(form.toString()), 'mode=payment&line_items[0][price_data][unit_amount]=300&line_items[0][quantity]=1');
});

test('verifies Stripe webhook signatures', async () => {
  const body = '{"id":"evt_1"}';
  assert.ok(await verifyStripeSignature(body, await sign(body), SECRET));
  assert.ok(!(await verifyStripeSignature(body + ' ', await sign(body), SECRET)));
  assert.ok(!(await verifyStripeSignature(body, await sign(body, 1000), SECRET)));
});

test('webhook grants one-off credits once, under old ids too, and starts the monthly plan', async () => {
  const db = d1();
  const e = env(db);
  const userId = await upsertUser(e, 'jane@example.com');
  const send = async (event: object) => {
    const body = JSON.stringify(event);
    return fetchWorker(new Request('https://anyredact.app/api/stripe/webhook', { method: 'POST', body, headers: { 'stripe-signature': await sign(body) } }), e);
  };
  // pack-500 is the id checkouts carried before credits-500, which Stripe can still send.
  const pack = { id: 'evt_pack', type: 'checkout.session.completed', data: { object: { mode: 'payment', payment_status: 'paid', metadata: { user_id: userId, product: 'pack-500' } } } };
  assert.equal((await send(pack)).status, 200);
  await send(pack); // Stripe retries must not double-credit.
  // A bank debit completes unpaid, then confirms later.
  const debit = { mode: 'payment', payment_status: 'unpaid', metadata: { user_id: userId, product: 'credits-500' } };
  await send({ id: 'evt_debit', type: 'checkout.session.completed', data: { object: debit } });
  await send({ id: 'evt_debit_paid', type: 'checkout.session.async_payment_succeeded', data: { object: { ...debit, payment_status: 'paid' } } });
  const sub = { id: 'evt_sub', type: 'checkout.session.completed', data: { object: { mode: 'subscription', payment_status: 'paid', subscription: 'sub_1', customer: 'cus_1', metadata: { user_id: userId, product: 'plus' } } } };
  await send(sub);
  const u = (await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first()) as Record<string, unknown>;
  assert.equal(u.credits, 1000);
  assert.equal(u.plan_credits, 600);
  assert.equal(u.plan_subscription, 'sub_1');

  await send({ id: 'evt_del', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1' } } });
  const after = (await db.prepare('SELECT plan_subscription, plan_credits, credits FROM users WHERE id = ?').bind(userId).first()) as Record<string, unknown>;
  assert.deepEqual({ ...after }, { plan_subscription: null, plan_credits: 0, credits: 1000 });
});

test('spends the monthly plan before one-off credits and never overspends', async () => {
  const db = d1();
  const e = env(db);
  const id = await upsertUser(e, 'a@example.com');
  await db.prepare('UPDATE users SET plan_subscription = ?, plan_credits = 10, plan_used = 8, plan_period_end = ?, credits = 5 WHERE id = ?').bind('sub_x', Math.floor(Date.now() / 1000) + 3600, id).run();
  assert.ok(await spendCredits(e, id, 4)); // 2 from the plan, 2 one-off
  const u = (await db.prepare('SELECT plan_used, credits FROM users WHERE id = ?').bind(id).first()) as Record<string, number>;
  assert.deepEqual({ ...u }, { plan_used: 10, credits: 3 });
  assert.ok(!(await spendCredits(e, id, 4)));
});

test('signed-in users fall back to paid pages after the free allowance', async () => {
  const db = d1();
  const e = env(db);
  // Quota objects: always exhausted.
  e.QUOTA = {
    idFromName: (n: string) => n,
    get: () => ({ fetch: async () => Response.json({ ok: false, used: 10, limit: 10 }) }),
  } as unknown as DurableObjectNamespace;
  const id = await upsertUser(e, 'paid@example.com');
  await db.prepare('UPDATE users SET credits = 1 WHERE id = ?').bind(id).run();
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256('tok'), id, Math.floor(Date.now() / 1000) + 3600).run();
  const req = (cookie?: string) =>
    new Request('https://anyredact.app/api/detect', {
      method: 'POST',
      body: JSON.stringify({ text: 'Hello Jane' }),
      headers: { origin: 'https://anyredact.app', ...(cookie ? { cookie } : {}) },
    });
  const anon = await fetchWorker(req(), e);
  assert.equal(anon.status, 402);
  assert.equal(((await anon.json()) as { signedIn: boolean }).signedIn, false);
  assert.equal((await fetchWorker(req('session=tok'), e)).status, 200);
  assert.equal((await fetchWorker(req('session=tok'), e)).status, 402); // the one credit is spent
});

test('me reports balances for the signed-in user only', async () => {
  const db = d1();
  const e = env(db);
  const id = await upsertUser(e, 'me@example.com');
  await db.prepare('UPDATE users SET credits = 42 WHERE id = ?').bind(id).run();
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256('t2'), id, Math.floor(Date.now() / 1000) + 3600).run();
  const me = (cookie?: string) => fetchWorker(new Request('https://anyredact.app/api/me', { headers: cookie ? { cookie } : {} }), e).then((r) => r.json()) as Promise<{ user: { email: string; credits: number } | null }>;
  assert.equal((await me()).user, null);
  const signed = await me('session=t2');
  assert.equal(signed.user?.email, 'me@example.com');
  assert.equal(signed.user?.credits, 42);
});

test('email sign-in sends a one-time link that starts a session', async () => {
  const db = d1();
  const sent: { to: string; text: string }[] = [];
  const e = { ...env(db), EMAIL: { send: async (m: { to: string; text: string }) => (sent.push(m), { messageId: 'm1' }) } } as Env;
  const res = await fetchWorker(
    new Request('https://anyredact.app/api/auth/email', { method: 'POST', body: JSON.stringify({ email: 'Jane@Example.com ' }), headers: { origin: 'https://anyredact.app' } }),
    e,
  );
  assert.equal(res.status, 200);
  assert.equal(sent[0].to, 'jane@example.com');
  const link = sent[0].text.match(/https:\S+/)![0];
  // Opening the link spends nothing; the page's script posts the token.
  assert.match(link, /^https:\/\/anyredact\.app\/account#signin=/);
  const token = decodeURIComponent(link.split('#signin=')[1]);
  const verify = (t: string, origin = 'https://anyredact.app') =>
    fetchWorker(new Request('https://anyredact.app/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ token: t }), headers: { origin } }), e);
  assert.equal((await verify(token, 'https://evil.example')).status, 403);
  const ok = await verify(token);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('set-cookie') || '', /^session=/);
  assert.equal((await verify(token)).status, 400);
});

test('audio costs three credits per started minute', () => {
  assert.equal(audioCredits(30), 3);
  assert.equal(audioCredits(60), 3);
  assert.equal(audioCredits(61), 6);
});

test('a webhook that fails to apply is retried rather than lost', async () => {
  const db = d1();
  let broken = true;
  const flaky = {
    prepare: (sql: string) => {
      if (broken && sql.startsWith('UPDATE users SET credits')) throw new Error('D1 unavailable');
      return db.prepare(sql);
    },
    batch: db.batch,
  } as unknown as D1Database;
  const e = env(flaky);
  const userId = await upsertUser(e, 'jane@example.com');
  const body = JSON.stringify({ id: 'evt_retry', type: 'checkout.session.completed', data: { object: { mode: 'payment', payment_status: 'paid', metadata: { user_id: userId, product: 'credits-500' } } } });
  const send = async () => fetchWorker(new Request('https://anyredact.app/api/stripe/webhook', { method: 'POST', body, headers: { 'stripe-signature': await sign(body) } }), e);
  assert.equal((await send()).status, 500);
  broken = false;
  assert.equal((await send()).status, 200);
  assert.equal(((await db.prepare('SELECT credits FROM users WHERE id = ?').bind(userId).first()) as { credits: number }).credits, 500);
});

test('invoice.paid reads the subscription from newer Stripe API versions', async () => {
  const db = d1();
  const e = env(db);
  const userId = await upsertUser(e, 'jane@example.com');
  await db.prepare("UPDATE users SET stripe_customer = 'cus_1', plan_subscription = 'sub_1', plan_credits = 1000, plan_used = 900 WHERE id = ?").bind(userId).run();
  const body = JSON.stringify({ id: 'evt_inv', type: 'invoice.paid', data: { object: { customer: 'cus_1', parent: { subscription_details: { subscription: 'sub_1' } }, lines: { data: [{ period: { end: 4102444800 } }] } } } });
  await fetchWorker(new Request('https://anyredact.app/api/stripe/webhook', { method: 'POST', body, headers: { 'stripe-signature': await sign(body) } }), e);
  const u = (await db.prepare('SELECT plan_used, plan_period_end FROM users WHERE id = ?').bind(userId).first()) as Record<string, number>;
  assert.deepEqual({ ...u }, { plan_used: 0, plan_period_end: 4102444800 });
});

test('stops sending sign-in links to one address after a few', async () => {
  const db = d1();
  const sent: unknown[] = [];
  const e = { ...env(db), EMAIL: { send: async (m: unknown) => (sent.push(m), { messageId: 'm' }) } } as Env;
  const ask = () =>
    fetchWorker(new Request('https://anyredact.app/api/auth/email', { method: 'POST', body: JSON.stringify({ email: 'jane@example.com' }), headers: { origin: 'https://anyredact.app' } }), e);
  for (let i = 0; i < 3; i++) assert.equal((await ask()).status, 200);
  assert.equal((await ask()).status, 429);
  assert.equal(sent.length, 3);
});

test('refunds and disputes take one-off credits back, and a negative balance blocks free use', async () => {
  const db = d1();
  const e = env(db);
  const userId = await upsertUser(e, 'jane@example.com');
  const send = async (event: object) => {
    const body = JSON.stringify(event);
    return fetchWorker(new Request('https://anyredact.app/api/stripe/webhook', { method: 'POST', body, headers: { 'stripe-signature': await sign(body) } }), e);
  };
  const balance = async () => ((await db.prepare('SELECT credits FROM users WHERE id = ?').bind(userId).first()) as { credits: number }).credits;
  await send({ id: 'evt_buy', type: 'checkout.session.completed', data: { object: { mode: 'payment', payment_status: 'paid', payment_intent: 'pi_1', metadata: { user_id: userId, product: 'credits-100' } } } });
  assert.equal(await balance(), 100);
  await spendCredits(e, userId, 80);
  // Half refunded, then the rest disputed: 100 taken back in all, even though 80 were spent.
  await send({ id: 'evt_ref', type: 'charge.refunded', data: { object: { payment_intent: 'pi_1', customer: 'cus_1', amount: 500, amount_refunded: 250 } } });
  assert.equal(await balance(), -30);
  await send({ id: 'evt_dis', type: 'charge.dispute.created', data: { object: { payment_intent: 'pi_1', amount: 500 } } });
  assert.equal(await balance(), -80);
  await send({ id: 'evt_dis2', type: 'charge.dispute.created', data: { object: { payment_intent: 'pi_1', amount: 500 } } });
  assert.equal(await balance(), -80);

  const session = await sha256('tok');
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(session, userId, 4102444800).run();
  const res = await fetchWorker(
    new Request('https://anyredact.app/api/detect', { method: 'POST', body: JSON.stringify({ text: 'Jane' }), headers: { origin: 'https://anyredact.app', cookie: 'session=tok' } }),
    e,
  );
  assert.equal(res.status, 402);
  assert.equal(((await res.json()) as { code: string }).code, 'negative');
});

const webhook = (e: Env) => async (event: object) => {
  const body = JSON.stringify(event);
  return fetchWorker(new Request('https://anyredact.app/api/stripe/webhook', { method: 'POST', body, headers: { 'stripe-signature': await sign(body) } }), e);
};

test('a plan paid by a bank debit starts only once the payment confirms', async () => {
  const db = d1();
  const e = env(db);
  const send = webhook(e);
  const userId = await upsertUser(e, 'jane@example.com');
  await db.prepare("UPDATE users SET stripe_customer = 'cus_1' WHERE id = ?").bind(userId).run();
  const session = { mode: 'subscription', payment_status: 'unpaid', subscription: 'sub_1', customer: 'cus_1', metadata: { user_id: userId, product: 'plus' } };
  await send({ id: 'evt_c', type: 'checkout.session.completed', data: { object: session } });
  const plan = async () => ((await db.prepare('SELECT plan_subscription, plan_credits FROM users WHERE id = ?').bind(userId).first()) as Record<string, unknown>);
  assert.deepEqual({ ...(await plan()) }, { plan_subscription: null, plan_credits: 0 });
  // The invoice can confirm before the session does, and carries the plan in its metadata.
  const invoice = { customer: 'cus_1', parent: { subscription_details: { subscription: 'sub_1', metadata: { user_id: userId, product: 'plus' } } }, lines: { data: [{ period: { end: 4102444800 } }] } };
  await send({ id: 'evt_i', type: 'invoice.paid', data: { object: invoice } });
  assert.deepEqual({ ...(await plan()) }, { plan_subscription: 'sub_1', plan_credits: 600 });
});

test('live keys ignore sandbox events', async () => {
  const db = d1();
  const e = { ...env(db), STRIPE_SECRET_KEY: 'rk_live_x' } as Env;
  const send = webhook(e);
  const userId = await upsertUser(e, 'jane@example.com');
  const object = { mode: 'payment', payment_status: 'paid', payment_intent: 'pi_t', metadata: { user_id: userId, product: 'credits-100' } };
  assert.equal((await send({ id: 'evt_test', livemode: false, type: 'checkout.session.completed', data: { object } })).status, 200);
  await send({ id: 'evt_live', livemode: true, type: 'checkout.session.completed', data: { object: { ...object, payment_intent: 'pi_l' } } });
  assert.equal(((await db.prepare('SELECT credits FROM users WHERE id = ?').bind(userId).first()) as { credits: number }).credits, 100);
});

test('a dispute on a plan payment ends the period\'s credits', async () => {
  const db = d1();
  const e = env(db);
  const userId = await upsertUser(e, 'jane@example.com');
  await db.prepare("UPDATE users SET stripe_customer = 'cus_9', plan_subscription = 'sub_9', plan_credits = 600, plan_used = 10, plan_period_end = 4102444800 WHERE id = ?").bind(userId).run();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    assert.match(String(input), /\/v1\/charges\/ch_9$/);
    return Response.json({ id: 'ch_9', customer: 'cus_9' });
  }) as typeof fetch;
  try {
    assert.equal((await webhook(e)({ id: 'evt_d', type: 'charge.dispute.created', data: { object: { charge: 'ch_9', payment_intent: 'pi_plan', amount: 900 } } })).status, 200);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(((await db.prepare('SELECT plan_used FROM users WHERE id = ?').bind(userId).first()) as { plan_used: number }).plan_used, 600);
});

test('transcription takes only 16 kHz mono 16-bit WAV, so audio is billed by its real length', () => {
  const wav = (rate: number, channels = 1, bits = 16) => {
    const b = new Uint8Array(44 + 3200);
    const v = new DataView(b.buffer);
    b.set(new TextEncoder().encode('RIFF'), 0);
    b.set(new TextEncoder().encode('WAVEfmt '), 8);
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, channels, true);
    v.setUint32(24, rate, true);
    v.setUint16(34, bits, true);
    b.set(new TextEncoder().encode('data'), 36);
    v.setUint32(40, 3200, true);
    return b;
  };
  assert.ok(isWav(wav(16000)));
  assert.ok(!isWav(wav(8000)));
  assert.ok(!isWav(wav(16000, 2)));
  assert.ok(!isWav(wav(16000, 1, 8)));
});

/** Runs `fn` with Stripe API calls answered by `answer`, and returns the calls made. */
async function withStripe(answer: (method: string, url: string) => unknown, fn: () => Promise<void>) {
  const calls: { method: string; url: string; body: string; key: string | null }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call = { method: init.method ?? 'GET', url: String(input), body: String(init.body ?? ''), key: new Headers(init.headers).get('idempotency-key') };
    calls.push(call);
    return Response.json(answer(call.method, call.url));
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
  return calls;
}

test('a second plan is cancelled and refunded, and leaves the first plan alone', async () => {
  const db = d1();
  const e = env(db);
  const send = webhook(e);
  const userId = await upsertUser(e, 'jane@example.com');
  await db.prepare("UPDATE users SET stripe_customer = 'cus_1', plan_subscription = 'sub_1', plan_credits = 600, plan_used = 5, plan_period_end = 4102444800 WHERE id = ?").bind(userId).run();
  const calls = await withStripe(
    (method, url) => (url.includes('/invoices/') ? { id: 'in_2', payments: { data: [{ payment: { payment_intent: 'pi_2' } }] } } : { id: 'x' }),
    async () => {
      const session = { mode: 'subscription', payment_status: 'paid', subscription: 'sub_2', invoice: 'in_2', customer: 'cus_1', metadata: { user_id: userId, product: 'pro' } };
      assert.equal((await send({ id: 'evt_2', type: 'checkout.session.completed', data: { object: session } })).status, 200);
    },
  );
  assert.deepEqual(
    calls.map((c) => `${c.method} ${new URL(c.url).pathname}`),
    ['GET /v1/invoices/in_2', 'POST /v1/refunds', 'DELETE /v1/subscriptions/sub_2'],
  );
  assert.match(decodeURIComponent(calls[1].body), /payment_intent=pi_2/);
  // A retried event sends the refund again, so Stripe must see the same key.
  assert.ok(calls[1].key);
  // Its invoice and its refund don't touch the plan the account already has.
  const invoice = { customer: 'cus_1', parent: { subscription_details: { subscription: 'sub_2', metadata: { product: 'pro' } } }, lines: { data: [{ period: { end: 4102444900 } }] } };
  await send({ id: 'evt_i2', type: 'invoice.paid', data: { object: invoice } });
  await send({ id: 'evt_r2', type: 'charge.refunded', data: { object: { payment_intent: 'pi_2', customer: 'cus_1', amount: 2400, amount_refunded: 2400 } } });
  const u = (await db.prepare('SELECT plan_subscription, plan_credits, plan_used FROM users WHERE id = ?').bind(userId).first()) as Record<string, unknown>;
  assert.deepEqual({ ...u }, { plan_subscription: 'sub_1', plan_credits: 600, plan_used: 5 });
});

test('deleting an account removes the Stripe customer, then every row', async () => {
  const db = d1();
  const e = env(db);
  const userId = await upsertUser(e, 'jane@example.com');
  await db.prepare("UPDATE users SET stripe_customer = 'cus_1', credits = 50 WHERE id = ?").bind(userId).run();
  await db.prepare('INSERT INTO purchases (payment_intent, user_id, credits, created_at) VALUES (?, ?, 50, 0)').bind('pi_1', userId).run();
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256('tok'), userId, 4102444800).run();
  const del = (headers: Record<string, string>) => fetchWorker(new Request('https://anyredact.app/api/me', { method: 'DELETE', headers }), e);
  assert.equal((await del({ cookie: 'session=tok', origin: 'https://evil.example' })).status, 403);
  let res!: Response;
  const calls = await withStripe(
    () => ({ id: 'cus_1', deleted: true }),
    async () => {
      res = await del({ cookie: 'session=tok', origin: 'https://anyredact.app' });
    },
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie') || '', /session=; /);
  assert.deepEqual(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`), ['DELETE /v1/customers/cus_1']);
  for (const table of ['users', 'sessions', 'purchases']) {
    assert.equal(((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()) as { n: number }).n, 0, table);
  }
  assert.equal((await del({ cookie: 'session=tok' })).status, 401);
});

test('an account stays when Stripe could not cancel its plan', async () => {
  const db = d1();
  const e = env(db);
  const userId = await upsertUser(e, 'jane@example.com');
  await db.prepare("UPDATE users SET stripe_customer = 'cus_1' WHERE id = ?").bind(userId).run();
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256('tok'), userId, 4102444800).run();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ error: { message: 'API unavailable' } }, { status: 500 })) as typeof fetch;
  try {
    const res = await fetchWorker(new Request('https://anyredact.app/api/me', { method: 'DELETE', headers: { cookie: 'session=tok' } }), e);
    assert.equal(res.status, 502);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(((await db.prepare('SELECT COUNT(*) AS n FROM users').first()) as { n: number }).n, 1);
});

test('activity shows credits per file and payments, without file names', async () => {
  const db = d1();
  const e = env(db);
  const send = webhook(e);
  const userId = await upsertUser(e, 'jane@example.com');
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256('tok'), userId, 4102444800).run();
  await send({ id: 'evt_buy', type: 'checkout.session.completed', data: { object: { mode: 'payment', payment_status: 'paid', payment_intent: 'pi_1', amount_total: 500, metadata: { user_id: userId, product: 'credits-100' } } } });
  const scan = (text: string, job: string, format: string) =>
    fetchWorker(
      new Request('https://anyredact.app/api/detect', {
        method: 'POST',
        body: JSON.stringify({ text }),
        headers: { origin: 'https://anyredact.app', cookie: 'session=tok', 'x-job': job, 'x-format': format },
      }),
      e,
    );
  // Two requests for one file make one row.
  assert.equal((await scan('a'.repeat(4000), 'job-aaaaaaaa', 'pdf')).status, 200);
  assert.equal((await scan('b'.repeat(100), 'job-aaaaaaaa', 'pdf')).status, 200);
  const me = (await (await fetchWorker(new Request('https://anyredact.app/api/me', { headers: { cookie: 'session=tok' } }), e)).json()) as { user: { activity: Record<string, unknown>[] } };
  const rows = me.user.activity.map(({ kind, credits, cents }) => ({ kind, credits, cents }));
  assert.deepEqual(rows.sort((a, b) => String(a.kind).localeCompare(String(b.kind))), [
    { kind: 'credits', credits: 100, cents: 500 },
    { kind: 'pdf', credits: -3, cents: null },
  ]);
});

test('free credits used today show as one refill row from the next midnight, at most a full day', async () => {
  const db = d1();
  const e = env(db);
  const userId = await upsertUser(e, 'jane@example.com');
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256('tok'), userId, 4102444800).run();
  const scan = (chars: number) =>
    fetchWorker(
      new Request('https://anyredact.app/api/detect', {
        method: 'POST',
        body: JSON.stringify({ text: 'a'.repeat(chars) }),
        headers: { origin: 'https://anyredact.app', cookie: 'session=tok', 'x-job': 'job-cccccccc', 'x-format': 'text' },
      }),
      e,
    );
  const me = async () => ((await (await fetchWorker(new Request('https://anyredact.app/api/me', { headers: { cookie: 'session=tok' } }), e)).json()) as { user: { activity: { kind: string; credits: number }[] } }).user.activity;
  assert.equal((await scan(4000)).status, 200);
  assert.equal((await scan(100)).status, 200);
  const refill = (await db.prepare("SELECT credits, at FROM activity WHERE kind = 'free'").first()) as { credits: number; at: number };
  assert.equal(refill.credits, 3);
  assert.equal(refill.at % 86400, 0);
  assert.ok(refill.at > Date.now() / 1000);
  // Not shown before the refill happens.
  assert.ok(!(await me()).some((a) => a.kind === 'free'));
  assert.equal((await scan(60_000)).status, 200);
  await db.prepare("UPDATE activity SET at = at - 86400 WHERE kind = 'free'").run();
  assert.deepEqual((await me()).filter((a) => a.kind === 'free').map((a) => a.credits), [10]);
});

test('a failed scan takes its credits off the activity again', async () => {
  const db = d1();
  const e = { ...env(db), AI: { run: async () => { throw new Error('down'); } } as unknown as Ai } as Env;
  const userId = await upsertUser(e, 'jane@example.com');
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256('tok'), userId, 4102444800).run();
  const res = await fetchWorker(
    new Request('https://anyredact.app/api/detect', { method: 'POST', body: JSON.stringify({ text: 'Jane' }), headers: { origin: 'https://anyredact.app', cookie: 'session=tok', 'x-job': 'job-bbbbbbbb', 'x-format': 'docx' } }),
    e,
  );
  assert.equal(res.status, 502);
  assert.equal(((await db.prepare('SELECT credits FROM activity WHERE user_id = ?').bind(userId).first()) as { credits: number }).credits, 0);
});

test('a full refund of a plan payment cancels the plan, a partial one keeps it', async () => {
  const db = d1();
  const e = env(db);
  const send = webhook(e);
  const userId = await upsertUser(e, 'jane@example.com');
  const start = () => db.prepare("UPDATE users SET stripe_customer = 'cus_1', plan_subscription = 'sub_1', plan_credits = 600, plan_used = 10, plan_period_end = 4102444800 WHERE id = ?").bind(userId).run();
  const plan = async () => ({ ...((await db.prepare('SELECT plan_subscription, plan_credits, plan_used FROM users WHERE id = ?').bind(userId).first()) as Record<string, unknown>) });
  await start();
  const partial = await withStripe(
    () => ({}),
    async () => {
      await send({ id: 'evt_p', type: 'charge.refunded', data: { object: { payment_intent: 'pi_p', customer: 'cus_1', amount: 900, amount_refunded: 400 } } });
    },
  );
  assert.equal(partial.length, 0);
  assert.deepEqual(await plan(), { plan_subscription: 'sub_1', plan_credits: 600, plan_used: 600 });
  await start();
  const full = await withStripe(
    () => ({ id: 'sub_1', status: 'canceled' }),
    async () => {
      await send({ id: 'evt_f', type: 'charge.refunded', data: { object: { payment_intent: 'pi_f', customer: 'cus_1', amount: 900, amount_refunded: 900 } } });
    },
  );
  assert.deepEqual(full.map((c) => `${c.method} ${new URL(c.url).pathname}`), ['DELETE /v1/subscriptions/sub_1']);
  assert.ok(full[0].key);
  assert.deepEqual(await plan(), { plan_subscription: null, plan_credits: 0, plan_used: 0 });
});
