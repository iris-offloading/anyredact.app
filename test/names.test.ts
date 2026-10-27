import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeUnits } from '../src/shared/analyze.ts';
import { nameVariants } from '../src/shared/names.ts';
import type { Term } from '../src/shared/analyze.ts';

const found = (units: string[], ai: Term[]) =>
  analyzeUnits(
    units.map((text, i) => ({ id: String(i), text })),
    { ai },
  ).map((s) => [s.type, units[Number(s.unitId)].slice(s.start, s.end)]);

test('name variants include each part', () => {
  assert.deepEqual(nameVariants(['Jane Doe', 'J. Li']).sort(), ['DOE', 'Doe', 'J. Li', 'JANE', 'Jane', 'Jane Doe']);
});

test('single-name variants are case-sensitive', () => {
  const got = found(['Dear Will Turner,', 'You will see TURNER and Will.'], [{ text: 'Will Turner', type: 'name' }]).map(([, v]) => v);
  assert.deepEqual(got, ['Will Turner', 'TURNER', 'Will']);
});

test('a one-word name the AI found is matched case-sensitively', () => {
  const got = found(['Will said we will meet.'], [{ text: 'Will', type: 'name' }]).map(([, v]) => v);
  assert.deepEqual(got, ['Will']);
});

test('later mentions of a name the AI found are caught', () => {
  const got = found(['Patient: Jane Doe', 'Ms. Doe reported that Jane felt better.'], [{ text: 'Jane Doe', type: 'name' }]).map(([, v]) => v);
  assert.deepEqual(got, ['Jane Doe', 'Doe', 'Jane']);
});

test('nothing is found without the AI', () => {
  assert.deepEqual(found(['Dear Mr. Okafor, call 415-555-0132 or mail jane@example.com.'], []), []);
});

test('a value split across two paragraphs is redacted in both', () => {
  const got = found(['Phone: 415-555-', '0132 (mobile)'], [{ text: '415-555-\n0132', type: 'phone' }]);
  assert.deepEqual(got, [['phone', '415-555-'], ['phone', '0132']]);
});

test('AI field labels are not redacted', () => {
  const got = found(['Enter your SSN or ITIN here: 912-78-1234'], [
    { text: 'SSN', type: 'id' },
    { text: 'ITIN', type: 'other' },
    { text: '912-78-1234', type: 'phone' },
  ]);
  assert.deepEqual(got, [['ssn', '912-78-1234']]);
});

test('a number flagged public once is flagged everywhere', () => {
  const units = [{ id: '0', text: 'Call 1-267-941-1000.' }, { id: '1', text: 'Helpline 267-941-1000' }];
  const got = analyzeUnits(units, {
    ai: [
      { text: '1-267-941-1000', type: 'phone' },
      { text: '267-941-1000', type: 'phone' },
    ],
  }).map((s) => Boolean(s.publicHint));
  assert.deepEqual(got, [true, true]);
});
