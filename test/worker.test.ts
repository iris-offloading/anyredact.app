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
