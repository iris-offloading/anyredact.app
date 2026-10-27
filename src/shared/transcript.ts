// Turns timed words from a speech model into text that detection can read,
// and maps character ranges of that text back to stretches of audio.

// Seconds added on both sides of every bleep, so word edges don't slip through.
export const BLEEP_PAD = 0.15;

export interface Word {
  text: string;
  /** What separates the word from the one before: Whisper writes "4-1-1" as " 4", "-1", "-1". */
  gap?: string;
  /** Seconds from the start of the recording. */
  start: number;
  end: number;
}

export interface Transcript {
  text: string;
  words: Word[];
  /** Character range of each word in `text`. */
  offsets: [number, number][];
}

/** Words from a Deepgram response (Nova-3), preferring the formatted form ("555-0142," over "five"). */
export function wordsFromDeepgram(result: unknown): Word[] {
  const alt = (result as { results?: { channels?: { alternatives?: { words?: { word: string; punctuated_word?: string; start: number; end: number }[] }[] }[] } })
    ?.results?.channels?.[0]?.alternatives?.[0];
  return (alt?.words ?? []).map((w) => ({ text: w.punctuated_word ?? w.word, start: w.start, end: w.end }));
}

/** Words from a Whisper response, which nests them in segments. */
export function wordsFromWhisper(result: unknown): Word[] {
  const segments = (result as { segments?: { words?: { word: string; start: number; end: number }[] }[] })?.segments ?? [];
  return segments
    .flatMap((s) => s.words ?? [])
    .map((w) => ({ text: w.word.trim(), gap: /^\s/.test(w.word) ? ' ' : '', start: w.start, end: w.end }))
    .filter((w) => w.text);
}

/**
 * Joins the words of consecutive chunks into one list. Chunks overlap, so each
 * one keeps only the words whose middle falls in its own share of the overlap.
 */
export function mergeChunks(chunks: { start: number; end: number; words: Word[] }[]): Word[] {
  const out: Word[] = [];
  chunks.forEach((c, i) => {
    const prev = chunks[i - 1];
    const next = chunks[i + 1];
    const from = prev ? (c.start + prev.end) / 2 : -Infinity;
    const to = next ? (next.start + c.end) / 2 : Infinity;
    let first = true;
    for (const w of c.words) {
      const word = { ...w, start: w.start + c.start, end: w.end + c.start };
      const mid = (word.start + word.end) / 2;
      if (mid < from || mid >= to) continue;
      // A chunk starts on a new word, whatever the model put before it.
      if (first && prev) word.gap = ' ';
      first = false;
      out.push(word);
    }
  });
  return out;
}

export function buildTranscript(words: Word[]): Transcript {
  let text = '';
  const offsets: [number, number][] = [];
  for (const w of words) {
    if (text) text += w.gap ?? ' ';
    offsets.push([text.length, text.length + w.text.length]);
    text += w.text;
  }
  return { text, words, offsets };
}

/** The stretch of audio that holds characters [start, end) of the transcript, or null when no word does. */
export function timeRangeFor(t: Transcript, start: number, end: number): [number, number] | null {
  // Offsets are in order: find the first word that ends after `start`.
  let lo = 0;
  let hi = t.offsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t.offsets[mid][1] <= start) lo = mid + 1;
    else hi = mid;
  }
  let from = Infinity;
  let to = -Infinity;
  for (let i = lo; i < t.offsets.length && t.offsets[i][0] < end; i++) {
    from = Math.min(from, t.words[i].start);
    to = Math.max(to, t.words[i].end);
  }
  return from <= to ? [from, to] : null;
}

/** Widens each range by `pad` seconds on both sides and joins ranges that touch. */
export function padRanges(ranges: [number, number][], pad: number, duration = Infinity): [number, number][] {
  const sorted = ranges.map(([s, e]) => [Math.max(0, s - pad), Math.min(duration, e + pad)] as [number, number]).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push(r);
  }
  return out;
}

/** Splits words into paragraphs at pauses, so a long recording reads as more than one block. */
export function paragraphs(words: Word[], pause = 1.5, maxWords = 80): Word[][] {
  const out: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    const last = cur[cur.length - 1];
    if (last && (w.start - last.end >= pause || cur.length >= maxWords)) {
      out.push(cur);
      cur = [];
    }
    cur.push(cur.length ? w : { ...w, gap: undefined });
  }
  if (cur.length) out.push(cur);
  return out;
}
