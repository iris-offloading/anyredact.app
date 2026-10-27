// Picture regions (faces, screens, road signs, number plates) found by a
// vision model. The browser also runs a local detector; this pass catches the
// small, turned and partly hidden faces it misses. Only used when the visitor
// turned picture redaction on and agreed to send the file.
import { CREDIT_CHARS } from '../shared/pricing.ts';
import { chargeUsage, responseContent, runWithRetry, type Env } from './detect.ts';
import { json, modelJson, readAiPost } from './http.ts';

// Chosen on sample photos: found small and turned faces that Gemma 4 and
// Llama 4 Scout missed, and is not limited to 20 requests a minute like the
// models that need the Workers Paid plan.
export const VISION_MODEL = '@cf/qwen/qwen3.8-27b';
const VISION_OPTIONS = { chat_template_kwargs: { enable_thinking: false } };

export const VISION_KINDS = {
  face: 'faces, including small, turned or partly hidden ones',
  screen: 'screens: monitors, TVs, laptops, tablets and phones',
  sign: 'road and street signs, and house numbers',
  plate: 'vehicle number plates',
} as const;
export type VisionKind = keyof typeof VISION_KINDS;

export interface Region {
  kind: VisionKind;
  /** x0, y0, x1, y1 as thousandths of the image width and height. */
  box: [number, number, number, number];
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export function visionPrompt(kinds: VisionKind[]): string {
  return `Find every one of these in the picture:
${kinds.map((k) => `- ${k}: ${VISION_KINDS[k]}`).join('\n')}
Return JSON only: {"items":[{"kind":"${kinds.join('|')}","box":[x0,y0,x1,y1]}]}, with box coordinates as thousandths (0-1000) of the image width and height. Return {"items":[]} if there are none.`;
}

/** Validates the model's items; boxes given as 0-1 fractions are scaled up. */
export function parseRegions(content: unknown, kinds: VisionKind[]): Region[] {
  const items = (modelJson(content) as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  const out: Region[] = [];
  for (const it of items as { kind?: unknown; box?: unknown }[]) {
    const kind = it?.kind as VisionKind;
    const box = it?.box;
    if (!kinds.includes(kind) || !Array.isArray(box) || box.length !== 4 || !box.every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
    const scale = Math.max(...box) <= 1 ? 1000 : 1;
    const [x0, y0, x1, y1] = box.map((n) => Math.min(1000, Math.max(0, n * scale)));
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    out.push({ kind, box: [x0, y0, x1, y1] });
  }
  return out;
}

export async function handleVision(request: Request, env: Env): Promise<Response> {
  const body = await readAiPost(request, env, 'AI detection is not configured on this server.');
  if (body instanceof Response) return body;
  const { image, kinds: requested } = body;
  const kinds = (Array.isArray(requested) ? requested : []).filter((k): k is VisionKind => typeof k === 'string' && k in VISION_KINDS);
  if (!kinds.length) return json({ regions: [] });
  if (typeof image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(image)) return json({ error: 'Expected an image data URL.' }, 400);
  if (image.length > (MAX_IMAGE_BYTES * 4) / 3) return json({ error: 'Image is too large.' }, 413);

  // One picture counts as one page.
  const quota = await chargeUsage(request, env, CREDIT_CHARS);
  if (quota instanceof Response) return quota;

  try {
    const result = await runWithRetry(() =>
      env.AI!.run((env.VISION_MODEL || VISION_MODEL) as never, {
        messages: [{ role: 'user', content: [{ type: 'text', text: visionPrompt(kinds) }, { type: 'image_url', image_url: { url: image } }] }],
        max_tokens: 2000,
        temperature: 0,
        response_format: { type: 'json_object' },
        ...VISION_OPTIONS,
      } as never),
    );
    return json({ regions: parseRegions(responseContent(result), kinds), quota: quota.state });
  } catch (err) {
    console.error('vision failed', err);
    await quota.refund();
    return json({ error: 'Picture detection is unavailable right now.' }, 502);
  }
}
