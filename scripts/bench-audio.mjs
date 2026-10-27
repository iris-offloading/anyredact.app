// Compares Workers AI speech-to-text models for audio redaction, against a preview deployment.
//
//   node scripts/bench-dataset.mjs fetch <dir>
//   node --experimental-strip-types scripts/bench-audio.mjs speak <preview-url> <dir>/ai4privacy.json <dir> [recordings per language]
//   node --experimental-strip-types scripts/bench-audio.mjs run <preview-url> <dir> <model[{options}]> [chunk seconds]
//
// `speak` turns labelled sentences (ai4privacy, English and Spanish) and a few
// phone calls into speech with Deepgram Aura 2. Every labelled value is spoken
// as its own clip, so its place in the recording is known to the millisecond.
// `run` transcribes each recording, runs the app's detection on the transcript
// and mutes what the app would mute (AI findings and their other mentions, default "Look for" types,
// ticked findings only). A value counts as muted when 90% of its speech is.
// Results and transcripts go to <dir>/<model>.transcripts.json for a closer look.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import wavefile from 'wavefile';
import { SPEECH_RATE as RATE } from '../src/shared/pricing.ts';
import { BLEEP_PAD as PAD } from '../src/shared/transcript.ts';

const { WaveFile } = wavefile;
const [mode, ...args] = process.argv.slice(2);
const SENTENCES_PER_RECORDING = 8;
const VOICES = { en: ['luna', 'orion', 'athena', 'zeus', 'thalia', 'apollo'], es: ['aquila', 'carina', 'nestor', 'diana'] };
const TTS = { en: '@cf/deepgram/aura-2-en', es: '@cf/deepgram/aura-2-es' };
// USD per audio minute, from the Workers AI model pages.
const PRICES = { '@cf/deepgram/nova-3': 0.0052, '@cf/openai/whisper-large-v3-turbo': 0.000513, '@cf/openai/whisper': 0.000453 };
// Same core labels as scripts/bench-dataset.mjs.
const CORE = new Set('GIVENNAME SURNAME TELEPHONENUM EMAIL STREET BUILDINGNUM ZIPCODE IDCARDNUM PASSPORTNUM TAXNUM DRIVERLICENSENUM SOCIALNUM CREDITCARDNUMBER'.split(' '));
const APP_TYPES = ['name', 'address', 'email', 'phone', 'id', 'ssn', 'date', 'card', 'iban', 'ip', 'other'];

// Phone calls written the way people talk, with the values a redaction must remove.
const CALLS = [
  {
    text: `Thanks for calling Northwind Bank, my name is Priya, how can I help? Hi Priya, it's Marcus Albright. I want to report a lost card. Sure, can I have the card number? It's 4539 1488 0343 6467. And your date of birth? March third, 1984. Thanks Marcus. I'll send a new card to 27 Willow Crescent, Leeds LS6 2AB. Is that still right? Yes, that's right. My mobile is 07700 900 318 if you need it.`,
    find: { GIVENNAME: ['Priya', 'Marcus Albright', 'Marcus'], CREDITCARDNUMBER: ['4539 1488 0343 6467'], STREET: ['27 Willow Crescent'], ZIPCODE: ['LS6 2AB'], TELEPHONENUM: ['07700 900 318'], date_of_birth: ['March third, 1984'] },
  },
  {
    text: `Dr. Hannah Okafor's office, this is Tom. Hello, I'm calling about my mother, Ruth Delgado. Her patient number is 88 41 207. She needs her insulin prescription renewed. Can you spell the email we should use? It's r dot delgado at outlook dot com. Okay. And a phone number? 312 555 0187. Thank you, Dr. Okafor will call her back today.`,
    find: { GIVENNAME: ['Hannah Okafor', 'Tom', 'Ruth Delgado', 'Okafor'], IDCARDNUM: ['88 41 207'], EMAIL: ['r dot delgado at outlook dot com'], TELEPHONENUM: ['312 555 0187'] },
  },
  {
    text: `Hi, this is a message for Daniel Fischer. This is Lena from the passport office. We found an error in your application, number P 7 3 2 9 1 4 5 8. Please call us back on 0 2 0 7 9 4 6 0 0 1 2. Your social security number ending 6 7 2 1 was also missing a digit. The full number we have is 5 2 4 4 8 6 7 2 1. Thanks Daniel, bye.`,
    find: { GIVENNAME: ['Daniel Fischer', 'Lena', 'Daniel'], PASSPORTNUM: ['P 7 3 2 9 1 4 5 8'], TELEPHONENUM: ['0 2 0 7 9 4 6 0 0 1 2'], SOCIALNUM: ['5 2 4 4 8 6 7 2 1', '6 7 2 1'] },
  },
  {
    text: `Hey Sam, it's Kofi. I moved, so the new address is 1450 Pine Street, apartment 12, San Francisco, 94109. My new number is four one five, two two eight, nine three one zero. And my Venmo is kofi underscore mensah 88. See you Saturday at Alicia's.`,
    find: { GIVENNAME: ['Sam', 'Kofi', 'Alicia'], STREET: ['1450 Pine Street, apartment 12'], ZIPCODE: ['94109'], TELEPHONENUM: ['four one five, two two eight, nine three one zero'], user_name: ['kofi underscore mensah 88'] },
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(base, route, body) {
  for (let t = 0; t < 6; t++) {
    const res = await fetch(new URL(route, base), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: new URL(base).origin, 'x-trial-key': process.env.TRIAL_KEY ?? '' },
      body: JSON.stringify(body),
    }).catch((err) => ({ status: 0, err }));
    if (res.status === 200) return res.json();
    console.error(`${route}: ${res.status} ${res.err ?? (await res.text()).slice(0, 200)}`);
    await sleep(res.status === 429 ? 20_000 : 5_000 * 2 ** t);
  }
  throw new Error(`${route} kept failing`);
}

// Labelled sentences become a list of parts: values on their own, plain text between them.
function partsOf(text, spans) {
  const parts = [];
  let at = 0;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    if (s.start < at) continue;
    if (s.start > at) parts.push({ text: text.slice(at, s.start) });
    parts.push({ text: text.slice(s.start, s.end), label: s.label });
    at = s.end;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts.filter((p) => /[\p{L}\p{N}]/u.test(p.text)).map((p) => ({ ...p, text: p.text.trim() }));
}

function callSpans(call) {
  const spans = [];
  for (const [label, values] of Object.entries(call.find))
    for (const v of values)
      for (let i = call.text.indexOf(v); i >= 0; i = call.text.indexOf(v, i + 1))
        if (!spans.some((s) => i < s.end && s.start < i + v.length)) spans.push({ start: i, end: i + v.length, label });
  return spans;
}

// First and last sample louder than the threshold: the speech inside a clip.
function speechBounds(pcm) {
  const loud = (x) => Math.abs(x) > 600;
  let a = 0;
  let b = pcm.length - 1;
  while (a < b && !loud(pcm[a])) a++;
  while (b > a && !loud(pcm[b])) b--;
  return [a, b + 1];
}

async function speak(base, file, dir, perLang) {
  mkdirSync(dir, { recursive: true });
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  const recordings = [];
  for (const lang of ['en', 'es']) {
    const pool = rows.filter((r) => r.lang === lang && r.text.length < 400);
    for (let i = 0; i < perLang && (i + 1) * SENTENCES_PER_RECORDING <= pool.length; i++) {
      const sentences = pool.slice(i * SENTENCES_PER_RECORDING, (i + 1) * SENTENCES_PER_RECORDING);
      recordings.push({ lang, parts: sentences.flatMap((s) => partsOf(s.text, s.spans)) });
    }
  }
  CALLS.forEach((c) => recordings.push({ lang: 'en', kind: 'call', parts: partsOf(c.text, callSpans(c)) }));

  const cases = [];
  for (const [n, rec] of recordings.entries()) {
    const voice = VOICES[rec.lang][n % VOICES[rec.lang].length];
    const pieces = [];
    for (let i = 0; i < rec.parts.length; i += 40) {
      const batch = rec.parts.slice(i, i + 40);
      const body = await post(base, '/api/trial', {
        model: TTS[rec.lang],
        inputs: batch.map((p) => ({ text: p.text, speaker: voice, encoding: 'linear16', container: 'none', sample_rate: RATE })),
      });
      body.results.forEach((r, j) => {
        if (r.error) throw new Error(`speech failed for ${JSON.stringify(batch[j].text)}: ${r.error}`);
        const buf = Buffer.from(r.result.audio, 'base64');
        pieces.push(new Int16Array(buf.buffer, buf.byteOffset, buf.length >> 1));
      });
    }
    const total = pieces.reduce((a, p) => a + p.length, 0);
    const pcm = new Int16Array(total);
    const gold = [];
    let at = 0;
    pieces.forEach((p, j) => {
      pcm.set(p, at);
      const part = rec.parts[j];
      if (part.label) {
        const [a, b] = speechBounds(p);
        // Aura sometimes says nothing for a lone foreign name: nothing to mute then.
        if (b - a < 0.05 * RATE) console.error(`no speech for ${JSON.stringify(part.text)}`);
        else gold.push({ label: part.label, text: part.text, start: (at + a) / RATE, end: (at + b) / RATE });
      }
      at += p.length;
    });
    const wav = new WaveFile();
    wav.fromScratch(1, RATE, '16', pcm);
    const name = `rec-${String(n).padStart(2, '0')}-${rec.lang}${rec.kind ? `-${rec.kind}` : ''}.wav`;
    writeFileSync(path.join(dir, name), wav.toBuffer());
    cases.push({ file: name, lang: rec.lang, kind: rec.kind ?? 'sentences', voice, duration: total / RATE, text: rec.parts.map((p) => p.text).join(' '), gold });
    console.error(`${n + 1}/${recordings.length} ${name} ${(total / RATE).toFixed(1)} s`);
  }
  writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(cases, null, 1));
}

function chunksOf(pcm, chunkSec) {
  if (!chunkSec || pcm.length <= chunkSec * RATE) return [{ start: 0, end: pcm.length / RATE, pcm }];
  const out = [];
  const step = (chunkSec - 1) * RATE;
  for (let a = 0; a < pcm.length; a += step) {
    const b = Math.min(pcm.length, a + chunkSec * RATE);
    out.push({ start: a / RATE, end: b / RATE, pcm: pcm.subarray(a, b) });
    if (b === pcm.length) break;
  }
  return out;
}

function covered(range, mutes) {
  let n = 0;
  for (const [a, b] of mutes) n += Math.max(0, Math.min(b, range.end) - Math.max(a, range.start));
  return n / Math.max(1e-6, range.end - range.start);
}

const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');

async function run(base, dir, spec, chunkSec) {
  const t = await import('../src/shared/transcript.ts');
  const { analyzeUnits, startsTicked } = await import('../src/shared/analyze.ts');
  const brace = spec.indexOf('{');
  const model = brace < 0 ? spec : spec.slice(0, brace);
  const options = brace < 0 ? {} : JSON.parse(spec.slice(brace));
  const deepgram = model.includes('deepgram');
  // `byLang` holds options for one language only, e.g. {"byLang":{"es":{"language":"es"}}}.
  // `shift` moves every word by that many seconds (bench only), to test a fixed timing offset.
  const { byLang, shift = 0, ...rest } = options;
  const cases = JSON.parse(readFileSync(path.join(dir, 'cases.json'), 'utf8'));

  // Transcribe: every chunk of a few recordings per request.
  let asrMs = 0;
  let minutes = 0;
  const transcripts = [];
  for (let i = 0; i < cases.length; i += 4) {
    const group = cases.slice(i, i + 4);
    const batch = group.map((c) => {
      const wav = new WaveFile(readFileSync(path.join(dir, c.file)));
      const pcm = wav.getSamples(false, Int16Array);
      minutes += pcm.length / RATE / 60;
      return chunksOf(pcm, chunkSec);
    });
    const inputs = batch.flatMap((chunks, j) =>
      chunks.map((ch) => {
        const w = new WaveFile();
        w.fromScratch(1, RATE, '16', ch.pcm);
        const b64 = Buffer.from(w.toBuffer()).toString('base64');
        return { ...rest, ...byLang?.[group[j].lang], audio: deepgram ? { base64: b64, contentType: 'audio/wav' } : b64 };
      }),
    );
    const body = await post(base, '/api/trial', { model, inputs });
    let k = 0;
    for (const chunks of batch) {
      const parts = chunks.map((ch) => {
        const r = body.results[k++];
        if (r.error) console.error(`transcription error: ${r.error}`);
        asrMs += r.ms ?? 0;
        return { start: ch.start + shift, end: ch.end + shift, words: r.error ? [] : deepgram ? t.wordsFromDeepgram(r.result) : t.wordsFromWhisper(r.result) };
      });
      transcripts.push(t.buildTranscript(t.mergeChunks(parts)));
    }
    console.error(`${transcripts.length}/${cases.length} transcribed`);
  }

  // Detect, the way bench-dataset.mjs does, with the preview's default model.
  const found = [];
  for (let i = 0; i < transcripts.length; i += 10) {
    const body = await post(base, '/api/detect', { texts: transcripts.slice(i, i + 10).map((x) => x.text || ' ') });
    found.push(...body.results);
  }

  const blank = () => ({ total: 0, heard: 0, muted: 0, partial: 0 });
  const stats = {};
  const byLanguage = { en: blank(), es: blank() };
  const misses = [];
  const saved = [];
  let extraSec = 0;
  let mutedSec = 0;
  let totalSec = 0;
  cases.forEach((c, i) => {
    const tr = transcripts[i];
    const spans = analyzeUnits([{ id: 'u', text: tr.text }], { ai: found[i]?.entities ?? null }).filter((s) => APP_TYPES.includes(s.type) && startsTicked(s));
    const mutes = t.padRanges(spans.map((s) => t.timeRangeFor(tr, s.start, s.end)).filter(Boolean), PAD, c.duration);
    const heardText = norm(tr.text);
    saved.push({ file: c.file, transcript: tr.text, muted: spans.map((s) => `${s.type}: ${tr.text.slice(s.start, s.end)}`) });
    for (const g of c.gold) {
      const core = CORE.has(g.label) || c.kind === 'call';
      const share = covered(g, mutes);
      for (const s of [(stats[core ? g.label : `(optional) ${g.label}`] ??= blank()), ...(core ? [byLanguage[c.lang]] : [])]) {
        s.total++;
        if (heardText.includes(norm(g.text))) s.heard++;
        if (share >= 0.9) s.muted++;
        else if (share >= 0.5) s.partial++;
      }
      if (core && share < 0.9 && misses.length < 40) misses.push(`${c.file} ${g.label}: ${JSON.stringify(g.text)} ${Math.round(share * 100)}% muted`);
    }
    totalSec += c.duration;
    for (const [a, b] of mutes) {
      mutedSec += b - a;
      extraSec += (b - a) * (1 - covered({ start: a, end: b }, c.gold.map((g) => [g.start - PAD, g.end + PAD])));
    }
  });

  writeFileSync(path.join(dir, `${model.split('/').pop()}${chunkSec ? `-${chunkSec}s` : ''}.transcripts.json`), JSON.stringify(saved, null, 1));

  const sum = (pred) => Object.entries(stats).filter(([l]) => pred(l)).reduce((a, [, s]) => ({ total: a.total + s.total, heard: a.heard + s.heard, muted: a.muted + s.muted, partial: a.partial + s.partial }), blank());
  const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-');
  const report = (s) => ({ values: s.total, muted: pct(s.muted, s.total), partlyMuted: pct(s.partial, s.total), heardVerbatim: pct(s.heard, s.total) });
  return {
    model,
    options,
    chunkSec: chunkSec || 'whole recording',
    recordings: cases.length,
    audioMinutes: +minutes.toFixed(1),
    costUsd: +(minutes * (PRICES[model] ?? 0)).toFixed(4),
    transcribeSecondsPerAudioMinute: +(asrMs / 1000 / minutes).toFixed(2),
    core: report(sum((l) => !l.startsWith('('))),
    byLanguage: { en: report(byLanguage.en), es: report(byLanguage.es) },
    mutedOutsideValues: `${pct(extraSec, totalSec)} of the audio (${pct(mutedSec, totalSec)} muted in all)`,
    perLabel: Object.fromEntries(Object.entries(stats).sort((a, b) => b[1].total - a[1].total).map(([l, s]) => [l, `${s.muted}/${s.total} muted, ${s.heard} heard`])),
    misses,
    sampleTranscript: transcripts[cases.length - 1]?.text,
  };
}

if (mode === 'speak') await speak(args[0], args[1], args[2], Number(args[3]) || 15);
else if (mode === 'run') console.log(JSON.stringify(await run(args[0], args[1], args[2], Number(args[3]) || 0), null, 2));
else console.error('usage: see the top of scripts/bench-audio.mjs');
