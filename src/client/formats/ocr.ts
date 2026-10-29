import type { Progress, Rect, Unit } from '../types.ts';

type TesseractWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;
let workerPromise: Promise<TesseractWorker> | null = null;
let report: Progress = () => {};

function getWorker(): Promise<TesseractWorker> {
  workerPromise ??= import('tesseract.js').then((mod) =>
    // tesseract.js is CommonJS, so the bundle may expose it under `default`.
    (mod.createWorker ?? (mod as unknown as { default: typeof mod }).default.createWorker)('eng', 1, {
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text') report(`Reading text… ${Math.round(m.progress * 100)}%`);
        else if (m.status.startsWith('loading')) report('Loading the text recognizer (first time only)…');
      },
    }),
  );
  workerPromise.catch(() => (workerPromise = null));
  return workerPromise;
}

// Orientation detection needs Tesseract's legacy engine and its own model, so it gets a
// worker of its own, loaded only when a page reads badly.
let osdPromise: Promise<TesseractWorker> | null = null;

function getOsd(): Promise<TesseractWorker> {
  osdPromise ??= import('tesseract.js').then((mod) =>
    (mod.createWorker ?? (mod as unknown as { default: typeof mod }).default.createWorker)('osd', 0, {
      legacyCore: true,
      legacyLang: true,
      logger: (m: { status: string }) => m.status.startsWith('loading') && report('Loading the page turn check (first time only)…'),
    }),
  );
  osdPromise.catch(() => (osdPromise = null));
  return osdPromise;
}

interface WordBox {
  start: number;
  end: number;
  line: number;
  box: Rect;
}

type Page = Awaited<ReturnType<TesseractWorker['recognize']>>['data'];

/** Characters in words Tesseract is sure of; text read the wrong way up scores near zero. */
function score(data: Page): number {
  let n = 0;
  for (const line of data.lines ?? []) for (const w of line.words) if (w.confidence >= 70 && /[\p{L}\p{N}]{2}/u.test(w.text)) n += w.text.length;
  return n;
}

/** Draws the canvas turned clockwise by quarter turns. */
export function turned(canvas: HTMLCanvasElement, quarters: number): HTMLCanvasElement {
  if (!quarters) return canvas;
  const { width: w, height: h } = canvas;
  const out = document.createElement('canvas');
  [out.width, out.height] = quarters % 2 ? [h, w] : [w, h];
  const ctx = out.getContext('2d')!;
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((quarters * Math.PI) / 2);
  ctx.drawImage(canvas, -w / 2, -h / 2);
  return out;
}

/** Maps a box on the canvas turned by `quarters` back onto the original W x H canvas. */
export function unturn(r: Rect, quarters: number, W: number, H: number): Rect {
  switch (quarters) {
    case 1:
      return { x: r.y, y: H - r.x - r.w, w: r.h, h: r.w };
    case 2:
      return { x: W - r.x - r.w, y: H - r.y - r.h, w: r.w, h: r.h };
    case 3:
      return { x: W - r.y - r.h, y: r.x, w: r.h, h: r.w };
    default:
      return r;
  }
}

/** Clockwise quarter turns that make the page upright, from Tesseract's orientation detection. */
async function uprightTurn(canvas: HTMLCanvasElement): Promise<number> {
  const { data } = await (await getOsd()).detect(canvas);
  if (data.orientation_degrees == null || (data.orientation_confidence ?? 0) < 1) return 0;
  return ((data.orientation_degrees / 90) % 4 + 4) % 4;
}

/**
 * Reads the canvas the way up its text runs. Tesseract only reads upright text, so when the
 * first pass finds little it asks Tesseract's orientation detection which way up the page is,
 * and reads it again turned upright.
 */
async function readUpright(worker: TesseractWorker, canvas: HTMLCanvasElement): Promise<{ data: Page; quarters: number }> {
  const { data } = await worker.recognize(canvas);
  const first = score(data);
  const words = (data.lines ?? []).reduce((n, l) => n + l.words.length, 0);
  if (first >= 40 && first >= words * 2) return { data, quarters: 0 };
  report('Checking which way up the page is…');
  const quarters = await uprightTurn(canvas).catch((err) => (console.error(err), 0));
  if (!quarters) return { data, quarters: 0 };
  const again = (await worker.recognize(turned(canvas, quarters))).data;
  return score(again) > first ? { data: again, quarters } : { data, quarters: 0 };
}

/**
 * Runs OCR on a bitmap and returns a text unit whose ranges map to word boxes, with the
 * clockwise quarter turns that made it upright. The boxes sit on the canvas turned that way.
 */
export async function readText(id: string, page: number, canvas: HTMLCanvasElement, progress: Progress): Promise<{ unit: Unit; quarters: number }> {
  report = progress;
  const worker = await getWorker();
  const { data, quarters } = await readUpright(worker, canvas);
  let text = '';
  const words: WordBox[] = [];
  (data.lines ?? []).forEach((line, li) => {
    for (const w of line.words) {
      const start = text.length;
      text += w.text;
      const { x0, y0, x1, y1 } = w.bbox;
      words.push({ start, end: text.length, line: li, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } });
      text += ' ';
    }
    text = text.trimEnd() + '\n';
  });
  const unit: Unit = {
    id,
    page,
    text,
    rectsFor(start, end) {
      const hit = words.filter((w) => w.start < end && w.end > start);
      const byLine = new Map<number, Rect>();
      for (const w of hit) {
        const r = byLine.get(w.line);
        if (!r) {
          byLine.set(w.line, { ...w.box });
          continue;
        }
        const x = Math.min(r.x, w.box.x);
        const y = Math.min(r.y, w.box.y);
        r.w = Math.max(r.x + r.w, w.box.x + w.box.w) - x;
        r.h = Math.max(r.y + r.h, w.box.y + w.box.h) - y;
        r.x = x;
        r.y = y;
      }
      return [...byLine.values()].map((r) => pad(r, Math.max(2, r.h * 0.12)));
    },
  };
  return { unit, quarters };
}

/** OCR whose boxes sit on the canvas as given, for pictures that stay as they are in their file. */
export async function ocrUnit(id: string, page: number, canvas: HTMLCanvasElement, progress: Progress): Promise<Unit> {
  const { unit, quarters } = await readText(id, page, canvas, progress);
  if (!quarters) return unit;
  return { ...unit, rectsFor: (start, end) => unit.rectsFor!(start, end).map((r) => unturn(r, quarters, canvas.width, canvas.height)) };
}

export function pad(r: Rect, p: number): Rect {
  return { x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p };
}
