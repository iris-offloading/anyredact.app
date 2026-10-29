// Which way up a scanned page or photo is, asked of a multimodal decision model.
// Tesseract only reads upright text, so a turned page is read after turning it.
import { runWithRetry, type Env } from './detect.ts';
import { json, readAiPost, trialsAllowed } from './http.ts';

export const ORIENT_MODEL = '@cf/cloudflare/clef-omni';

/** Clockwise quarter turns that make the text upright. */
const TURNS = {
  up: 'The text already reads normally, left to right with tops of letters at the top.',
  left: 'The text runs from bottom to top: the page lies on its side and needs a quarter turn clockwise.',
  down: 'The text is upside down and needs a half turn.',
  right: 'The text runs from top to bottom: the page lies on its side and needs a quarter turn anticlockwise.',
} as const;
const QUARTERS: Record<keyof typeof TURNS, number> = { up: 0, left: 1, down: 2, right: 3 };

const MAX_IMAGE_CHARS = 4 * 1024 * 1024;

export async function handleOrient(request: Request, env: Env): Promise<Response> {
  const body = await readAiPost(request, env, 'Page turning is not configured on this server.');
  if (body instanceof Response) return body;
  const { image } = body;
  if (typeof image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(image)) return json({ error: 'Expected an image data URL.' }, 400);
  if (image.length > MAX_IMAGE_CHARS) return json({ error: 'Image is too large.' }, 413);
  try {
    const result = (await runWithRetry(() =>
      env.AI!.run(ORIENT_MODEL as never, {
        model: 'clef-omni',
        images: [image],
        state: 'A scanned page or photo, which may be turned.',
        questions: {
          turn: { type: 'choice', instructions: 'Which way does the text in the image run?', criteria: TURNS },
          upside_down: { type: 'noul', instructions: 'Is the text in the image upside down, so letters appear rotated 180 degrees?' },
          sideways: { type: 'noul', instructions: 'Are the lines of text in the image vertical rather than horizontal?' },
          clockwise: { type: 'noul', instructions: 'Would turning the image a quarter turn clockwise make its text read normally?' },
        },
      } as never),
    )) as { answers?: Record<string, unknown> & { turn?: { choice?: string; option?: string; answer?: string; probabilities?: Record<string, number> } } };
    const a = result?.answers?.turn;
    const probs = a?.probabilities ?? {};
    const pick = (a?.choice ?? a?.option ?? a?.answer ?? Object.entries(probs).sort((x, y) => y[1] - x[1])[0]?.[0]) as keyof typeof TURNS | undefined;
    const quarters = pick && pick in QUARTERS ? QUARTERS[pick] : 0;
    return json({ quarters, p: probs[pick ?? ''] ?? null, ...(trialsAllowed(request, env) ? { raw: result } : {}), answer: a ?? null, answers: result?.answers ?? null });
  } catch (err) {
    console.error('orient failed', err);
    return json({ error: 'Page turning is unavailable right now.' }, 502);
  }
}
