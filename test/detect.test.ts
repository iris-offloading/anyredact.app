import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dedupe, findPrivateKeys, findTerms, labelText, maskText } from '../src/shared/detect.ts';
import { analyzeUnits, startsTicked, type Term } from '../src/shared/analyze.ts';
import { rewriteSegments } from '../src/shared/segments.ts';

test('custom terms match case-insensitively on word boundaries', () => {
  const spans = findTerms('Ana met ANA and Banana', [{ text: 'ana', type: 'custom' }]);
  assert.deepEqual(spans.map((s) => [s.start, s.end]), [[0, 3], [8, 11]]);
});

test('dedupe drops contained spans', () => {
  const spans = dedupe([
    { start: 0, end: 10, type: 'email', source: 'ai' },
    { start: 2, end: 5, type: 'custom', source: 'term' },
    { start: 12, end: 14, type: 'phone', source: 'ai' },
  ]);
  assert.equal(spans.length, 2);
});

test('mask and label output', () => {
  const text = 'mail a@b.co now';
  const spans = findTerms(text, [{ text: 'a@b.co', type: 'email' }]);
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

test('service and helpline numbers start unticked', () => {
  const hints = (text: string, phone: string) => analyzeUnits([{ id: 'u', text }], { ai: [{ text: phone, type: 'phone' }] }).map((s) => s.publicHint);
  assert.deepEqual(hints('Freephone 0800 123 4567', '0800 123 4567'), ['Toll-free or service number']);
  assert.deepEqual(hints('Call 1-800-555-0199 today', '1-800-555-0199'), ['Toll-free or service number']);
  assert.deepEqual(hints('Helpline: 020 7946 0958', '020 7946 0958'), ['Looks like a helpline']);
  assert.deepEqual(hints('International callers: 1-267-941-1000', '1-267-941-1000'), ['Looks like a helpline']);
  assert.deepEqual(hints('My mobile is 07700 900123', '07700 900123'), [undefined]);
});

test('company letterhead contacts start as public, personal ones do not', () => {
  const text = [
    'CZ.NIC, z.s.p.o     IČ 67985726     T +420 222 745 111     kontakt@nic.cz',
    'Milešovská 1136/5, 130 00 Prague 3     DIČ CZ67985726     M +420 731 657 660     www.nic.cz',
    '',
    'Dear Jan, call me on +420 602 123 456 or write to jan.novak@seznam.cz.',
  ].join('\n');
  const ai: Term[] = [
    ...['+420 222 745 111', '+420 731 657 660', '+420 602 123 456'].map((t) => ({ text: t, type: 'phone' as const })),
    ...['kontakt@nic.cz', 'jan.novak@seznam.cz'].map((t) => ({ text: t, type: 'email' as const })),
  ];
  const spans = analyzeUnits([{ id: 'u', text }], { ai });
  const hint = (v: string) => spans.find((s) => text.slice(s.start, s.end) === v)?.publicHint;
  assert.ok(hint('+420 222 745 111'), 'switchboard');
  assert.ok(hint('+420 731 657 660'), 'letterhead mobile');
  assert.ok(hint('kontakt@nic.cz'), 'generic mailbox');
  assert.equal(hint('+420 602 123 456'), undefined);
  assert.equal(hint('jan.novak@seznam.cz'), undefined);
});

test('AI organisation owner marks a contact public everywhere it appears', () => {
  const text = 'Write to j.smith@acme.example today.\nAgain: j.smith@acme.example';
  const spans = analyzeUnits([{ id: 'u', text }], {
    ai: [{ text: 'j.smith@acme.example', type: 'email', owner: 'organization' }],
  });
  assert.equal(spans.length, 2);
  assert.ok(spans.every((s) => s.publicHint));
});

test('a company word nearby gives way when the AI says the contact is a person\'s', () => {
  const text = 'This agreement is made between Jonathan Smith, of 44 Elm Road, Springfield, IL 62704, and Acme Corp.';
  const address = (owner?: Term['owner']) => analyzeUnits([{ id: 'u', text }], { ai: [{ text: '44 Elm Road, Springfield, IL 62704', type: 'address', owner }] })[0];
  assert.equal(address('person').publicHint, undefined);
  assert.ok(address().publicHint, 'keyword fallback without an owner');
});

test('public contacts start ticked when the user asks', () => {
  const [s] = analyzeUnits([{ id: 'u', text: 'Freephone 0800 123 4567' }], { ai: [{ text: '0800 123 4567', type: 'phone' }] });
  assert.equal(startsTicked(s), false);
  assert.equal(startsTicked(s, true), true);
});

test('a company named far away in the same paragraph does not make an address public', () => {
  const text = `Die XY GmbH ist diesen Risiken ausgesetzt, ${'durch eine breite Kundenstruktur, '.repeat(3)}etwa durch Kieran Wilson, wohnhaft in der 30 Stretto Dandolo, Apt. 34.`;
  const spans = analyzeUnits([{ id: 'u', text }], { ai: [{ text: '30 Stretto Dandolo, Apt. 34', type: 'address' }] });
  assert.equal(spans.length, 1);
  assert.equal(spans[0].publicHint, undefined);
});

test('the AI type wins over a custom term of the same text', () => {
  const text = 'Credit Card Number: 3022 3330 5753';
  const spans = analyzeUnits([{ id: 'u', text }], { terms: [{ text: '3022 3330 5753', type: 'custom' }], ai: [{ text: '3022 3330 5753', type: 'card' }] });
  assert.deepEqual(spans.map((s) => [s.type, s.publicHint]), [['card', undefined]]);
});

test('dates the AI reports start ticked', () => {
  const text = 'Invoice date 12.10.2026. Patient born 01.03.1956.';
  const spans = analyzeUnits([{ id: 'u', text }], { ai: [{ text: '01.03.1956', type: 'date' }] });
  assert.deepEqual(spans.map((s) => [text.slice(s.start, s.end), startsTicked(s)]), [['01.03.1956', true]]);
});

test('private keys are found in any armour, whole or cut off', () => {
  const body = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC\nBKcwggSjAgEAAoIBAQC7\nAbCd==';
  const pem = `-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----`;
  assert.deepEqual(findPrivateKeys(`My key:\n${pem}\nThanks`), [pem]);
  assert.deepEqual(findPrivateKeys(pem.replace(/\n/g, '\r\n')), [pem.replace(/\n/g, '\r\n')]);
  assert.deepEqual(findPrivateKeys(pem.replace(/\n/g, ' ')), [pem.replace(/\n/g, ' ')]);
  const ssh = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjE=\n-----END OPENSSH PRIVATE KEY-----';
  assert.deepEqual(findPrivateKeys(ssh), [ssh]);
  // A key split across two requests: each part is taken as far as its base64 lines go.
  assert.deepEqual(findPrivateKeys(`${pem.slice(0, 60)}`), [pem.slice(0, 60)]);
  assert.deepEqual(findPrivateKeys(`Sent by Jane Doe\n${pem.slice(70)}`), [pem.slice(70)]);
  assert.deepEqual(findPrivateKeys('-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----'), []);
});
