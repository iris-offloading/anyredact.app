import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunkText, type Env } from '../src/worker/detect.ts';
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
  assert.deepEqual(await (await worker.fetch(req, e)).json(), { risks: { name: 0.9, contact: 0.1 } });
  const empty = new Request('https://anyredact.app/api/check', { method: 'POST', body: JSON.stringify({ text: '████ \n ██' }), headers: { origin: 'https://anyredact.app' } });
  assert.deepEqual(await (await worker.fetch(empty, e)).json(), { risks: {} });
});

test('keeps the organisation owner on contact details', async () => {
  const res = await worker.fetch(
    post({ text: 'Call 0800 123 4567 or Jane on 07700 900461' }),
    env({ entities: [{ text: '0800 123 4567', type: 'phone', owner: 'organization' }, { text: '07700 900461', type: 'phone', owner: 'person' }] }),
  );
  assert.deepEqual(await res.json(), {
    entities: [
      { text: '0800 123 4567', type: 'phone', owner: 'organization' },
      { text: '07700 900461', type: 'phone' },
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

// In-memory stand-in for the Quota Durable Object namespace.
async function quotaNamespace() {
  const { Quota } = await import('../src/worker/quota.ts');
  const objects = new Map<string, InstanceType<typeof Quota>>();
  return {
    idFromName: (name: string) => name,
    get: (name: string) => {
      if (!objects.has(name)) {
        const data = new Map<string, unknown>();
        const storage = { get: async (k: string) => data.get(k), put: async (k: string, v: unknown) => void data.set(k, v) };
        objects.set(name, new Quota({ storage } as unknown as DurableObjectState));
      }
      const obj = objects.get(name)!;
      return { fetch: (url: string, init: RequestInit) => obj.fetch(new Request(url, init)) };
    },
  } as unknown as DurableObjectNamespace;
}

test('free allowance is enforced per browser, with a larger shared IP allowance', async () => {
  const e = { ...env({ entities: [] }), QUOTA: await quotaNamespace(), FREE_CHARS_PER_DAY: '30' };
  const req = (device: string, text: string) =>
    new Request('https://anyredact.app/api/detect', {
      method: 'POST',
      body: JSON.stringify({ text }),
      headers: { origin: 'https://anyredact.app', 'x-device-id': device, 'cf-connecting-ip': '203.0.113.9' },
    });
  const first = await worker.fetch(req('device-aaaa', 'x'.repeat(20)), e);
  assert.deepEqual(((await first.json()) as { quota: unknown }).quota, { used: 20, limit: 30 });
  assert.equal((await worker.fetch(req('device-aaaa', 'x'.repeat(20)), e)).status, 402);
  // Another browser on the same IP still has its own allowance...
  assert.equal((await worker.fetch(req('device-bbbb', 'x'.repeat(25)), e)).status, 200);
  // ...until the IP allowance (5x) runs out.
  // IP used: 20 + 25 + 4 x 25 = 145 of 150, so 10 more characters don't fit.
  for (const d of ['device-cccc', 'device-dddd', 'device-eeee', 'device-ffff']) await worker.fetch(req(d, 'x'.repeat(25)), e);
  const res = await worker.fetch(req('device-gggg', 'x'.repeat(10)), e);
  assert.equal(res.status, 402);
  assert.equal(((await res.json()) as { code: string }).code, 'quota');
});
