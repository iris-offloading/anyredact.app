import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dedupe, detectPatterns, findTerms, labelText, luhn, maskText, validIban } from '../src/shared/detect.ts';
import { rewriteSegments } from '../src/shared/segments.ts';

const found = (text: string) => detectPatterns(text).map((s) => [s.type, text.slice(s.start, s.end)]);

test('finds common identifiers', () => {
  const text = `Contact jane.doe@example.com or +1 (415) 555-0132.
SSN 123-45-6789, card 4111 1111 1111 1111, IBAN GB82 WEST 1234 5698 7654 32.
Server 192.168.1.20, see https://example.com/u/jane.`;
  const got = found(text);
  assert.deepEqual(
    got.filter(([t]) => t !== 'date'),
    [
      ['email', 'jane.doe@example.com'],
      ['phone', '+1 (415) 555-0132'],
      ['ssn', '123-45-6789'],
      ['card', '4111 1111 1111 1111'],
      ['iban', 'GB82 WEST 1234 5698 7654 32'],
      ['ip', '192.168.1.20'],
      ['url', 'https://example.com/u/jane'],
    ],
  );
});

test('rejects numbers that fail checksums', () => {
  assert.equal(luhn('4111 1111 1111 1112'), false);
  assert.equal(validIban('GB82 WEST 1234 5698 7654 33'), false);
  assert.deepEqual(found('Order 4111 1111 1111 1112 shipped'), []);
});

test('does not treat dates or short numbers as phones', () => {
  const types = detectPatterns('Born 1990-04-12, room 42, invoice 2024', ['phone']);
  assert.deepEqual(types, []);
  assert.deepEqual(found('Due 12/03/2024'), [['date', '12/03/2024']]);
});

test('custom terms match case-insensitively on word boundaries', () => {
  const spans = findTerms('Ana met ANA and Banana', [{ text: 'ana', type: 'custom' }]);
  assert.deepEqual(spans.map((s) => [s.start, s.end]), [[0, 3], [8, 11]]);
});

test('dedupe drops contained spans', () => {
  const spans = dedupe([
    { start: 0, end: 10, type: 'email', source: 'pattern' },
    { start: 2, end: 5, type: 'custom', source: 'term' },
    { start: 12, end: 14, type: 'phone', source: 'pattern' },
  ]);
  assert.equal(spans.length, 2);
});

test('mask and label output', () => {
  const text = 'mail a@b.co now';
  const spans = detectPatterns(text);
  assert.equal(maskText(text, spans), 'mail ██████ now');
  assert.equal(labelText(text, spans), 'mail [EMAIL] now');
});

test('rewriteSegments redacts across run boundaries', () => {
  // "Call 555-0100 today" split across three runs.
  const pieces = ['Call 55', '5-01', '00 today'];
  const span = { start: 5, end: 13, type: 'phone' as const };
  assert.deepEqual(rewriteSegments(pieces, [span], 'block'), ['Call ██', '████', '██ today']);
  assert.deepEqual(rewriteSegments(pieces, [span], 'label'), ['Call [PHONE]', '', ' today']);
});

test('service and helpline numbers are flagged as probably public', () => {
  const hints = (text: string) => detectPatterns(text, ['phone']).map((s) => [text.slice(s.start, s.end), s.publicHint]);
  assert.deepEqual(hints('Freephone 0800 123 4567'), [['0800 123 4567', 'Toll-free or service number']]);
  assert.deepEqual(hints('Call 1-800-555-0199 today'), [['1-800-555-0199', 'Toll-free or service number']]);
  assert.deepEqual(hints('Helpline: 020 7946 0958'), [['020 7946 0958', 'Looks like a helpline']]);
  assert.deepEqual(hints('International callers: 1-267-941-1000'), [['1-267-941-1000', 'Looks like a helpline']]);
  assert.deepEqual(hints('My mobile is 07700 900123'), [['07700 900123', undefined]]);
});

test('company letterhead contacts start as public, personal ones do not', async () => {
  const { analyzeUnits } = await import('../src/shared/analyze.ts');
  const text = [
    'CZ.NIC, z.s.p.o     IČ 67985726     T +420 222 745 111     kontakt@nic.cz',
    'Milešovská 1136/5, 130 00 Prague 3     DIČ CZ67985726     M +420 731 657 660     www.nic.cz',
    '',
    'Dear Jan, call me on +420 602 123 456 or write to jan.novak@seznam.cz.',
  ].join('\n');
  const spans = analyzeUnits([{ id: 'u', text }], { types: ['name', 'email', 'phone'], ai: [] });
  const hint = (v: string) => spans.find((s) => text.slice(s.start, s.end) === v)?.publicHint;
  assert.ok(hint('+420 222 745 111'), 'switchboard');
  assert.ok(hint('+420 731 657 660'), 'letterhead mobile');
  assert.ok(hint('kontakt@nic.cz'), 'generic mailbox');
  assert.equal(hint('+420 602 123 456'), undefined);
  assert.equal(hint('jan.novak@seznam.cz'), undefined);
});

test('AI organisation owner marks a contact public everywhere it appears', async () => {
  const { analyzeUnits } = await import('../src/shared/analyze.ts');
  const text = 'Write to j.smith@acme.example today.\nAgain: j.smith@acme.example';
  const spans = analyzeUnits([{ id: 'u', text }], {
    types: ['email'],
    ai: [{ text: 'j.smith@acme.example', type: 'email', owner: 'organization' }],
  });
  assert.equal(spans.length, 2);
  assert.ok(spans.every((s) => s.publicHint));
});
