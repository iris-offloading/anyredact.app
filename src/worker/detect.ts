import { plausibleEntity } from '../shared/detect.ts';

// AI detection endpoint. The browser sends the text it extracted from a file
// and gets back the sensitive substrings; nothing is stored.

export interface Env {
  ASSETS: Fetcher;
  AI?: Ai;
  DETECT_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  AI_MODEL?: string;
  // Set only on preview deployments: lets a request pick the model, for benchmarking.
  MODEL_TRIALS?: string;
}

const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const MAX_CHARS = 60_000;
// Smaller chunks make the model list entities more thoroughly.
const CHUNK_CHARS = 3_000;

export const AI_TYPES = ['name', 'address', 'email', 'phone', 'ssn', 'id', 'date', 'org', 'card', 'iban', 'url', 'other'] as const;

const SYSTEM_PROMPT = `You find personally identifiable and sensitive information in documents so it can be redacted.
Return every exact substring of the input that should be redacted, copied character for character, each distinct string once.
Types: name (people's names), ssn (US Social Security numbers and ITINs), address (street addresses, postal codes with city), email, phone, id (passport, licence, tax, account, patient, employee, case or national ID numbers), date (birth dates and other personal dates), org (employers, schools, hospitals tied to a person), card (payment cards), iban (bank accounts), url (personal links), other (anything else sensitive such as health details, signatures, usernames or passwords).
Be thorough with names: include every private person mentioned anywhere (headers, greetings, signatures, tables, lists, quoted emails), in every form that appears, such as "Jane Doe", "Doe, Jane", "J. Doe", "Ms. Doe", "Jane" and "DOE". Names from any language or culture count.
Return the values, never field labels or acronyms such as "Name:", "SSN" or "ITIN". Do not return headings, generic words, well-known public figures mentioned in passing, or the contact details of businesses and public services (helplines, office numbers and addresses). If nothing is sensitive return an empty list.`;

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
        },
        required: ['text', 'type'],
      },
    },
  },
  required: ['entities'],
};

export interface Entity {
  text: string;
  type: (typeof AI_TYPES)[number];
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
    out.push({ text, type });
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

async function detectChunk(env: Env, chunk: string, model: string, usage: Usage): Promise<Entity[]> {
  const result = (await env.AI!.run(model as Parameters<Ai['run']>[0], {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: chunk },
    ],
    response_format: { type: 'json_schema', json_schema: SCHEMA },
    max_tokens: 4096,
    temperature: 0,
  } as never)) as { usage?: Usage };
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
  let requested: unknown;
  try {
    ({ text, model: requested } = (await request.json()) as { text?: unknown; model?: unknown });
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (typeof text !== 'string' || !text.trim()) return json({ entities: [] });
  if (text.length > MAX_CHARS) return json({ error: `Text is too long for AI mode (max ${MAX_CHARS} characters).` }, 413);

  const trial = env.MODEL_TRIALS === '1' && typeof requested === 'string' && requested.startsWith('@cf/');
  const model = trial ? (requested as string) : env.AI_MODEL || DEFAULT_MODEL;
  const usage: Usage = {};
  const started = Date.now();
  try {
    const results = await Promise.all(chunkText(text).map((c) => detectChunk(env, c, model, usage)));
    const seen = new Set<string>();
    const entities = results.flat().filter((e) => {
      const k = `${e.type}\u0000${e.text}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (trial) return json({ entities, model, ms: Date.now() - started, usage });
    return json({ entities });
  } catch (err) {
    console.error('detect failed', err);
    if (trial) return json({ error: String(err), model }, 502);
    return json({ error: 'AI detection is unavailable right now.' }, 502);
  }
}
