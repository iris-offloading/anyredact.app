import type { FaceDetector, ObjectDetector } from '@mediapipe/tasks-vision';
import { deviceId, QuotaError } from './ai.ts';
import type { Rect } from './types.ts';

// Optional picture redaction: faces, screens, road signs and number plates.
// A local MediaPipe pass runs in the browser and uploads nothing (models from
// /models, runtime from the CDN). When the visitor agreed to send the file, a
// vision model on the server adds what the local pass misses.
// The two .tflite files in static/models are Google's MediaPipe models
// (Apache-2.0), from storage.googleapis.com/mediapipe-models.

declare const __MEDIAPIPE_WASM__: string;

export type VisualKind = 'face' | 'screen' | 'sign' | 'plate';

export const VISUAL_LABELS: Record<VisualKind, string> = {
  face: 'Faces',
  screen: 'Screens',
  sign: 'Road signs',
  plate: 'Number plates',
};

export interface VisualHit {
  kind: VisualKind;
  rect: Rect;
  score: number;
}

// COCO categories the object model knows that fall under each option.
const OBJECT_KINDS: Record<string, VisualKind> = {
  tv: 'screen',
  laptop: 'screen',
  'cell phone': 'screen',
  'stop sign': 'sign',
};

let detectors: Promise<{ face: FaceDetector; objects: ObjectDetector }> | null = null;

function load() {
  detectors ??= import('@mediapipe/tasks-vision').then(async ({ FilesetResolver, FaceDetector, ObjectDetector }) => {
    const files = await FilesetResolver.forVisionTasks(__MEDIAPIPE_WASM__);
    const [face, objects] = await Promise.all([
      FaceDetector.createFromOptions(files, {
        baseOptions: { modelAssetPath: '/models/blaze_face_short_range.tflite', delegate: 'CPU' },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.5,
      }),
      ObjectDetector.createFromOptions(files, {
        baseOptions: { modelAssetPath: '/models/efficientdet_lite2.tflite', delegate: 'CPU' },
        runningMode: 'IMAGE',
        scoreThreshold: 0.35,
        categoryAllowlist: Object.keys(OBJECT_KINDS),
      }),
    ]);
    return { face, objects };
  });
  detectors.catch(() => (detectors = null));
  return detectors;
}

/** Square-ish crops at several zoom levels, so small faces fill enough of the model's input. */
export function tiles(width: number, height: number, levels = [1, 2, 4]): Rect[] {
  const out: Rect[] = [];
  for (const n of levels) {
    const side = Math.max(width, height) / n;
    if (n > 1 && side < 160) break;
    const step = side * 0.75;
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const w = Math.min(side, width - x);
        const h = Math.min(side, height - y);
        if (n === 1 || (w > side / 3 && h > side / 3)) out.push({ x, y, w, h });
        if (x + side >= width) break;
      }
      if (y + side >= height) break;
    }
  }
  return out;
}

const area = (r: Rect) => r.w * r.h;

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? (w * h) / Math.min(area(a), area(b)) : 0;
}

/** Keeps the best of overlapping hits of the same kind. */
export function mergeHits(hits: VisualHit[]): VisualHit[] {
  const kept: VisualHit[] = [];
  for (const hit of [...hits].sort((a, b) => b.score - a.score)) {
    if (!kept.some((k) => k.kind === hit.kind && overlap(k.rect, hit.rect) > 0.5)) kept.push(hit);
  }
  return kept;
}

/** Grows a box by a share of its size, clamped to the image. */
export function pad(r: Rect, share: number, width: number, height: number): Rect {
  const x = Math.max(0, r.x - r.w * share);
  const y = Math.max(0, r.y - r.h * share);
  return { x, y, w: Math.min(width, r.x + r.w * (1 + share)) - x, h: Math.min(height, r.y + r.h * (1 + share)) - y };
}

function crop(src: HTMLCanvasElement, r: Rect): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(r.w);
  c.height = Math.round(r.h);
  c.getContext('2d')!.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  return c;
}

/** Finds faces, screens and stop signs on a page bitmap, without uploading it. */
export async function detectVisual(canvas: HTMLCanvasElement, kinds: Set<VisualKind>): Promise<VisualHit[]> {
  if (!kinds.size) return [];
  const { face, objects } = await load();
  const { width, height } = canvas;
  const hits: VisualHit[] = [];
  if (kinds.has('face')) {
    for (const t of tiles(width, height)) {
      const part = t.x === 0 && t.y === 0 && t.w === width && t.h === height ? canvas : crop(canvas, t);
      for (const d of face.detect(part).detections) {
        const b = d.boundingBox;
        if (!b) continue;
        const rect = { x: t.x + b.originX, y: t.y + b.originY, w: b.width, h: b.height };
        // The model's box covers eyes to chin; grow it to take in hair and ears.
        hits.push({ kind: 'face', rect: pad(rect, 0.3, width, height), score: d.categories[0]?.score ?? 0 });
      }
    }
  }
  if (kinds.has('screen') || kinds.has('sign')) {
    for (const t of tiles(width, height, [1, 2])) {
      const part = t.w === width && t.h === height ? canvas : crop(canvas, t);
      for (const d of objects.detect(part).detections) {
        const kind = OBJECT_KINDS[d.categories[0]?.categoryName ?? ''];
        const b = d.boundingBox;
        if (!kind || !b || !kinds.has(kind)) continue;
        const rect = { x: t.x + b.originX, y: t.y + b.originY, w: b.width, h: b.height };
        hits.push({ kind, rect: pad(rect, 0.05, width, height), score: d.categories[0].score });
      }
    }
  }
  return mergeHits(hits);
}

const AI_MAX_SIDE = 1280;

/** Asks the server's vision model for the same regions, plus number plates and other signs. */
export async function detectVisualAi(canvas: HTMLCanvasElement, kinds: Set<VisualKind>): Promise<VisualHit[]> {
  if (!kinds.size) return [];
  const scale = Math.min(1, AI_MAX_SIDE / Math.max(canvas.width, canvas.height));
  const small = document.createElement('canvas');
  small.width = Math.round(canvas.width * scale);
  small.height = Math.round(canvas.height * scale);
  small.getContext('2d')!.drawImage(canvas, 0, 0, small.width, small.height);
  const res = await fetch('/api/vision', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-id': deviceId() },
    body: JSON.stringify({ image: small.toDataURL('image/jpeg', 0.85), kinds: [...kinds] }),
  });
  const data = (await res.json().catch(() => ({}))) as { regions?: { kind: VisualKind; box: number[] }[]; error?: string };
  if (res.status === 402) throw new QuotaError(data.error || "You've used today's free AI allowance.");
  if (!res.ok) throw new Error(data.error || `Picture detection failed (${res.status}).`);
  const { width, height } = canvas;
  return (data.regions ?? []).map(({ kind, box: [x0, y0, x1, y1] }) => ({
    kind,
    // Model boxes are a little loose or tight at random; a small margin errs on the side of covering.
    rect: pad({ x: (x0 / 1000) * width, y: (y0 / 1000) * height, w: ((x1 - x0) / 1000) * width, h: ((y1 - y0) / 1000) * height }, 0.1, width, height),
    score: 0.9,
  }));
}
