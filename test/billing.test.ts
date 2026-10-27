import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { sha256, upsertUser } from '../src/worker/accounts.ts';
import { spendPaidPages, stripeForm, verifyStripeSignature } from '../src/worker/billing.ts';
import type { Env } from '../src/worker/detect.ts';
import entry from '../src/worker/index.ts';
import { audioCredits } from '../src/shared/pricing.ts';

// Minimal D1 over node:sqlite, with the real schema.
function d1(): D1Database {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_accounts.sql', import.meta.url), 'utf8'));
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const stmt = {
      bind: (...a: unknown[]) => ((args = a), stmt),
      first: async () => (db.prepare(sql).get(...(args as never[])) as unknown) ?? null,
      run: async () => {
        const r = db.prepare(sql).run(...(args as never[]));
        return { meta: { changes: Number(r.changes) } };
      },
    };
    return stmt;
  };
  return { prepare } as unknown as D1Database;
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

test('webhook credits packs once and starts the monthly plan', async () => {
  const db = d1();
  const e = env(db);
  const userId = await upsertUser(e, 'jane@example.com');
  const send = async (event: object) => {
    const body = JSON.stringify(event);
    return fetchWorker(new Request('https://anyredact.app/api/stripe/webhook', { method: 'POST', body, headers: { 'stripe-signature': await sign(body) } }), e);
  };
  const pack = { id: 'evt_pack', type: 'checkout.session.completed', data: { object: { mode: 'payment', payment_status: 'paid', metadata: { user_id: userId, product: 'pack-500' } } } };
  assert.equal((await send(pack)).status, 200);
  await send(pack); // Stripe retries must not double-credit.
  const sub = { id: 'evt_sub', type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_1', customer: 'cus_1', metadata: { user_id: userId, product: 'plus' } } } };
  await send(sub);
  const u = (await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first()) as Record<string, unknown>;
  assert.equal(u.pack_pages, 500);
  assert.equal(u.sub_pages, 600);
  assert.equal(u.sub_id, 'sub_1');

  await send({ id: 'evt_del', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1' } } });
  const after = (await db.prepare('SELECT sub_id, sub_pages, pack_pages FROM users WHERE id = ?').bind(userId).first()) as Record<string, unknown>;
  assert.deepEqual({ ...after }, { sub_id: null, sub_pages: 0, pack_pages: 500 });
});

test('spends the monthly plan before packs and never overspends', async () => {
  const db = d1();
  const e = env(db);
  const id = await upsertUser(e, 'a@example.com');
  await db.prepare('UPDATE users SET sub_id = ?, sub_pages = 10, sub_used = 8, sub_period_end = ?, pack_pages = 5 WHERE id = ?').bind('sub_x', Math.floor(Date.now() / 1000) + 3600, id).run();
  assert.ok(await spendPaidPages(e, id, 4)); // 2 from the plan, 2 from packs
  const u = (await db.prepare('SELECT sub_used, pack_pages FROM users WHERE id = ?').bind(id).first()) as Record<string, number>;
  assert.deepEqual({ ...u }, { sub_used: 10, pack_pages: 3 });
  assert.ok(!(await spendPaidPages(e, id, 4)));
});

test('signed-in users fall back to paid pages after the free allowance', async () => {
  const db = d1();
  const e = { ...env(db), FREE_CHARS_PER_DAY: '10' } as Env;
  // Quota objects: always exhausted.
  e.QUOTA = {
    idFromName: (n: string) => n,
    get: () => ({ fetch: async () => Response.json({ ok: false, used: 10, limit: 10 }) }),
  } as unknown as DurableObjectNamespace;
  const id = await upsertUser(e, 'paid@example.com');
  await db.prepare('UPDATE users SET pack_pages = 1 WHERE id = ?').bind(id).run();
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
  assert.equal((await fetchWorker(req('session=tok'), e)).status, 402); // the one pack page is spent
});

test('me reports balances for the signed-in user only', async () => {
  const db = d1();
  const e = env(db);
  const id = await upsertUser(e, 'me@example.com');
  await db.prepare('UPDATE users SET pack_pages = 42 WHERE id = ?').bind(id).run();
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256('t2'), id, Math.floor(Date.now() / 1000) + 3600).run();
  const me = (cookie?: string) => fetchWorker(new Request('https://anyredact.app/api/me', { headers: cookie ? { cookie } : {} }), e).then((r) => r.json()) as Promise<{ user: { email: string; packPages: number } | null }>;
  assert.equal((await me()).user, null);
  const signed = await me('session=t2');
  assert.equal(signed.user?.email, 'me@example.com');
  assert.equal(signed.user?.packPages, 42);
});

test('email sign-in sends a one-time link that starts a session', async () => {
  const db = d1();
  const sent: { to: string; text: string }[] = [];
  const e = { ...env(db), EMAIL: { send: async (m: { to: string; text: string }) => (sent.push(m), { messageId: 'm1' }) } } as Env;
  const res = await fetchWorker(
    new Request('https://anyredact.app/auth/email', { method: 'POST', body: JSON.stringify({ email: 'Jane@Example.com ' }), headers: { origin: 'https://anyredact.app' } }),
    e,
  );
  assert.equal(res.status, 200);
  assert.equal(sent[0].to, 'jane@example.com');
  const link = sent[0].text.match(/https:\S+/)![0];
  const verify = await fetchWorker(new Request(link), e);
  assert.equal(verify.headers.get('location'), '/account');
  assert.match(verify.headers.get('set-cookie') || '', /^session=/);
  assert.equal((await fetchWorker(new Request(link), e)).headers.get('location'), '/account?error=link');
});

test('audio costs three credits per started minute', () => {
  assert.equal(audioCredits(30), 3);
  assert.equal(audioCredits(60), 3);
  assert.equal(audioCredits(61), 6);
});
