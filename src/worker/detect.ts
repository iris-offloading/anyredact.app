import { plausibleEntity } from '../shared/detect.ts';
import { pagesFor } from '../shared/pricing.ts';
import { currentUser } from './accounts.ts';
import { spendPaidPages, type BillingEnv } from './billing.ts';
import { chargeQuota, type QuotaEnv, type QuotaState } from './quota.ts';

// AI detection endpoint. The browser sends the text it extracted from a file
// and gets back the sensitive substrings; nothing is stored.

export interface Env extends QuotaEnv, BillingEnv {
  ASSETS: Fetcher;
  AI?: Ai;
  DETECT_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  AI_MODEL?: string;
  VISION_MODEL?: string;
  // Set only on preview deployments: lets a request pick the model, for benchmarking.
  MODEL_TRIALS?: string;
}

// Chosen by scripts/bench-models.mjs: found 83 of 84 expected values over two
// runs, against 64 for Llama 3.3 70B and 78 for gpt-oss-120b, and was the fastest.
const DEFAULT_MODEL = '@cf/deepseek-ai/deepseek-v4.1-flash-1017';
// Reasoning models spend their whole token budget thinking unless told not to.
const MODEL_OPTIONS: Record<string, object> = {
  '@cf/deepseek-ai/deepseek-v4.1-flash-1017': { chat_template_kwargs: { thinking: false } },
  '@cf/openai/gpt-oss-120b': { reasoning_effort: 'low' },
};
export const MAX_CHARS = 60_000;
// Smaller chunks make the model list entities more thoroughly.
const CHUNK_CHARS = 3_000;

export const AI_TYPES = ['name', 'address', 'email', 'phone', 'ssn', 'id', 'date', 'org', 'card', 'iban', 'url', 'other'] as const;

const SYSTEM_PROMPT = `You find personally identifiable and sensitive information in documents so it can be redacted.
Return every exact substring of the input that should be redacted, copied character for character, each distinct string once.
Types: name (people's names), ssn (US Social Security numbers and ITINs), address (street addresses, postal codes with city), email, phone, id (passport, licence, tax, account, patient, employee, case or national ID numbers), date (birth dates and other personal dates), org (employers, schools, hospitals tied to a person), card (payment cards), iban (bank accounts), url (personal links), other (anything else sensitive such as health details, signatures, usernames or passwords).
Be thorough with names: include every private person mentioned anywhere (headers, greetings, signatures, tables, lists, quoted emails), in every form that appears, such as "Jane Doe", "Doe, Jane", "J. Doe", "Ms. Doe", "Jane" and "DOE". Names from any language or culture count.
Return the values, never field labels or acronyms such as "Name:", "SSN" or "ITIN". Do not return headings, generic words or well-known public figures mentioned in passing.
For every phone, email, address, url and id, set owner: "organization" when it belongs to a business, institution or public service (letterheads and footers, company switchboards, helplines, generic mailboxes such as info@ or kontakt@, office addresses, company registration and VAT numbers), and "person" when it belongs to a private person, including an employee's direct line or personal mobile. For all other types set owner to "person". If nothing is sensitive return an empty list.`;

const SCHEMA = {
  type: 'object',
  properties: {
    entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          type: { type: 'string', enum: [...AI_TYPES] },
          owner: { type: 'string', enum: ['person', 'organization'] },
        },
        required: ['text', 'type', 'owner'],
      },
    },
  },
  required: ['entities'],
};

export interface Entity {
  text: string;
  type: (typeof AI_TYPES)[number];
  owner?: 'organization';
}

export function chunkText(text: string, size = CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    let end = Math.min(text.length, pos + size);
    if (end < text.length) {
      // Prefer to break at a paragraph, then a line, then a space.
      const slice = text.slice(pos, end);
      const brk = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'), slice.lastIndexOf(' '));
      if (brk > size / 2) end = pos + brk + 1;
    }
    chunks.push(text.slice(pos, end));
    pos = end;
  }
  return chunks;
}

function parseEntities(raw: unknown, source: string): Entity[] {
  let data = raw;
  if (typeof data === 'string') {
    const m = data.match(/\{[\s\S]*\}/);
    if (!m) return [];
    try {
      data = JSON.parse(m[0]);
    } catch {
      return [];
    }
  }
  const list = (data as { entities?: unknown })?.entities;
  if (!Array.isArray(list)) return [];
  const out: Entity[] = [];
  for (const e of list) {
    if (!e || typeof e.text !== 'string') continue;
    const text = e.text.trim();
    // Only keep strings that actually occur, so the model cannot invent content.
    if (!source.includes(text)) continue;
    const type = (AI_TYPES as readonly string[]).includes(e.type) ? e.type : 'other';
    if (!plausibleEntity(text, type)) continue;
    out.push(e.owner === 'organization' ? { text, type, owner: 'organization' } : { text, type });
  }
  return out;
}

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

// Models answer in different shapes: Workers AI `response`, OpenAI-style
// `choices`, or Responses-API `output` (gpt-oss).
export function responseContent(result: unknown): unknown {
  const r = result as {
    response?: unknown;
    choices?: { message?: { content?: unknown } }[];
    output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  };
  if (r?.response !== undefined && r.response !== null) return r.response;
  const choice = r?.choices?.[0]?.message?.content;
  if (choice !== undefined) return choice;
  if (Array.isArray(r?.output)) {
    return r.output
      .filter((o) => o.type === 'message')
      .flatMap((o) => o.content ?? [])
      .map((c) => c.text ?? '')
      .join('');
  }
  return undefined;
}

// Clairic is an extraction model: instead of a prompt it takes typed fields
// and returns list items with their offsets into the text.
const CLAIRIC_FIELDS: Record<Entity['type'], string> = {
  name: 'Every name of a private person, in each form it appears (full name, "Doe, Jane", first name only, surname only, initials with surname). Not businesses, public figures or job titles.',
  address: 'Street addresses and postal addresses of private people, as written.',
  email: 'Email addresses.',
  phone: 'Phone and fax numbers of private people. Not helplines, toll-free or office numbers of businesses and public services.',
  ssn: 'US Social Security numbers and ITINs (the number only).',
  id: 'Passport, licence, tax, account, patient, employee, case, policy, PIN, national ID and other personal identifier numbers (the number only, never the label).',
  date: 'Birth dates and other dates tied to a private person.',
  org: 'Employers, schools and hospitals tied to a private person.',
  card: 'Payment card numbers.',
  iban: 'IBANs and bank account numbers.',
  url: 'Personal links and profile URLs.',
  other: 'Other sensitive values: usernames, passwords, session tokens, API keys, IP addresses, health conditions and medications of a person.',
};

async function detectClairic(env: Env, chunk: string, model: string, usage: Usage, raw?: unknown[]): Promise<Entity[]> {
  const fields = Object.fromEntries(
    Object.entries(CLAIRIC_FIELDS).map(([type, instructions]) => [type, { type: 'list', items: 'text', instructions }]),
  );
  const result = (await env.AI!.run(model as Parameters<Ai['run']>[0], { model: 'clairic', state: chunk, fields } as never)) as {
    answers?: Record<string, { value?: unknown }>;
    usage?: { input_tokens?: number; prompt_tokens?: number };
  };
  raw?.push(result);
  usage.prompt_tokens = (usage.prompt_tokens ?? 0) + (result?.usage?.input_tokens ?? result?.usage?.prompt_tokens ?? 0);
  const entities = Object.entries(result?.answers ?? {}).flatMap(([type, a]) =>
    Array.isArray(a?.value) ? a.value.filter((v) => typeof v === 'string').map((text) => ({ text, type })) : [],
  );
  return parseEntities({ entities }, chunk);
}

// Workers AI caps requests per minute per model (error 3021). Back off and retry
// rather than failing a document because of a short burst.
export async function runWithRetry<T>(call: () => Promise<T>, waits = [1500, 4000]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      if (attempt >= waits.length || !/\b3021\b|rate limit/i.test(String(err))) throw err;
      await new Promise((r) => setTimeout(r, waits[attempt]));
    }
  }
}

async function detectChunk(env: Env, chunk: string, model: string, usage: Usage, raw?: unknown[], extra?: object, waits?: number[]): Promise<Entity[]> {
  if (model.endsWith('/clairic')) return detectClairic(env, chunk, model, usage, raw);
  // Partner models (e.g. openai/…) go through AI Gateway with OpenAI's own
  // parameters: max_completion_tokens, a named strict schema, default temperature.
  const partner = !model.startsWith('@cf/');
  const result = (await runWithRetry(() => env.AI!.run(model as Parameters<Ai['run']>[0], {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: chunk },
    ],
    ...(partner
      ? { response_format: { type: 'json_schema', json_schema: { name: 'entities', schema: SCHEMA } }, max_completion_tokens: 4096 }
      : { response_format: { type: 'json_schema', json_schema: SCHEMA }, max_tokens: 4096, temperature: 0 }),
    ...MODEL_OPTIONS[model],
    ...extra,
  } as never), waits)) as { usage?: Usage };
  raw?.push(result);
  usage.prompt_tokens = (usage.prompt_tokens ?? 0) + (result?.usage?.prompt_tokens ?? 0);
  usage.completion_tokens = (usage.completion_tokens ?? 0) + (result?.usage?.completion_tokens ?? 0);
  return parseEntities(responseContent(result), chunk);
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function detectText(env: Env, text: string, model: string, usage: Usage, raw?: unknown[], options?: object, waits?: number[]): Promise<Entity[]> {
  const results = await Promise.all(chunkText(text).map((c) => detectChunk(env, c, model, usage, raw, options, waits)));
  const seen = new Set<string>();
  return results.flat().filter((e) => {
    const k = `${e.type}\u0000${e.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Preview-only batch mode for benchmarks: many texts in one request, a few at a time.
async function detectBatch(env: Env, texts: unknown[], model: string, options?: object): Promise<Response> {
  const out: unknown[] = new Array(texts.length);
  let next = 0;
  const worker = async () => {
    while (next < texts.length) {
      const i = next++;
      const text = texts[i];
      const usage: Usage = {};
      const started = Date.now();
      try {
        if (typeof text !== 'string' || text.length > MAX_CHARS) throw new Error('invalid text');
        out[i] = { entities: await detectText(env, text, model, usage, undefined, options, [5000, 10000, 20000, 30000]), ms: Date.now() - started, usage };
      } catch (err) {
        out[i] = { error: String(err), usage };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, texts.length) }, worker));
  return json({ model, results: out });
}

/** Charges the free daily allowance, then the account's paid pages. Returns a 402 response when neither covers it. */
export async function chargeUsage(request: Request, env: Env, chars: number): Promise<Response | { state?: QuotaState }> {
  const quota = await chargeQuota(request, env, chars);
  if (!quota.exceeded) return quota;
  const user = await currentUser(request, env);
  const paid = user ? await spendPaidPages(env, user.id, pagesFor(chars)) : false;
  if (paid) return quota;
  return json({ error: "You've used today's free credits.", code: 'quota', signedIn: !!user, quota: quota.state }, 402);
}

export async function handleDetect(request: Request, env: Env): Promise<Response> {
  if (!env.AI) return json({ error: 'AI detection is not configured on this server.' }, 503);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: 'Forbidden' }, 403);

  if (env.DETECT_LIMITER) {
    const key = request.headers.get('cf-connecting-ip') || 'anon';
    const { success } = await env.DETECT_LIMITER.limit({ key });
    if (!success) return json({ error: 'Too many requests. Please wait a minute and try again.' }, 429);
  }

  let text: unknown;
  let texts: unknown;
  let requested: unknown;
  let options: unknown;
  try {
    ({ text, texts, model: requested, options } = (await request.json()) as { text?: unknown; texts?: unknown; model?: unknown; options?: unknown });
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const trials = env.MODEL_TRIALS === '1';
  const trial = trials && typeof requested === 'string' && /^(@cf\/)?[\w.-]+\/[\w.-]+$/.test(requested);
  const model = trial ? (requested as string) : env.AI_MODEL || DEFAULT_MODEL;
  const extra = trials && options && typeof options === 'object' ? options : undefined;
  if (trials && Array.isArray(texts) && texts.length <= 50) return detectBatch(env, texts, model, extra);

  if (typeof text !== 'string' || !text.trim()) return json({ entities: [] });
  if (text.length > MAX_CHARS) return json({ error: `Text is too long for AI mode (max ${MAX_CHARS} characters).` }, 413);

  const quota = await chargeUsage(request, env, text.length);
  if (quota instanceof Response) return quota;

  const usage: Usage = {};
  const raw: unknown[] | undefined = trial ? [] : undefined;
  const started = Date.now();
  try {
    const entities = await detectText(env, text, model, usage, raw, trial ? extra : undefined);
    if (trial) return json({ entities, model, ms: Date.now() - started, usage, raw, quota: quota.state });
    return json({ entities, quota: quota.state });
  } catch (err) {
    console.error('detect failed', err);
    if (trial) return json({ error: String(err), model }, 502);
    return json({ error: 'AI detection is unavailable right now.' }, 502);
  }
}
