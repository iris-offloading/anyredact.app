// Speech to text with word timings, for audio redaction. The browser sends one
// chunk of 16 kHz mono WAV at a time, never the original file; nothing is stored.
//
// scripts/bench-audio.mjs chose the models: MAI-Transcribe-2 on Azure muted 92%
// of personal values in English and 61% in Spanish, against 82% and 1% for
// Nova-3 and 81% and 56% for Whisper turbo, with word times closest to the
// speech. When Azure is not configured or fails, Workers AI takes over: Nova-3
// for English (outside its default English mode its word times run about 0.7 s
// late) and Whisper turbo for other languages.
import { audioCredits, CHUNK_OVERLAP, CHUNK_SECONDS, SPEECH_RATE } from '../shared/pricing.ts';
import { wordsFromAzure, wordsFromDeepgram, wordsFromWhisper, type Word } from '../shared/transcript.ts';
import { chargeUsage, runWithRetry, type Env } from './detect.ts';
import { aiGuard, base64, json } from './http.ts';

export const AZURE_MODEL = 'MAI-Transcribe-2';
export const ENGLISH_MODEL = '@cf/deepgram/nova-3';
export const SPEECH_MODEL = '@cf/openai/whisper-large-v3-turbo';

const HEADER_BYTES = 44;
// A full chunk plus its overlap, with room for a longer header.
const MAX_BYTES = (CHUNK_SECONDS + CHUNK_OVERLAP + 1) * SPEECH_RATE * 2 + 1024;

const tag = (b: Uint8Array, at: number) => String.fromCharCode(...b.subarray(at, at + 4));

/**
 * A WAV whose format is 16 kHz mono 16-bit PCM, the only one the browser sends.
 * Billing counts seconds from the byte length, so a header claiming a lower
 * rate would carry more audio than it pays for.
 */
export function isWav(b: Uint8Array): boolean {
  if (b.length <= HEADER_BYTES || tag(b, 0) !== 'RIFF' || tag(b, 8) !== 'WAVE') return false;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let formats = 0;
  let ok = false;
  for (let at = 12; at + 8 <= b.length; at += 8 + view.getUint32(at + 4, true) + (view.getUint32(at + 4, true) % 2)) {
    const id = tag(b, at);
    if (id === 'data') break;
    if (id !== 'fmt ' || at + 24 > b.length) continue;
    formats++;
    const format = view.getUint16(at + 8, true);
    ok = (format === 1 || format === 0xfffe) && view.getUint16(at + 10, true) === 1 && view.getUint32(at + 12, true) === SPEECH_RATE && view.getUint16(at + 22, true) === 16;
  }
  return formats === 1 && ok;
}

export interface SpeechEnv extends Env {
  TRANSCRIBE_LIMITER?: Env['DETECT_LIMITER'];
  /** Azure Speech resource, e.g. https://<resource>.cognitiveservices.azure.com */
  AZURE_SPEECH_URL?: string;
  AZURE_SPEECH_KEY?: string;
}

async function azure(env: SpeechEnv, wav: Uint8Array): Promise<{ words: Word[]; language?: string }> {
  const form = new FormData();
  form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
  form.append('definition', JSON.stringify({ enhancedMode: { enabled: true, model: AZURE_MODEL, modelOptions: { timestamps: 'word' } } }));
  const res = await fetch(new URL('/speechtotext/transcriptions:transcribe?api-version=2025-10-15', env.AZURE_SPEECH_URL), {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY! },
    body: form,
  });
  if (!res.ok) throw new Error(`Azure Speech ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const result = (await res.json()) as { phrases?: { locale?: string }[] };
  // Locales come as en-US; the browser and the fallback models use en.
  const locale = result.phrases?.find((p) => p.locale)?.locale;
  return { words: wordsFromAzure(result), language: locale?.split('-')[0].toLowerCase() };
}

async function english(env: Env, wav: Uint8Array): Promise<Word[]> {
  const result = await runWithRetry(() =>
    env.AI!.run(ENGLISH_MODEL as never, { audio: { body: new Blob([wav]).stream(), contentType: 'audio/wav' }, smart_format: true } as never),
  );
  return wordsFromDeepgram(result);
}

async function other(env: Env, wav: Uint8Array, language: string | null): Promise<{ words: Word[]; language?: string }> {
  const result = (await runWithRetry(() => env.AI!.run(SPEECH_MODEL as never, { audio: base64(wav), ...(language ? { language } : {}) } as never))) as {
    transcription_info?: { language?: string };
  };
  return { words: wordsFromWhisper(result), language: result.transcription_info?.language };
}

export async function handleTranscribe(request: Request, env: SpeechEnv): Promise<Response> {
  const refused = await aiGuard(request, env.AI, env.TRANSCRIBE_LIMITER ?? env.DETECT_LIMITER, 'Transcription is not configured on this server.', 'speech:');
  if (refused) return refused;

  if (Number(request.headers.get('content-length')) > MAX_BYTES) return json({ error: 'Audio chunk is too large.' }, 413);
  const wav = new Uint8Array(await request.arrayBuffer());
  if (!isWav(wav)) return json({ error: 'Expected a WAV chunk.' }, 400);
  if (wav.length > MAX_BYTES) return json({ error: 'Audio chunk is too large.' }, 413);
  const seconds = (wav.length - HEADER_BYTES) / (SPEECH_RATE * 2);

  // The overlap with the next chunk is not billed, so a full chunk costs CHUNK_SECONDS / 60 credits (with a little slack for rounding).
  const quota = await chargeUsage(request, env, audioCredits(seconds - CHUNK_OVERLAP - 0.05));
  if (quota instanceof Response) return quota;

  const asked = new URL(request.url).searchParams.get('language')?.toLowerCase() || null;
  const language = asked && /^[a-z]{2,3}$/.test(asked) ? asked : null;
  if (env.AZURE_SPEECH_URL && env.AZURE_SPEECH_KEY) {
    try {
      const found = await azure(env, wav);
      return json({ words: found.words, language: language ?? found.language ?? null, quota: quota.state });
    } catch (err) {
      console.warn('MAI-Transcribe failed, using Workers AI', err);
    }
  }
  // The first chunk arrives without a language: Whisper names it, and English is then redone with Nova-3.
  try {
    if (language === 'en') return json({ words: await english(env, wav), language, quota: quota.state });
    const found = await other(env, wav, language);
    if (!language && found.language === 'en') {
      try {
        return json({ words: await english(env, wav), language: 'en', quota: quota.state });
      } catch (err) {
        console.warn('english model failed, keeping whisper words', err);
      }
    }
    return json({ words: found.words, language: language ?? found.language ?? null, quota: quota.state });
  } catch (err) {
    console.error('transcription failed', err);
    await quota.refund();
    return json({ error: 'Audio transcription is temporarily unavailable. Please try again in a moment.' }, 502);
  }
}
