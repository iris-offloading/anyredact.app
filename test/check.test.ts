// Client-side helpers that need DOM types; type-checked with the client tsconfig.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { remainingText } from '../src/client/check.ts';

test('remaining text masks enabled findings only', async () => {
  const units = [{ id: 'u1', text: 'Jane Doe 415-555-0132' }];
  const f = (start: number, end: number, enabled: boolean) => ({ key: `${start}`, unitId: 'u1', start, end, type: 'name' as const, source: 'ai' as const, text: '', enabled, rects: [] });
  assert.equal(remainingText(units, [f(0, 8, true), f(9, 21, false)], []), '████████ 415-555-0132');
});
