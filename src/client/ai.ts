import type { EntityType } from '../shared/detect.ts';

export interface AiEntity {
  text: string;
  type: EntityType;
}

// Stays under the Worker's per-request limit (MAX_CHARS in src/worker/detect.ts).
const BATCH_CHARS = 50_000;

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
  const res = await fetch('/api/detect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const data = (await res.json().catch(() => ({}))) as { entities?: AiEntity[]; error?: string };
  if (!res.ok) throw new Error(data.error || `AI detection failed (${res.status}).`);
  return data.entities ?? [];
}

/** Sends extracted text (never the file) to the Worker for model-based detection. */
export async function detectWithAi(text: string): Promise<AiEntity[]> {
  const out: AiEntity[] = [];
  // Sequential, so a long document doesn't trip the per-IP rate limit in one burst.
  for (const batch of batches(text)) out.push(...(await detectBatch(batch)));
  return out;
}
