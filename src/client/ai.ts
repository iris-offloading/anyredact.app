import type { EntityType } from '../shared/detect.ts';

export interface AiEntity {
  text: string;
  type: EntityType;
}

/** Sends extracted text (never the file) to the Worker for model-based detection. */
export async function detectWithAi(text: string): Promise<AiEntity[]> {
  const res = await fetch('/api/detect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const data = (await res.json().catch(() => ({}))) as { entities?: AiEntity[]; error?: string };
  if (!res.ok) throw new Error(data.error || `AI detection failed (${res.status})`);
  return data.entities ?? [];
}
