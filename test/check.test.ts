// Client-side helpers that need DOM types; type-checked with the client tsconfig.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { remainingText } from '../src/client/check.ts';

test('remaining text masks enabled findings only', async () => {
  const units = [{ id: 'u1', text: 'Jane Doe 415-555-0132' }];
  const f = (start: number, end: number, enabled: boolean) => ({ key: `${start}`, unitId: 'u1', start, end, type: 'name' as const, source: 'ai' as const, text: '', enabled, rects: [] });
  assert.equal(remainingText(units, [f(0, 8, true), f(9, 21, false)], []), '████████ 415-555-0132');
});

test('picture tiles cover the image at each zoom level', async () => {
  const { tiles } = await import('../src/client/visual.ts');
  const t = tiles(800, 600);
  assert.deepEqual(t[0], { x: 0, y: 0, w: 800, h: 600 });
  // Every point is inside some tile at zoom 4 (side 200).
  const z4 = t.filter((r) => Math.max(r.w, r.h) <= 200);
  for (const [x, y] of [[0, 0], [799, 599], [400, 300], [799, 0]]) assert.ok(z4.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h), `${x},${y}`);
});

test('overlapping picture hits of one kind merge, keeping the best', async () => {
  const { mergeHits, pad } = await import('../src/client/visual.ts');
  const hits = mergeHits([
    { kind: 'face', rect: { x: 10, y: 10, w: 50, h: 50 }, score: 0.6 },
    { kind: 'face', rect: { x: 15, y: 15, w: 40, h: 40 }, score: 0.9 },
    { kind: 'screen', rect: { x: 15, y: 15, w: 40, h: 40 }, score: 0.5 },
    { kind: 'face', rect: { x: 200, y: 10, w: 50, h: 50 }, score: 0.5 },
  ]);
  assert.deepEqual(hits.map((h) => `${h.kind}:${h.score}`).sort(), ['face:0.5', 'face:0.9', 'screen:0.5']);
  const p = pad({ x: 0, y: 10, w: 100, h: 100 }, 0.1, 105, 200);
  assert.deepEqual([p.x, p.y, p.w, Math.round(p.h)], [0, 0, 105, 120]);
});
