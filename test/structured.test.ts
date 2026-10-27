import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findTerms, type EntityType } from '../src/shared/detect.ts';
import { redactStructured, syntaxOf } from '../src/shared/structured.ts';

const spans = (text: string, terms: [string, EntityType][]) => findTerms(text, terms.map(([t, type]) => ({ text: t, type })));

test('syntax comes from the name, or the content for pasted text', () => {
  assert.equal(syntaxOf('a.json', ''), 'json');
  assert.equal(syntaxOf('a.ndjson', ''), 'jsonl');
  assert.equal(syntaxOf('pom.xml', ''), 'xml');
  assert.equal(syntaxOf('pasted-text.txt', ' {"a": 1}'), 'json');
  assert.equal(syntaxOf('pasted-text.txt', '{ not json'), 'plain');
  assert.equal(syntaxOf('pasted-text.txt', '<?xml version="1.0"?><a/>'), 'xml');
  assert.equal(syntaxOf('app.log', '{"a": 1}'), 'plain');
  assert.equal(syntaxOf('.env', 'A=1'), 'plain');
});

test('JSON keeps its quotes and turns redacted numbers into strings', () => {
  const text = '{"name": "Jane Doe", "phone": 4155550132, "note": "say \\"hi\\" to Jane", "ok": true}';
  const s = spans(text, [['Jane Doe', 'name'], ['4155550132', 'phone'], ['Jane', 'name']]);
  const masked = redactStructured(text, s, 'block', 'json');
  assert.deepEqual(JSON.parse(masked), { name: '████ ███', phone: '██████████', note: 'say "hi" to ████', ok: true });
  const labelled = redactStructured(text, s, 'label', 'json');
  assert.deepEqual(JSON.parse(labelled), { name: '[NAME]', phone: '[PHONE]', note: 'say "hi" to [NAME]', ok: true });
});

test('a JSON finding that spills over a quote stops at it', () => {
  const text = '{"a": "x@y.io", "b": "z"}';
  const out = redactStructured(text, [{ start: 6, end: 15, type: 'email' }], 'block', 'json');
  assert.deepEqual(JSON.parse(out), { a: '██████', b: 'z' });
});

test('escapes are covered whole', () => {
  const text = '{"a": "tab\\there"}';
  const out = redactStructured(text, [{ start: 10, end: 11, type: 'other' }], 'block', 'json');
  assert.deepEqual(JSON.parse(out), { a: 'tab██here' });
});

test('JSON keys can be redacted', () => {
  const text = '{"jane@example.com": {"role": "admin"}}';
  const out = redactStructured(text, spans(text, [['jane@example.com', 'email']]), 'label', 'json');
  assert.deepEqual(JSON.parse(out), { '[EMAIL]': { role: 'admin' } });
});

test('JSON Lines are handled line by line', () => {
  const text = '{"user": "bob@corp.io", "id": 42}\n{"user": "bob@corp.io", "id": 42}\n';
  const out = redactStructured(text, spans(text, [['bob@corp.io', 'email'], ['42', 'id']]), 'label', 'jsonl');
  for (const line of out.trim().split('\n')) assert.deepEqual(JSON.parse(line), { user: '[EMAIL]', id: '[ID NUMBER]' });
});

test('invalid JSON falls back to plain masking', () => {
  const text = '{"a": "Jane", oops}';
  assert.equal(redactStructured(text, spans(text, [['Jane', 'name']]), 'block', 'json'), '{"a": "████", oops}');
});

test('XML markup stays, text and attribute values are redacted', () => {
  const text = '<?xml version="1.0"?>\n<user email="jane@example.com" id=\'7\'><name>Jane &amp; Bob</name><!-- Jane --></user>';
  const s = [...spans(text, [['jane@example.com', 'email'], ['Jane', 'name']]), { start: text.indexOf('&amp;') + 2, end: text.indexOf('&amp;') + 3, type: 'name' as const }];
  const out = redactStructured(text, s, 'label', 'xml');
  assert.equal(out, '<?xml version="1.0"?>\n<user email="[EMAIL]" id=\'7\'><name>[NAME] [NAME] Bob</name><!-- [NAME] --></user>');
});

test('a span across a tag leaves the tag alone', () => {
  const text = '<a>Jane</a><b>Doe</b>';
  const out = redactStructured(text, [{ start: 3, end: 17, type: 'name' }], 'block', 'xml');
  assert.equal(out, '<a>████</a><b>███</b>');
});

test('plain text is unchanged from before', () => {
  const text = 'API_KEY=sk-123 # owner jane';
  const s = spans(text, [['sk-123', 'other']]);
  assert.equal(redactStructured(text, s, 'block', 'plain'), 'API_KEY=██████ # owner jane');
  assert.equal(redactStructured(text, s, 'label', 'plain'), 'API_KEY=[OTHER SENSITIVE] # owner jane');
});

test('subtitles keep cue numbers, timings and tags', () => {
  assert.equal(syntaxOf('call.srt', ''), 'subtitle');
  assert.equal(syntaxOf('call.vtt', ''), 'subtitle');
  const text = 'WEBVTT - Call with Jane Doe\n\n1\n00:00:01.000 --> 00:00:04.000 align:start\n<v Jane Doe>I am <i>Jane Doe</i>, call 12 34\n\n2\r\n00:00:05,000 --> 00:00:06,000\r\n12\r\nSent --> Jane Doe\r\n';
  const s = spans(text, [['Jane Doe', 'name'], ['12', 'phone'], ['00', 'other']]);
  const out = redactStructured(text, s, 'label', 'subtitle');
  assert.equal(out, 'WEBVTT - Call with [NAME]\n\n1\n00:00:01.000 --> 00:00:04.000 align:start\n<v [NAME]>I am <i>[NAME]</i>, call [PHONE] 34\n\n2\r\n00:00:05,000 --> 00:00:06,000\r\n[PHONE]\r\nSent --> [NAME]\r\n');
});
