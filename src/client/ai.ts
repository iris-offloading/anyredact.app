import { chunkText, type EntityType } from '../shared/detect.ts';
import { MAX_CHARS, CREDIT_CHARS } from '../shared/pricing.ts';

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

/** POSTs to a metered API route, as JSON unless another content type is given; a 402 becomes a QuotaError. */
export async function postApi<T>(path: string, body: unknown, failure: string, contentType = 'application/json'): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': contentType, 'x-device-id': deviceId() },
    body: contentType === 'application/json' ? JSON.stringify(body) : (body as BodyInit),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
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

/** Today's free credits left (3,000 characters each), or null when the server doesn't track one. */
export async function freeCreditsLeft(): Promise<number | null> {
  try {
    const res = await fetch('/api/quota', { headers: { 'x-device-id': deviceId() } });
    const { quota } = (await res.json()) as { quota?: { used: number; limit: number } | null };
    return quota ? Math.max(0, Math.floor((quota.limit - quota.used) / CREDIT_CHARS)) : null;
  } catch {
    return null;
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
