import type { EntityType } from '../shared/detect.ts';
import { MAX_CHARS, PAGE_CHARS } from '../shared/pricing.ts';

export interface AiEntity {
  text: string;
  type: EntityType;
  owner?: 'person' | 'organization';
}

/** Random per-browser ID for the free daily allowance. It identifies nothing about the person. */
export function deviceId(): string {
  try {
    let id = localStorage.getItem('device-id');
    if (!id) localStorage.setItem('device-id', (id = crypto.randomUUID()));
    return id;
  } catch {
    return 'no-storage';
  }
}

/** POSTs to a metered API route, as JSON unless another content type is given; a 402 becomes a QuotaError. */
export async function postApi<T>(path: string, body: unknown, failure: string, contentType = 'application/json'): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': contentType, 'x-device-id': deviceId() },
    body: contentType === 'application/json' ? JSON.stringify(body) : (body as BodyInit),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 402) throw new QuotaError(data.error || "You've used today's free credits.");
  if (!res.ok) throw new Error(data.error || `${failure} (${res.status}).`);
  return data;
}

export class QuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaError';
  }
}

/** Today's free allowance in pages (3,000 characters), or null when the server doesn't track one. */
export async function freePagesLeft(): Promise<number | null> {
  try {
    const res = await fetch('/api/quota', { headers: { 'x-device-id': deviceId() } });
    const { quota } = (await res.json()) as { quota?: { used: number; limit: number } | null };
    return quota ? Math.max(0, Math.floor((quota.limit - quota.used) / PAGE_CHARS)) : null;
  } catch {
    return null;
  }
}

// Stays under the Worker's per-request limit.
const BATCH_CHARS = MAX_CHARS - 10_000;

function batches(text: string): string[] {
  const out: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    let end = Math.min(text.length, pos + BATCH_CHARS);
    if (end < text.length) {
      const brk = text.lastIndexOf('\n', end);
      if (brk > pos + BATCH_CHARS / 2) end = brk + 1;
    }
    out.push(text.slice(pos, end));
    pos = end;
  }
  return out;
}

async function detectBatch(text: string): Promise<AiEntity[]> {
  const data = await postApi<{ entities?: AiEntity[] }>('/api/detect', { text }, 'AI detection failed');
  return data.entities ?? [];
}

/** Sends extracted text (never the file) to the Worker for model-based detection. */
export async function detectWithAi(text: string): Promise<AiEntity[]> {
  const out: AiEntity[] = [];
  // Sequential, so a long document doesn't trip the per-IP rate limit in one burst.
  for (const batch of batches(text)) out.push(...(await detectBatch(batch)));
  return out;
}
