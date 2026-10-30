import {
  ADTS,
  AdtsOutputFormat,
  ALL_FORMATS,
  AudioSample,
  BlobSource,
  BufferTarget,
  canEncodeAudio,
  Conversion,
  FLAC,
  FlacOutputFormat,
  Input,
  MP4,
  Mp3OutputFormat,
  Mp4OutputFormat,
  OGG,
  OggOutputFormat,
  Output,
  QTFF,
  WAVE,
  WavOutputFormat,
  WEBM,
  WebMOutputFormat,
  type AudioCodec,
  type InputFormat,
  type MetadataTags,
  type OutputFormat,
} from 'mediabunny';
import { pool } from '../../shared/pool.ts';
import { CHUNK_OVERLAP, CHUNK_SECONDS, SPEECH_RATE } from '../../shared/pricing.ts';
import { BLEEP_PAD, buildTranscript, mergeChunks, padRanges, paragraphs, timeRangeFor, type Word } from '../../shared/transcript.ts';
import { maskText } from '../../shared/detect.ts';
import { postApi } from '../ai.ts';
import { clock } from '../timeline.ts';
import { FileError, isBox, outputName, type Finding, type LoadedDoc, type MetaField, type Progress, type RedactStyle } from '../types.ts';
import { show } from './metadata.ts';

export const MAX_AUDIO_SECONDS = 2 * 60 * 60;
const FADE = 0.01;
const TONE_HZ = 1000;
const TONE_GAIN = 0.3;
// Chunks in flight at once once the language is known.
const PARALLEL = 3;
const UNREADABLE = 'This audio file could not be read in your browser.';

export async function loadAudio(file: File, progress: Progress): Promise<LoadedDoc> {
  progress('Opening audio…');
  // One reader for the whole document, so the file is indexed once for every chunk and the export.
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  let duration: number;
  let format: InputFormat;
  try {
    if (!(await input.getPrimaryAudioTrack())) throw new Error('none');
    duration = await input.computeDuration();
    if (!(duration > 0)) throw new Error('empty');
    format = await input.getFormat();
  } catch {
    input.dispose();
    throw new FileError('No audio track was found in this file. Try an MP3, M4A, WAV, FLAC, OGG, or Opus file.');
  }
  if (duration > MAX_AUDIO_SECONDS) {
    input.dispose();
    throw new FileError('Recordings up to 2 hours can be redacted. Please trim or split longer files.');
  }
  const metadata = describeTags(await input.getMetadataTags().catch(() => ({}) as MetadataTags));
  const url = URL.createObjectURL(file);

  const doc: LoadedDoc = {
    kind: 'audio',
    units: [],
    pages: [],
    notes: [],
    metadata,
    styles: [
      ['beep', 'Beep'],
      ['silence', 'Silence'],
    ],
    audio: { url, duration },
    async transcribe(progress) {
      const words = await transcribe(input, duration, progress);
      doc.units = paragraphs(words).map((p, i) => {
        const t = buildTranscript(p);
        const words = t.offsets.map(([from, to], k) => ({ from, to, start: p[k].start, end: p[k].end }));
        return { id: `speech-${i}`, text: t.text, words, timesFor: (s, e) => timeRangeFor(t, s, e) };
      });
    },
    dispose() {
      URL.revokeObjectURL(url);
      input.dispose();
    },
    async exportFile(findings, marks, style, progress) {
      const ranges = padRanges(
        [...findings.filter((f) => f.enabled && f.times).map((f) => f.times!), ...marks.flatMap((m) => (isBox(m) ? [] : [m.times]))],
        BLEEP_PAD,
        duration,
      );
      const { blob, ext } = await exportAudio(input, format, ranges, style, progress);
      return { blob, filename: outputName(file.name, ext) };
    },
    async exportTranscript(findings, marks) {
      const stretches = marks.flatMap((m) => (isBox(m) ? [] : [m.times]));
      const text = doc.units
        .map((u) => {
          const spans = findings.filter((f) => f.enabled && f.unitId === u.id);
          // Words spoken inside a stretch picked on the timeline are bleeped too.
          for (const w of u.words ?? []) if (stretches.some(([s, e]) => w.start < e && w.end > s)) spans.push({ start: w.from, end: w.to } as Finding);
          return `[${clock(u.words?.[0]?.start ?? 0)}] ${maskText(u.text, spans)}`;
        })
        .join('\n\n');
      return { blob: new Blob([text + '\n'], { type: 'text/plain;charset=utf-8' }), filename: outputName(file.name, 'txt').replace(/\.txt$/, '-transcript.txt') };
    },
  };
  return doc;
}

/** One stretch of the recording as 16 kHz mono WAV, the only form that is sent for transcription. */
async function speechChunk(input: Input, start: number, end: number): Promise<ArrayBuffer> {
  const output = new Output({ format: new WavOutputFormat(), target: new BufferTarget() });
  const conversion = await Conversion.init({
    input,
    output,
    trim: { start, end },
    video: { discard: true },
    audio: { numberOfChannels: 1, sampleRate: SPEECH_RATE, codec: 'pcm-s16' },
    tags: {},
    showWarnings: false,
  });
  if (!conversion.isValid) throw new FileError(UNREADABLE);
  await conversion.execute();
  if (!output.target.buffer) throw new FileError(UNREADABLE);
  return output.target.buffer;
}

async function transcribeChunk(wav: ArrayBuffer, language: string | null): Promise<{ words: Word[]; language: string | null }> {
  const data = await postApi<{ words?: Word[]; language?: string | null }>(`/api/transcribe${language ? `?language=${encodeURIComponent(language)}` : ''}`, wav, 'Transcription failed', 'audio/wav');
  return { words: data.words ?? [], language: data.language ?? null };
}

async function transcribe(input: Input, duration: number, progress: Progress): Promise<Word[]> {
  const chunks: { start: number; end: number; words: Word[] }[] = [];
  // A last stretch no longer than the overlap is already in the chunk before it.
  for (let start = 0; start === 0 || start < duration - CHUNK_OVERLAP; start += CHUNK_SECONDS) chunks.push({ start, end: Math.min(duration, start + CHUNK_SECONDS + CHUNK_OVERLAP), words: [] });
  // Each chunk is decoded once, and the next few are decoded while earlier ones are being transcribed.
  const wavs: (Promise<ArrayBuffer> | null)[] = chunks.map(() => null);
  const wav = (i: number) => (wavs[i] ??= speechChunk(input, chunks[i].start, chunks[i].end));
  let done = 0;
  const say = () => progress(chunks.length > 1 ? `Transcribing audio… part ${done + 1} of ${chunks.length}` : 'Transcribing audio…');
  say();
  for (let i = 1; i <= PARALLEL && i < chunks.length; i++) wav(i).catch(() => {});
  // The first chunk names the language, so the rest go straight to the right model.
  const first = await transcribeChunk(await wav(0), null);
  wavs[0] = null;
  chunks[0].words = first.words;
  done++;
  await pool(chunks.length - 1, PARALLEL, async (n) => {
    const i = n + 1;
    say();
    chunks[i].words = (await transcribeChunk(await wav(i), first.language)).words;
    wavs[i] = null;
    if (i + PARALLEL < chunks.length) wav(i + PARALLEL).catch(() => {});
    done++;
  });
  return mergeChunks(chunks);
}

interface Target {
  format: OutputFormat;
  codec: AudioCodec;
  ext: string;
  type: string;
}

const mp3 = (): Target => ({ format: new Mp3OutputFormat(), codec: 'mp3', ext: 'mp3', type: 'audio/mpeg' });
const wav = (): Target => ({ format: new WavOutputFormat(), codec: 'pcm-s16', ext: 'wav', type: 'audio/wav' });

/** The input's own format when this browser can encode it, MP3 otherwise. */
async function targetFor(format: InputFormat): Promise<Target> {
  const can = (codec: AudioCodec) => canEncodeAudio(codec).catch(() => false);
  if (format === WAVE) return wav();
  if (format === FLAC) return (await can('flac')) ? { format: new FlacOutputFormat(), codec: 'flac', ext: 'flac', type: 'audio/flac' } : wav();
  if ((format === MP4 || format === QTFF) && (await can('aac'))) return { format: new Mp4OutputFormat(), codec: 'aac', ext: 'm4a', type: 'audio/mp4' };
  if (format === ADTS && (await can('aac'))) return { format: new AdtsOutputFormat(), codec: 'aac', ext: 'aac', type: 'audio/aac' };
  if (format === OGG && (await can('opus'))) return { format: new OggOutputFormat(), codec: 'opus', ext: 'ogg', type: 'audio/ogg' };
  if (format === WEBM && (await can('opus'))) return { format: new WebMOutputFormat(), codec: 'opus', ext: 'webm', type: 'audio/webm' };
  return mp3();
}

async function exportAudio(input: Input, inputFormat: InputFormat, ranges: [number, number][], style: RedactStyle, progress?: Progress) {
  const target = await targetFor(inputFormat);
  // Browsers have no MP3 encoder of their own; LAME then runs in WebAssembly.
  if (target.codec === 'mp3' && !(await canEncodeAudio('mp3'))) (await import('@mediabunny/mp3-encoder')).registerMp3Encoder();
  const output = new Output({ format: target.format, target: new BufferTarget() });
  const conversion = await Conversion.init({
    input,
    output,
    video: { discard: true },
    // A new file with no title, artist, comments, cover art or location.
    tags: {},
    audio: { codec: target.codec, forceTranscode: true, process: (sample) => bleep(sample, ranges, style === 'silence' ? 'silence' : 'beep') },
    showWarnings: false,
  });
  if (!conversion.isValid) throw new FileError('This audio file could not be re-encoded in your browser.');
  if (progress) conversion.onProgress = (p) => progress(`Preparing your redacted file… ${Math.round(p * 100)}%`);
  await conversion.execute();
  return { blob: new Blob([output.target.buffer!], { type: target.type }), ext: target.ext };
}

/** Replaces the samples inside `ranges` with a tone or silence, with short fades at each edge. */
export function bleep(sample: AudioSample, ranges: [number, number][], how: 'beep' | 'silence'): AudioSample {
  const t0 = sample.timestamp;
  const t1 = t0 + sample.duration;
  const hits = ranges.filter(([a, b]) => a < t1 && t0 < b);
  if (!hits.length) return sample;
  const frames = sample.numberOfFrames;
  const channels = sample.numberOfChannels;
  const rate = sample.sampleRate;
  const data = new Float32Array(frames * channels);
  for (let c = 0; c < channels; c++) sample.copyTo(data.subarray(c * frames, (c + 1) * frames), { planeIndex: c, format: 'f32-planar' });
  for (const [a, b] of hits) {
    const from = Math.max(0, Math.floor((a - t0) * rate));
    const to = Math.min(frames, Math.ceil((b - t0) * rate));
    for (let i = from; i < to; i++) {
      const t = t0 + i / rate;
      // 0 at the range edges, 1 once FADE seconds inside.
      const g = Math.max(0, Math.min(1, (t - a) / FADE, (b - t) / FADE));
      const tone = how === 'beep' ? TONE_GAIN * Math.sin(2 * Math.PI * TONE_HZ * t) : 0;
      for (let c = 0; c < channels; c++) {
        const k = c * frames + i;
        data[k] = data[k] * (1 - g) + tone * g;
      }
    }
  }
  const out = new AudioSample({ data, format: 'f32-planar', numberOfChannels: channels, sampleRate: rate, timestamp: t0 });
  sample.close();
  return out;
}

// Tags people care about first; everything else is listed under "More fields".
const KEY_TAGS: [keyof MetadataTags, string][] = [
  ['title', 'Title'],
  ['artist', 'Artist'],
  ['albumArtist', 'Album artist'],
  ['album', 'Album'],
  ['date', 'Recorded'],
  ['comment', 'Comment'],
  ['description', 'Description'],
  ['lyrics', 'Lyrics'],
  ['genre', 'Genre'],
];
// Raw tags that hold a place: QuickTime and iTunes location atoms.
const LOCATION = /xyz|location|gps/i;

export function describeTags(tags: MetadataTags): MetaField[] {
  const out: MetaField[] = [];
  // Raw tags also hold pictures and attached files, which are not text to list.
  const raw = Object.entries(tags.raw ?? {}).map(([k, v]) => [k, typeof v === 'string' || Array.isArray(v) ? show(v) : ''] as const);
  const seen = new Set<string>();
  for (const [k, value] of raw) {
    if (value && LOCATION.test(k)) out.push({ label: 'Location', value, key: true });
  }
  for (const [k, label] of KEY_TAGS) {
    const value = show(tags[k]);
    if (!value) continue;
    seen.add(value);
    out.push({ label, value, key: true });
  }
  if (tags.images?.length) out.push({ label: 'Cover art', value: `${tags.images.length} image${tags.images.length > 1 ? 's' : ''}`, key: true });
  for (const [k, value] of raw) {
    if (!value || seen.has(value) || LOCATION.test(k)) continue;
    out.push({ label: k, value, key: false });
  }
  return out;
}
