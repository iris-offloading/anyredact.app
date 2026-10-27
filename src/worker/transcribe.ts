// Speech to text with word timings, for audio redaction. The browser sends one
// chunk of 16 kHz mono WAV at a time, never the original file; nothing is stored.
//
// scripts/bench-audio.mjs chose the models: on English speech Nova-3 muted 86%
// of personal values against Whisper turbo's 81%, but outside its default
// English mode Nova-3 reports word times about 0.7 s late, so other languages
// go to Whisper turbo (70% on Spanish, against Nova-3's 18%).
import { audioCredits, CHUNK_OVERLAP, CHUNK_SECONDS, PAGE_CHARS, SPEECH_RATE } from '../shared/pricing.ts';
import { wordsFromDeepgram, wordsFromWhisper, type Word } from '../shared/transcript.ts';
import { chargeUsage, runWithRetry, type Env } from './detect.ts';
import { aiGuard, base64, json } from './http.ts';

export const ENGLISH_MODEL = '@cf/deepgram/nova-3';
export const SPEECH_MODEL = '@cf/openai/whisper-large-v3-turbo';

const HEADER_BYTES = 44;
// A full chunk plus its overlap, with room for a longer header.
const MAX_BYTES = (CHUNK_SECONDS + CHUNK_OVERLAP + 1) * SPEECH_RATE * 2 + 1024;

const isWav = (b: Uint8Array) => b.length > HEADER_BYTES && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WAVE';

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

export async function handleTranscribe(request: Request, env: Env & { TRANSCRIBE_LIMITER?: Env['DETECT_LIMITER'] }): Promise<Response> {
  const refused = await aiGuard(request, env.AI, env.TRANSCRIBE_LIMITER ?? env.DETECT_LIMITER, 'Transcription is not configured on this server.', 'speech:');
  if (refused) return refused;

  if (Number(request.headers.get('content-length')) > MAX_BYTES) return json({ error: 'Audio chunk is too large.' }, 413);
  const wav = new Uint8Array(await request.arrayBuffer());
  if (!isWav(wav)) return json({ error: 'Expected a WAV chunk.' }, 400);
  if (wav.length > MAX_BYTES) return json({ error: 'Audio chunk is too large.' }, 413);
  const seconds = (wav.length - HEADER_BYTES) / (SPEECH_RATE * 2);

  // The overlap with the next chunk is not billed, so a full chunk costs CHUNK_SECONDS / 60 credits (with a little slack for rounding).
  const quota = await chargeUsage(request, env, audioCredits(seconds - CHUNK_OVERLAP - 0.05) * PAGE_CHARS);
  if (quota instanceof Response) return quota;

  // The first chunk arrives without a language: Whisper names it, and English is then redone with Nova-3.
  const asked = new URL(request.url).searchParams.get('language')?.toLowerCase() || null;
  const language = asked && /^[a-z]{2,3}$/.test(asked) ? asked : null;
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
    return json({ error: 'Transcription is unavailable right now.' }, 502);
  }
}
