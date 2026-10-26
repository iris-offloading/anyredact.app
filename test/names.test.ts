import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeUnits } from '../src/shared/analyze.ts';
import { detectPatterns, PATTERN_TYPES } from '../src/shared/detect.ts';
import { detectNames, nameVariants } from '../src/shared/names.ts';

const names = (text: string) => detectNames(text).map((s) => text.slice(s.start, s.end));
const found = (units: string[]) =>
  analyzeUnits(
    units.map((text, i) => ({ id: String(i), text })),
    { types: PATTERN_TYPES },
  ).map((s) => [s.type, units[Number(s.unitId)].slice(s.start, s.end)]);

test('names after titles, labels, greetings and sign-offs', () => {
  assert.deepEqual(names('Seen by Dr. Priyanka Raman today.'), ['Priyanka Raman']);
  assert.deepEqual(names('Patient Name: Tomás O\'Neill\nDOB: 1980-01-01'), ["Tomás O'Neill"]);
  assert.deepEqual(names('Name: DOE, JANE'), ['DOE, JANE']);
  assert.deepEqual(names('Dear Mr. Okafor,\nThanks for'), ['Okafor']);
  assert.deepEqual(names('Kind regards,\nWei Zhang\nAcme Inc'), ['Wei Zhang']);
  assert.deepEqual(names('Signed by: Anna-Lena van der Berg'), ['Anna-Lena van der Berg']);
});

test('common first name followed by a surname', () => {
  assert.deepEqual(names('Yesterday Maria Gonzalez called about the invoice.'), ['Maria Gonzalez']);
  assert.deepEqual(names('The Monday Report was sent to the Team.'), []);
});

test('ignores label words that are not followed by a name', () => {
  assert.deepEqual(names('name: the value goes here'), []);
  assert.deepEqual(names('Customer: Accounts Department'), []);
});

test('name variants include each part', () => {
  assert.deepEqual(nameVariants(['Jane Doe', 'J. Li']).sort(), ['DOE', 'Doe', 'J. Li', 'JANE', 'Jane', 'Jane Doe']);
});

test('single-name variants are case-sensitive', () => {
  const got = found(['Dear Will Turner,', 'You will see TURNER and Will.']).filter(([t]) => t === 'name').map(([, v]) => v);
  assert.deepEqual(got, ['Will Turner', 'TURNER', 'Will']);
});

test('label rules accept any label case but only capitalised names', () => {
  assert.deepEqual(names('PATIENT NAME: Jane Doe'), ['Jane Doe']);
  assert.deepEqual(names('Name: Jane doe the value'), ['Jane']);
});

test('later mentions of a detected name are caught', () => {
  const units = ['Patient: Jane Doe', 'Ms. Doe reported that Jane felt better.'];
  const got = found(units).filter(([t]) => t === 'name').map(([, v]) => v);
  assert.deepEqual(got, ['Jane Doe', 'Doe', 'Jane']);
});

test('phone numbers wrapped across a line break', () => {
  const t = (s: string) => detectPatterns(s, ['phone']).map((m) => s.slice(m.start, m.end));
  assert.deepEqual(t('Call 415-555-\n0132 today'), ['415-555-\n0132']);
  assert.deepEqual(t('Call +1 (415)\n555 0132'), ['+1 (415)\n555 0132']);
  assert.deepEqual(t('Tel: 020 7946 \n  0958'), ['020 7946 \n  0958']);
  assert.deepEqual(t('Mobile 07700 900\n123'), ['07700 900\n123']);
  // Several lines of numbers look like a table, not a phone number.
  assert.deepEqual(t('2024\n1500\n2300'), []);
});

test('phone split across two paragraphs is redacted in both', () => {
  const got = found(['Phone: 415-555-', '0132 (mobile)']).filter(([t]) => t === 'phone');
  assert.deepEqual(got, [['phone', '415-555-'], ['phone', '0132']]);
});

test('headings are not names', () => {
  assert.deepEqual(found(['Thanks', 'Next steps', 'Contact: Your adviser']), []);
});

test('a phone pattern never matches part of a longer number', () => {
  assert.deepEqual(found(['Ref 0208-177-2901267']), []);
});

test('ITINs are SSN-type, never phones', () => {
  assert.deepEqual(found(['ITIN: 912-78-1234, SSN 123-45-6789']), [['ssn', '912-78-1234'], ['ssn', '123-45-6789']]);
});

test('AI field labels are not redacted', () => {
  const units = [{ id: '0', text: 'Enter your SSN or ITIN here: 912-78-1234' }];
  const got = analyzeUnits(units, {
    types: [],
    ai: [{ text: 'SSN', type: 'id' }, { text: 'ITIN', type: 'other' }, { text: '912-78-1234', type: 'phone' }],
  }).map((s) => [s.type, units[0].text.slice(s.start, s.end)]);
  assert.deepEqual(got, [['ssn', '912-78-1234']]);
});

test('a number flagged public once is flagged everywhere', () => {
  const units = [{ id: '0', text: 'Call 1-267-941-1000.' }, { id: '1', text: 'Helpline 267-941-1000' }];
  const got = analyzeUnits(units, { types: ['phone'] }).map((s) => Boolean(s.publicHint));
  assert.deepEqual(got, [true, true]);
});
