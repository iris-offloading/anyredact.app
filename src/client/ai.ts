import { chunkText, type EntityType } from '../shared/detect.ts';
import { MAX_CHARS, FREE_CREDITS } from '../shared/pricing.ts';

export interface AiEntity {
  text: string;
  type: EntityType;
  owner?: 'person' | 'organization';
}

let pageId: string | undefined;

/** Random per-browser ID for the free daily allowance. It identifies nothing about the person. */
export function deviceId(): string {
  try {
    let id = localStorage.getItem('device-id');
    if (!id) localStorage.setItem('device-id', (id = crypto.randomUUID()));
    return id;
  } catch {
    // Without storage, one ID for this page, so such browsers don't all share one allowance.
    return (pageId ??= crypto.randomUUID());
  }
}

// The open file, so a signed-in account's activity shows one row per file with its format.
let job: { id: string; format: string } | undefined;

/** Starts a new activity row for a file of this format (pdf, docx, audio and so on). */
export function startJob(format: string) {
  job = { id: crypto.randomUUID(), format };
}

// Cloudflare Turnstile: a signed-out browser's first request of the day needs a token. The page runs the
// check next to its Upload button and hands the token over here, or asks again when the server wants one.
let presetToken: (() => Promise<string>) | undefined;
let askHuman: ((siteKey: string) => Promise<string>) | undefined;
// The request carrying a token, so requests sent at the same time wait for its pass instead of each asking.
let checking: Promise<unknown> | undefined;

/** Sends `token()` with the next metered request. */
export function useHumanToken(token: () => Promise<string>) {
  presetToken = token;
}

/** How the page gets a token when the server asks for one it didn't expect. */
export function onHumanCheck(ask: (siteKey: string) => Promise<string>) {
  askHuman = ask;
}

/** POSTs to a metered API route, as JSON unless another content type is given; a 402 becomes a QuotaError. */
export async function postApi<T>(path: string, body: unknown, failure: string, contentType = 'application/json'): Promise<T> {
  const send = async (turnstile?: string) => {
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'content-type': contentType,
        'x-device-id': deviceId(),
        ...(job ? { 'x-job': job.id, 'x-format': job.format } : {}),
        ...(turnstile ? { 'x-turnstile': turnstile } : {}),
      },
      body: contentType === 'application/json' ? JSON.stringify(body) : (body as BodyInit),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string; siteKey?: string };
    return { res, data, human: res.status === 403 && data.code === 'turnstile' && !!data.siteKey };
  };
  const withToken = async (token: Promise<string>) => {
    const sent = token.then(send);
    checking = sent;
    try {
      return await sent;
    } finally {
      if (checking === sent) checking = undefined;
    }
  };
  const preset = presetToken;
  presetToken = undefined;
  let { res, data, human } = preset ? await withToken(preset()) : await send();
  if (human && checking) {
    await checking.catch(() => {});
    ({ res, data, human } = await send());
  }
  if (human) {
    if (!askHuman) throw new Error(data.error);
    ({ res, data } = await withToken(askHuman(data.siteKey!)));
  }
  if (res.status === 402) throw new QuotaError(data.error || "You've used today's free credits.", data.code === 'negative');
  if (!res.ok) throw new Error(data.error || `${failure} (${res.status}).`);
  return data;
}

export class QuotaError extends Error {
  /** The paid balance is below zero, so waiting for tomorrow's free credits won't help. */
  negative: boolean;

  constructor(message: string, negative = false) {
    super(message);
    this.negative = negative;
    this.name = 'QuotaError';
  }
}

/** Today's free credits left, or null when the server doesn't track one. */
export async function freeCreditsLeft(): Promise<number | null> {
  return (await freeCredits()).left;
}

/** The free credits left, plus the Turnstile site key while this browser still needs a pass today. */
export async function freeCredits(): Promise<{ left: number | null; turnstile?: string }> {
  try {
    const res = await fetch('/api/quota', { headers: { 'x-device-id': deviceId() } });
    const { quota, turnstile } = (await res.json()) as { quota?: { used: number; limit: number } | null; turnstile?: string };
    const left = quota ? Math.max(0, quota.limit - quota.used) : null;
    try {
      localStorage.setItem(FREE_KEY, JSON.stringify({ day: utcDay(), left }));
    } catch {}
    return { left, turnstile };
  } catch {
    return { left: null };
  }
}

const FREE_KEY = 'anyredact-free';
const utcDay = () => new Date().toISOString().slice(0, 10);

/** The free credits this browser last saw, shown until the live count arrives. They refill at midnight UTC. */
export function lastFreeCredits(): number | null {
  try {
    const saved = JSON.parse(localStorage.getItem(FREE_KEY) || 'null') as { day: string; left: number | null } | null;
    return saved && (saved.day === utcDay() || saved.left === null) ? saved.left : FREE_CREDITS;
  } catch {
    return FREE_CREDITS;
  }
}

// Stays under the Worker's per-request limit.
const BATCH_CHARS = MAX_CHARS - 10_000;

/**
 * Sends extracted text (never the file) to the Worker for model-based detection. The token pays for the scan's
 * free final check; each one covers about twice its batch, so the longest batch's token is kept.
 */
export async function detectWithAi(text: string): Promise<{ entities: AiEntity[]; checkToken?: string }> {
  const entities: AiEntity[] = [];
  let checkToken: string | undefined;
  let longest = 0;
  // Sequential, so a long document doesn't trip the per-IP rate limit in one burst.
  for (const batch of chunkText(text, BATCH_CHARS)) {
    const data = await postApi<{ entities?: AiEntity[]; checkToken?: string }>('/api/detect', { text: batch }, 'AI detection failed');
    entities.push(...(data.entities ?? []));
    if (data.checkToken && batch.length > longest) [checkToken, longest] = [data.checkToken, batch.length];
  }
  return { entities, checkToken };
}
