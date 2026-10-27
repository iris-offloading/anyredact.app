import type { FaceDetector, ObjectDetector } from '@mediapipe/tasks-vision';
import { postApi } from './ai.ts';
import { scaledCanvas, type Rect } from './types.ts';

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

// Each model loads on first use, so ticking only Faces skips the larger object model.
type Vision = typeof import('@mediapipe/tasks-vision');
let files: Promise<{ vision: Vision; fileset: Awaited<ReturnType<Vision['FilesetResolver']['forVisionTasks']>> }> | null = null;
let faceDetector: Promise<FaceDetector> | null = null;
let objectDetector: Promise<ObjectDetector> | null = null;

function wasm() {
  files ??= import('@mediapipe/tasks-vision').then(async (vision) => ({ vision, fileset: await vision.FilesetResolver.forVisionTasks(__MEDIAPIPE_WASM__) }));
  files.catch(() => (files = null));
  return files;
}

function faces() {
  faceDetector ??= wasm().then(({ vision, fileset }) =>
    vision.FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: '/models/blaze_face_short_range.tflite', delegate: 'CPU' },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.5,
    }),
  );
  faceDetector.catch(() => (faceDetector = null));
  return faceDetector;
}

function objects() {
  objectDetector ??= wasm().then(({ vision, fileset }) =>
    vision.ObjectDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: '/models/efficientdet_lite2.tflite', delegate: 'CPU' },
      runningMode: 'IMAGE',
      scoreThreshold: 0.35,
      categoryAllowlist: Object.keys(OBJECT_KINDS),
    }),
  );
  objectDetector.catch(() => (objectDetector = null));
  return objectDetector;
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

// One scratch canvas for every crop: tiles at a zoom level share a size.
let scratch: HTMLCanvasElement | null = null;

function crop(src: HTMLCanvasElement, r: Rect): HTMLCanvasElement {
  const c = (scratch ??= document.createElement('canvas'));
  const w = Math.round(r.w);
  const h = Math.round(r.h);
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, w, h);
  return c;
}

type Detection = { boundingBox?: { originX: number; originY: number; width: number; height: number }; categories: { score: number; categoryName: string }[] };

/** Runs a detector over every tile and maps its detections, in page coordinates, to hits. */
function scan(canvas: HTMLCanvasElement, levels: number[], detect: (c: HTMLCanvasElement) => Detection[], toHit: (d: Detection, rect: Rect) => VisualHit | null): VisualHit[] {
  const { width, height } = canvas;
  const out: VisualHit[] = [];
  for (const t of tiles(width, height, levels)) {
    const part = t.w === width && t.h === height ? canvas : crop(canvas, t);
    for (const d of detect(part)) {
      const b = d.boundingBox;
      if (!b) continue;
      const hit = toHit(d, { x: t.x + b.originX, y: t.y + b.originY, w: b.width, h: b.height });
      if (hit) out.push(hit);
    }
  }
  return out;
}

/** Finds faces, screens and stop signs on a page bitmap, without uploading it. */
export async function detectVisual(canvas: HTMLCanvasElement, kinds: Set<VisualKind>): Promise<VisualHit[]> {
  if (!kinds.size) return [];
  const wantObjects = kinds.has('screen') || kinds.has('sign');
  const [face, objectModel] = await Promise.all([kinds.has('face') ? faces() : null, wantObjects ? objects() : null]);
  const { width, height } = canvas;
  const hits: VisualHit[] = [];
  if (face) {
    hits.push(
      // The model's box covers eyes to chin; grow it to take in hair and ears.
      ...scan(canvas, [1, 2, 4], (c) => face.detect(c).detections, (d, rect) => ({ kind: 'face', rect: pad(rect, 0.3, width, height), score: d.categories[0]?.score ?? 0 })),
    );
  }
  if (objectModel) {
    hits.push(
      ...scan(canvas, [1, 2], (c) => objectModel.detect(c).detections, (d, rect) => {
        const kind = OBJECT_KINDS[d.categories[0]?.categoryName ?? ''];
        return kind && kinds.has(kind) ? { kind, rect: pad(rect, 0.05, width, height), score: d.categories[0].score } : null;
      }),
    );
  }
  return mergeHits(hits);
}

const AI_MAX_SIDE = 1280;

/** Asks the server's vision model for the same regions, plus number plates and other signs. */
export async function detectVisualAi(canvas: HTMLCanvasElement, kinds: Set<VisualKind>): Promise<VisualHit[]> {
  if (!kinds.size) return [];
  const small = scaledCanvas(canvas, AI_MAX_SIDE);
  const data = await postApi<{ regions?: { kind: VisualKind; box: number[] }[] }>(
    '/api/vision',
    { image: small.toDataURL('image/jpeg', 0.85), kinds: [...kinds] },
    'Picture detection failed',
  );
  const { width, height } = canvas;
  return (data.regions ?? []).map(({ kind, box: [x0, y0, x1, y1] }) => ({
    kind,
    // Model boxes are a little loose or tight at random; a small margin errs on the side of covering.
    rect: pad({ x: (x0 / 1000) * width, y: (y0 / 1000) * height, w: ((x1 - x0) / 1000) * width, h: ((y1 - y0) / 1000) * height }, 0.1, width, height),
    score: 0.9,
  }));
}
