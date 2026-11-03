import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_PAGES, outputName, partialPages } from '../src/client/types.ts';

test('a file longer than the page limit says so in its name and download note', () => {
  assert.deepEqual(partialPages(MAX_PAGES), { suffix: '' });
  const long = partialPages(120);
  assert.equal(outputName('contract.pdf', 'pdf', long.suffix), `contract-redacted-pages-1-${MAX_PAGES}.pdf`);
  assert.equal(long.note, `Pages ${MAX_PAGES + 1}–120 are not included in the download.`);
});
