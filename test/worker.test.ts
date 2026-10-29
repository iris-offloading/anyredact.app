import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunkText } from '../src/shared/detect.ts';
import type { Env } from '../src/worker/detect.ts';
import entry from '../src/worker/index.ts';

const worker = { fetch: (req: Request, e: Env) => entry.fetch(req as Parameters<typeof entry.fetch>[0], e) };

function env(response: unknown): Env {
  return {
    ASSETS: { fetch: async () => new Response('asset') } as unknown as Fetcher,
    AI: { run: async () => ({ response }) } as unknown as Ai,
  };
}

const post = (body: unknown) =>
  new Request('https://anyredact.app/api/detect', { method: 'POST', body: JSON.stringify(body), headers: { origin: 'https://anyredact.app' } });

test('returns only entities that occur in the text', async () => {
  const res = await worker.fetch(
    post({ text: 'Patient John Smith lives at 1 Main St.' }),
    env({ entities: [{ text: 'John Smith', type: 'name' }, { text: 'Jane Roe', type: 'name' }, { text: '1 Main St', type: 'address' }] }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    entities: [
      { text: 'John Smith', type: 'name' },
      { text: '1 Main St', type: 'address' },
    ],
  });
});

test('keeps IP addresses as their own type', async () => {
  const res = await worker.fetch(post({ text: 'login from 10.0.0.12' }), env({ entities: [{ text: '10.0.0.12', type: 'ip' }] }));
  assert.deepEqual(await res.json(), { entities: [{ text: '10.0.0.12', type: 'ip' }] });
});

test('parses string responses and unknown types', async () => {
  const res = await worker.fetch(post({ text: 'id AB-123' }), env('```json\n{"entities":[{"text":"AB-123","type":"weird"}]}\n```'));
  assert.deepEqual(await res.json(), { entities: [{ text: 'AB-123', type: 'other' }] });
});

test('rejects cross-origin and oversize requests', async () => {
  const cross = new Request('https://anyredact.app/api/detect', { method: 'POST', body: '{}', headers: { origin: 'https://evil.example' } });
  assert.equal((await worker.fetch(cross, env({}))).status, 403);
  assert.equal((await worker.fetch(post({ text: 'x'.repeat(70_000) }), env({}))).status, 413);
});

test('serves assets for other paths', async () => {
  const res = await worker.fetch(new Request('https://anyredact.app/redact-pdf'), env({}));
  assert.equal(await res.text(), 'asset');
});

test('chunks long text on whitespace', () => {
  const text = 'word '.repeat(3000);
  const chunks = chunkText(text, 1000);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every((c) => c.length <= 1000));
});

test('drops field labels and digit-less numbers', async () => {
  const res = await worker.fetch(
    post({ text: 'SSN: 123-45-6789 ITIN: none' }),
    env({ entities: [{ text: 'SSN', type: 'other' }, { text: 'ITIN', type: 'id' }, { text: '123-45-6789', type: 'ssn' }] }),
  );
  assert.deepEqual(await res.json(), { entities: [{ text: '123-45-6789', type: 'ssn' }] });
});

test('reads Clef yes-probabilities in any answer shape', async () => {
  const { yesProbability } = await import('../src/worker/check.ts');
  assert.equal(yesProbability({ type: 'noul', noul: 0.97 }), 0.97);
  assert.equal(yesProbability({ probability: 0.2 }), 0.2);
  assert.equal(yesProbability(0.5), 0.5);
  assert.equal(yesProbability({}), null);
});

test('check returns per-category risks', async () => {
  const e = {
    ASSETS: { fetch: async () => new Response('asset') } as unknown as Fetcher,
    AI: { run: async () => ({ answers: { name: { type: 'noul', noul: 0.9 }, contact: { type: 'noul', noul: 0.1 } } }) } as unknown as Ai,
  };
  const req = new Request('https://anyredact.app/api/check', { method: 'POST', body: JSON.stringify({ text: 'Hi Jane, ████' }), headers: { origin: 'https://anyredact.app' } });
  assert.deepEqual(await (await worker.fetch(req, e)).json(), { risks: { name: 0.9, contact: 0.1 }, free: false });
  const empty = new Request('https://anyredact.app/api/check', { method: 'POST', body: JSON.stringify({ text: '████ \n ██' }), headers: { origin: 'https://anyredact.app' } });
  assert.deepEqual(await (await worker.fetch(empty, e)).json(), { risks: {} });
});

test('keeps the owner on contact details', async () => {
  const res = await worker.fetch(
    post({ text: 'Call 0800 123 4567 or Jane on 07700 900461' }),
    env({ entities: [{ text: '0800 123 4567', type: 'phone', owner: 'organization' }, { text: '07700 900461', type: 'phone', owner: 'person' }] }),
  );
  assert.deepEqual(await res.json(), {
    entities: [
      { text: '0800 123 4567', type: 'phone', owner: 'organization' },
      { text: '07700 900461', type: 'phone', owner: 'person' },
    ],
  });
});

test('retries when Workers AI rate-limits the model', async () => {
  const { runWithRetry } = await import('../src/worker/detect.ts');
  let calls = 0;
  const value = await runWithRetry(async () => {
    if (++calls < 3) throw new Error('AiError: 3021: rate limiting: inference request per min rate reached');
    return 'ok';
  }, [1, 1]);
  assert.equal(value, 'ok');
  await assert.rejects(runWithRetry(async () => { throw new Error('other'); }, [1]), /other/);
});

test('falls back to another model while the default one is rate limited', async () => {
  const models: string[] = [];
  const e = env(null);
  e.AI = {
    run: async (model: string) => {
      models.push(model);
      if (model.includes('deepseek')) throw new Error('AiError: 3021: rate limiting: inference request per min rate reached');
      return { response: { entities: [{ text: 'John Smith', type: 'name', owner: 'person' }] } };
    },
  } as unknown as Ai;
  const res = await worker.fetch(post({ text: 'Patient John Smith' }), e);
  const body = (await res.json()) as { entities: { text: string }[] };
  assert.deepEqual(body.entities.map((x) => x.text), ['John Smith']);
  assert.equal(models.filter((m) => m.includes('deepseek')).length, 3);
  assert.ok(models.at(-1)!.includes('nemotron'));
});

// In-memory stand-in for the Quota Durable Object namespace.
async function quotaNamespace() {
  const { Quota } = await import('../src/worker/quota.ts');
  const objects = new Map<string, InstanceType<typeof Quota>>();
  return {
    idFromName: (name: string) => name,
    get: (name: string) => {
      if (!objects.has(name)) {
        const data = new Map<string, unknown>();
        const storage = { get: async (k: string) => data.get(k), put: async (k: string, v: unknown) => void data.set(k, v), delete: async (k: string) => data.delete(k), setAlarm: async () => {} };
        objects.set(name, new Quota({ storage } as unknown as DurableObjectState));
      }
      const obj = objects.get(name)!;
      return { fetch: (url: string, init: RequestInit) => obj.fetch(new Request(url, init)) };
    },
  } as unknown as DurableObjectNamespace;
}

test('free allowance is enforced per browser, with a larger shared IP allowance', async () => {
  const e = { ...env({ entities: [] }), QUOTA: await quotaNamespace() };
  const req = (device: string, text: string) =>
    new Request('https://anyredact.app/api/detect', {
      method: 'POST',
      body: JSON.stringify({ text }),
      headers: { origin: 'https://anyredact.app', 'x-device-id': device, 'cf-connecting-ip': '203.0.113.9' },
    });
  // 3,000 characters to a credit, rounded up.
  const first = await worker.fetch(req('device-aaaa', 'x'.repeat(17_000)), e);
  assert.deepEqual(((await first.json()) as { quota: unknown }).quota, { used: 6, limit: 10 });
  assert.equal((await worker.fetch(req('device-aaaa', 'x'.repeat(18_000)), e)).status, 402);
  // Another browser on the same IP still has its own allowance...
  assert.equal((await worker.fetch(req('device-bbbb', 'x'.repeat(21_000)), e)).status, 200);
  // ...until the IP allowance (5x) runs out.
  // IP used: 6 + 7 + 4 x 9 = 49 of 50 credits, so 2 more don't fit.
  for (const d of ['device-cccc', 'device-dddd', 'device-eeee', 'device-ffff']) await worker.fetch(req(d, 'x'.repeat(27_000)), e);
  const res = await worker.fetch(req('device-gggg', 'x'.repeat(6_000)), e);
  assert.equal(res.status, 402);
  assert.equal(((await res.json()) as { code: string }).code, 'quota');
});

test('each scan comes with one free final check, later ones use the allowance', async () => {
  const e = { ...env({ entities: [] }), QUOTA: await quotaNamespace() };
  const post = (path: string, body: object) =>
    worker.fetch(
      new Request(`https://anyredact.app${path}`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { origin: 'https://anyredact.app', 'x-device-id': 'device-aaaa', 'cf-connecting-ip': '203.0.113.9' },
      }),
      e,
    );
  const { checkToken } = (await (await post('/api/detect', { text: 'Jane' })).json()) as { checkToken: string };
  const first = (await (await post('/api/check', { text: 'Jane Doe', checkToken })).json()) as { free: boolean };
  assert.equal(first.free, true);
  const second = (await (await post('/api/check', { text: 'Jane Doe', checkToken })).json()) as { free: boolean; quota: { used: number } };
  // 1 credit for the scan, then 1 for the paid check.
  assert.deepEqual([second.free, second.quota.used], [false, 2]);
  assert.equal(((await (await post('/api/check', { text: 'Jane Doe', checkToken: crypto.randomUUID() })).json()) as { free: boolean }).free, false);
});

test('a failed model call gives the charge back', async () => {
  const e = { ...env({ entities: [] }), QUOTA: await quotaNamespace() };
  const req = (text: string) =>
    new Request('https://anyredact.app/api/detect', {
      method: 'POST',
      body: JSON.stringify({ text }),
      headers: { origin: 'https://anyredact.app', 'x-device-id': 'device-aaaa', 'cf-connecting-ip': '203.0.113.9' },
    });
  const run = e.AI!.run;
  e.AI!.run = (async () => {
    throw new Error('model down');
  }) as never;
  assert.equal((await worker.fetch(req('x'.repeat(9_000)), e)).status, 502);
  e.AI!.run = run;
  const ok = (await (await worker.fetch(req('x'.repeat(10)), e)).json()) as { quota: { used: number } };
  assert.equal(ok.quota.used, 1);
});

test('a free final check covers about the size of its scan', async () => {
  const e = { ...env({ entities: [] }), QUOTA: await quotaNamespace() };
  const post = (path: string, body: object) =>
    worker.fetch(
      new Request(`https://anyredact.app${path}`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { origin: 'https://anyredact.app', 'x-device-id': 'device-aaaa', 'cf-connecting-ip': '203.0.113.9' },
      }),
      e,
    );
  const { checkToken } = (await (await post('/api/detect', { text: 'ab' })).json()) as { checkToken: string };
  // 'ab' covers a check of up to 504 characters.
  const big = (await (await post('/api/check', { text: 'Jane '.repeat(200), checkToken })).json()) as { free: boolean };
  assert.equal(big.free, false);
});

test('vision regions are validated and scaled to thousandths', async () => {
  const { parseRegions } = await import('../src/worker/vision.ts');
  const out = parseRegions(
    'Here: {"items":[{"kind":"face","box":[10,20,110,220]},{"kind":"plate","box":[0.1,0.2,0.3,0.4]},{"kind":"dog","box":[1,2,3,4]},{"kind":"face","box":[5,5]},{"kind":"face","box":[900,900,1200,950]}]}',
    ['face', 'plate'],
  );
  assert.deepEqual(out, [
    { kind: 'face', box: [10, 20, 110, 220] },
    { kind: 'plate', box: [100, 200, 300, 400] },
    { kind: 'face', box: [900, 900, 1000, 950] },
  ]);
  assert.deepEqual(parseRegions('not json', ['face']), []);
});

test('limits IPv6 visitors by their /64 network', async () => {
  const { clientNetwork } = await import('../src/worker/http.ts');
  const net = (ip: string) => clientNetwork(new Request('https://anyredact.app/', { headers: { 'cf-connecting-ip': ip } }));
  assert.equal(net('203.0.113.7'), '203.0.113.7');
  assert.equal(net('2001:db8:aa:1::1'), '2001:db8:aa:1::/64');
  assert.equal(net('2001:0db8:00aa:0001:ffff:1:2:3'), '2001:db8:aa:1::/64');
  assert.equal(net('2001:db8::5'), '2001:db8:0:0::/64');
  assert.equal(net('::ffff:198.51.100.4'), '198.51.100.4');
});

test('preview benchmark features need the trial key', async () => {
  const calls: unknown[] = [];
  const e = {
    ASSETS: { fetch: async () => new Response('asset') },
    AI: { run: async (model: string) => (calls.push(model), { response: { entities: [] } }) },
    MODEL_TRIALS: '1',
    TRIAL_KEY: 'k1',
  } as unknown as Env;
  const detect = (key?: string) =>
    entry.fetch(
      new Request('https://anyredact.app/api/detect', { method: 'POST', body: JSON.stringify({ text: 'Jane Doe', model: '@cf/meta/other' }), headers: key ? { 'x-trial-key': key } : {} }) as never,
      e as never,
    );
  await detect();
  await detect('wrong');
  await detect('k1');
  assert.deepEqual(calls, ['@cf/deepseek-ai/deepseek-v4.1-flash-1017', '@cf/deepseek-ai/deepseek-v4.1-flash-1017', '@cf/meta/other']);
});

// Stands in for Cloudflare's siteverify: tokens starting with "ok" pass, once each.
function fakeTurnstile() {
  const spent = new Set<string>();
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (!String(url).includes('challenges.cloudflare.com')) return real(url, init);
    const token = String((init!.body as FormData).get('response'));
    const success = token.startsWith('ok') && !spent.has(token);
    spent.add(token);
    return Response.json({ success });
  }) as typeof fetch;
  return () => void (globalThis.fetch = real);
}

test("a signed-out browser's first scan of the day needs Turnstile", async () => {
  const restore = fakeTurnstile();
  try {
    const e = { ...env({ entities: [] }), QUOTA: await quotaNamespace(), TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret' };
    const req = (device: string, turnstile?: string) =>
      new Request('https://anyredact.app/api/detect', {
        method: 'POST',
        body: JSON.stringify({ text: 'Jane Doe' }),
        headers: { origin: 'https://anyredact.app', 'x-device-id': device, 'cf-connecting-ip': '203.0.113.9', ...(turnstile ? { 'x-turnstile': turnstile } : {}) },
      });
    const quota = async () =>
      (await (await worker.fetch(new Request('https://anyredact.app/api/quota', { headers: { 'x-device-id': 'device-aaaa', 'cf-connecting-ip': '203.0.113.9' } }), e)).json()) as { turnstile?: string };
    assert.equal((await quota()).turnstile, 'site');
    const first = await worker.fetch(req('device-aaaa'), e);
    assert.equal(first.status, 403);
    assert.deepEqual(await first.json(), { error: 'Please confirm you are human.', code: 'turnstile', siteKey: 'site' });
    assert.equal((await worker.fetch(req('device-aaaa', 'bad'), e)).status, 403);
    const passed = await worker.fetch(req('device-aaaa', 'ok-1'), e);
    assert.equal(passed.status, 200);
    // Refused requests charged nothing.
    assert.equal(((await passed.json()) as { quota: { used: number } }).quota.used, 1);
    // The rest of the day needs no token...
    assert.equal((await worker.fetch(req('device-aaaa'), e)).status, 200);
    assert.equal((await quota()).turnstile, undefined);
    // ...but a new browser ID asks again, and a token works once.
    assert.equal((await worker.fetch(req('device-bbbb'), e)).status, 403);
    assert.equal((await worker.fetch(req('device-bbbb', 'ok-1'), e)).status, 403);
  } finally {
    restore();
  }
});

test('Turnstile stays off until both keys are set', async () => {
  const e = { ...env({ entities: [] }), QUOTA: await quotaNamespace(), TURNSTILE_SITE_KEY: 'site' };
  const res = await worker.fetch(
    new Request('https://anyredact.app/api/detect', { method: 'POST', body: JSON.stringify({ text: 'Jane Doe' }), headers: { origin: 'https://anyredact.app', 'x-device-id': 'device-aaaa' } }),
    e,
  );
  assert.equal(res.status, 200);
});
