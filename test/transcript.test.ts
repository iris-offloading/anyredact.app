import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTranscript, mergeChunks, padRanges, paragraphs, timeRangeFor, wordsFromAzure, wordsFromDeepgram, wordsFromWhisper } from '../src/shared/transcript.ts';

test('Whisper words keep the spacing the model gave them', () => {
  const words = wordsFromWhisper({
    segments: [{ words: [{ word: ' Call', start: 0, end: 0.3 }, { word: ' 4', start: 0.3, end: 0.6 }, { word: '-1', start: 0.6, end: 0.9 }, { word: '-5.', start: 0.9, end: 1.2 }] }],
  });
  const t = buildTranscript(words);
  assert.equal(t.text, 'Call 4-1-5.');
  assert.deepEqual(timeRangeFor(t, t.text.indexOf('4-1-5'), t.text.length - 1), [0.3, 1.2]);
});

test('Deepgram words use the formatted form', () => {
  const words = wordsFromDeepgram({
    results: { channels: [{ alternatives: [{ words: [{ word: 'hi', punctuated_word: 'Hi.', start: 0.1, end: 0.4 }, { word: '5550142', punctuated_word: '555-0142', start: 0.5, end: 2 }] }] }] },
  });
  assert.equal(buildTranscript(words).text, 'Hi. 555-0142');
});

test('Azure words read their times from milliseconds, across phrases', () => {
  const words = wordsFromAzure({
    phrases: [
      { words: [{ text: 'Hi,', offsetMilliseconds: 320, durationMilliseconds: 200 }, { text: 'Priya.', offsetMilliseconds: 600, durationMilliseconds: 400 }] },
      { words: [{ text: '4539-1488.', offsetMilliseconds: 2000, durationMilliseconds: 1500 }] },
    ],
  });
  const t = buildTranscript(words);
  assert.equal(t.text, 'Hi, Priya. 4539-1488.');
  assert.deepEqual(timeRangeFor(t, t.text.indexOf('4539'), t.text.length - 1), [2, 3.5]);
});

test('overlapping chunks keep each word once', () => {
  const words = mergeChunks([
    { start: 0, end: 30, words: [{ text: 'one', start: 28, end: 28.5 }, { text: 'two', start: 29.2, end: 29.8 }] },
    { start: 29, end: 59, words: [{ text: 'two', gap: '', start: 0.2, end: 0.8 }, { text: 'three', start: 1, end: 1.4 }] },
  ]);
  assert.deepEqual(words.map((w) => [w.text, w.start]), [['one', 28], ['two', 29.2], ['three', 30]]);
  assert.equal(buildTranscript(words).text, 'one two three');
});

test('a range with no words maps to no audio', () => {
  const t = buildTranscript([{ text: 'hello', start: 0, end: 1 }]);
  assert.equal(timeRangeFor(t, 5, 6), null);
});

test('padded ranges join when they touch and stay inside the recording', () => {
  assert.deepEqual(padRanges([[2, 3], [0.1, 1], [3.2, 4]], 0.15, 4.1), [[0, 1.15], [1.85, 4.1]]);
});

test('paragraphs break at pauses', () => {
  const w = (text: string, start: number) => ({ text, start, end: start + 0.3 });
  const p = paragraphs([w('Hello.', 0), w('Again.', 0.5), w('Later', 3), w('on.', 3.4)]);
  assert.deepEqual(p.map((x) => buildTranscript(x).text), ['Hello. Again.', 'Later on.']);
});

test('a word with no length still maps to its moment', () => {
  const t = buildTranscript([{ text: 'Ann', start: 2, end: 2 }]);
  assert.deepEqual(timeRangeFor(t, 0, 3), [2, 2]);
});
