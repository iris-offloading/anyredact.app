import { MAX_CHARS } from '../shared/pricing.ts';
import { runWithRetry, type Env } from './detect.ts';
import { json, readAiPost } from './http.ts';

// Final check before download: the browser sends the document text with every
// redaction already masked (█), and a decision model estimates, per category,
// how likely it is that something sensitive is still readable.

const CHECK_MODEL = '@cf/cloudflare/clef';

const NOT_COUNTED = 'Text replaced with █ characters is already redacted and does not count. Businesses, public services and their helplines or office addresses do not count.';

export const CHECKS = {
  name: 'Is the name of a private person still readable anywhere (full name, first name, surname or initials)?',
  contact: 'Is a private person\'s home address, personal email address or personal phone number still readable?',
  number: 'Is an identifying number still readable, such as a Social Security number, ITIN, passport, licence, tax, account, card, IBAN, patient, employee or case number?',
  date: 'Is a private person\'s date of birth or another personal date still readable?',
  secret: 'Is a password, PIN, access token, API key, username or IP address still readable?',
  health: 'Is health, medical, financial or other sensitive personal information about a private person still readable?',
} as const;

export type CheckKey = keyof typeof CHECKS;

/** Pulls a yes-probability out of a Clef answer, whatever shape it takes. */
export function yesProbability(answer: unknown): number | null {
  if (typeof answer === 'number') return answer;
  if (typeof answer === 'boolean') return answer ? 1 : 0;
  const a = answer as Record<string, unknown> | null;
  if (!a || typeof a !== 'object') return null;
  for (const k of ['noul', 'probability', 'p_yes', 'p', 'score', 'value']) {
    const v = a[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
  }
  const probs = a.probabilities as Record<string, number> | undefined;
  if (probs && typeof probs === 'object') {
    const yes = probs.yes ?? probs.true ?? probs.Yes;
    if (typeof yes === 'number') return yes;
  }
  return null;
}

export async function handleCheck(request: Request, env: Env): Promise<Response> {
  const body = await readAiPost(request, env, 'The final check is not configured on this server.');
  if (body instanceof Response) return body;
  const { text } = body;
  if (typeof text !== 'string' || !text.replace(/[█\s]/g, '')) return json({ risks: {} });
  if (text.length > MAX_CHARS) return json({ error: `Text is too long to check (max ${MAX_CHARS} characters).` }, 413);

  const questions = Object.fromEntries(
    Object.entries(CHECKS).map(([k, q]) => [k, { type: 'noul', instructions: `${q} ${NOT_COUNTED}` }]),
  );
  try {
    const result = (await runWithRetry(() => env.AI!.run(CHECK_MODEL as Parameters<Ai['run']>[0], { model: 'clef', state: text, questions } as never))) as {
      answers?: Record<string, unknown>;
    };
    const risks: Partial<Record<CheckKey, number>> = {};
    for (const k of Object.keys(CHECKS) as CheckKey[]) {
      const p = yesProbability(result?.answers?.[k]);
      if (p !== null) risks[k] = p;
    }
    if (env.MODEL_TRIALS === '1') return json({ risks, raw: result });
    return json({ risks });
  } catch (err) {
    console.error('check failed', err);
    return json({ error: 'The final check is unavailable right now.' }, 502);
  }
}
