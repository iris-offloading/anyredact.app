import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeText } from '../src/client/formats/text.ts';
import { xmlText } from '../src/client/formats/office.ts';

const bytes = (...parts: (number[] | Buffer)[]) => new Uint8Array(Buffer.concat(parts.map((p) => Buffer.from(p))));

test('text files are read in their own encoding', () => {
  assert.deepEqual(decodeText(bytes(Buffer.from('Zürich', 'utf8'))), { text: 'Zürich', bom: false });
  // Windows-1252, as Excel saves CSV, comes back as UTF-8 with a BOM so Excel reads it right.
  assert.deepEqual(decodeText(bytes(Buffer.from('Café, Zürich', 'latin1'))), { text: 'Café, Zürich', bom: true });
  assert.deepEqual(decodeText(bytes([0xef, 0xbb, 0xbf], Buffer.from('Zürich'))), { text: 'Zürich', bom: true });
  assert.deepEqual(decodeText(bytes([0xff, 0xfe], Buffer.from('Zürich', 'utf16le'))), { text: 'Zürich', bom: true });
  assert.deepEqual(decodeText(bytes(Buffer.from('Jane Doe', 'utf16le'))), { text: 'Jane Doe', bom: true });
});

test('binary files are refused', () => {
  assert.throws(() => decodeText(bytes(Buffer.from('MZ'), Buffer.alloc(500), Buffer.from('This program'))), /does not look like text/);
  assert.equal(decodeText(bytes(Buffer.from('a\u0000b\nnull byte in a log line'))).text, 'a\u0000b\nnull byte in a log line');
});

test('Office parts are read in their declared encoding, without characters XML forbids', () => {
  const xml = '<?xml version="1.0" encoding="UTF-16"?><t>Jane Doe</t>';
  assert.equal(xmlText(bytes([0xff, 0xfe], Buffer.from(xml, 'utf16le'))), xml);
  assert.equal(xmlText(bytes(Buffer.from('<?xml version="1.0" encoding="windows-1252"?><t>Zürich</t>', 'latin1'))), '<?xml version="1.0" encoding="windows-1252"?><t>Zürich</t>');
  assert.equal(xmlText(bytes(Buffer.from('<t>Jane\u0001&#1;&#x1F; Doe&#10;</t>'))), '<t>Jane Doe&#10;</t>');
});
