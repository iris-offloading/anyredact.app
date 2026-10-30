import type { Progress, Rect, Unit } from '../types.ts';

type TesseractWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;
let workerPromise: Promise<TesseractWorker> | null = null;
let report: Progress = () => {};
let checking = false;

function getWorker(): Promise<TesseractWorker> {
  workerPromise ??= import('tesseract.js').then((mod) =>
    // tesseract.js is CommonJS, so the bundle may expose it under `default`.
    (mod.createWorker ?? (mod as unknown as { default: typeof mod }).default.createWorker)('eng', 1, {
      logger: (m: { status: string; progress: number }) => {
        if (checking) report('Checking which way up the page is…');
        else if (m.status === 'recognizing text') report(`Reading text… ${Math.round(m.progress * 100)}%`);
        else if (m.status.startsWith('loading')) report('Loading the text recognizer (first time only)…');
      },
    }),
  );
  workerPromise.catch(() => (workerPromise = null));
  return workerPromise;
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

/** The part of the canvas holding the words of a read, at most about 1400 x 1000 pixels. */
function textTile(canvas: HTMLCanvasElement, data: Page): HTMLCanvasElement {
  const boxes = (data.lines ?? []).flatMap((l) => l.words.map((w) => w.bbox));
  const [x0, y0, x1, y1] = boxes.length
    ? [Math.min(...boxes.map((b) => b.x0)), Math.min(...boxes.map((b) => b.y0)), Math.max(...boxes.map((b) => b.x1)), Math.max(...boxes.map((b) => b.y1))]
    : [0, 0, canvas.width, canvas.height];
  const w = Math.min(x1 - x0, 1400);
  const h = Math.min(y1 - y0, 1000);
  const x = Math.round((x0 + x1 - w) / 2);
  const y = Math.round((y0 + y1 - h) / 2);
  const tile = document.createElement('canvas');
  tile.width = w;
  tile.height = h;
  tile.getContext('2d')!.drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return tile;
}

const readsWell = (score: number, words: number) => score >= 20 && score >= words * 2;
const wordCount = (data: Page) => (data.lines ?? []).reduce((n, l) => n + l.words.length, 0);

/**
 * Reads the canvas the way up its text runs. Tesseract only reads upright text, so when the
 * first pass reads badly, the part of the page holding text is read turned each other way
 * (upside down first, the usual case), and the page is read again the first way that reads well.
 */
async function readUpright(worker: TesseractWorker, canvas: HTMLCanvasElement): Promise<{ data: Page; quarters: number }> {
  const { data } = await worker.recognize(canvas);
  const first = score(data);
  if (first >= 40 && readsWell(first, wordCount(data))) return { data, quarters: 0 };
  checking = true;
  const tile = textTile(canvas, data);
  let base = 0;
  let best = { quarters: 0, score: 0 };
  try {
    base = score((await worker.recognize(tile)).data);
    best.score = base;
    for (const quarters of [2, 1, 3]) {
      const read = (await worker.recognize(turned(tile, quarters))).data;
      const s = score(read);
      if (s > best.score) best = { quarters, score: s };
      if (readsWell(s, wordCount(read)) && s > base * 2) break;
    }
  } finally {
    checking = false;
  }
  if (!best.quarters || best.score < 8 || best.score <= base * 2) return { data, quarters: 0 };
  return { data: (await worker.recognize(turned(canvas, best.quarters))).data, quarters: best.quarters };
}

/**
 * Runs OCR on a bitmap and returns a text unit whose ranges map to word boxes, with the
 * clockwise quarter turns that made it upright. The boxes sit on the canvas turned that way.
 */
/**
 * A copy with transparent areas filled, for Tesseract, which reads them as black. Light
 * marks (white text on a transparent logo or screenshot) get a black backdrop, others white.
 */
export function opaque(src: HTMLCanvasElement): HTMLCanvasElement {
  const { data } = src.getContext('2d')!.getImageData(0, 0, src.width, src.height);
  const step = 4 * Math.max(1, Math.floor(data.length / 4 / 200_000));
  let clear = 0;
  let marks = 0;
  let light = 0;
  for (let i = 0; i < data.length; i += step) {
    if (data[i + 3] < 128) {
      clear++;
      continue;
    }
    marks++;
    if (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114 > 160) light++;
  }
  if (!clear) return src;
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = marks && light > marks / 2 ? '#000' : '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, 0);
  return out;
}

export async function readText(id: string, page: number, canvas: HTMLCanvasElement, progress: Progress): Promise<{ unit: Unit; quarters: number }> {
  report = progress;
  const worker = await getWorker();
  const { data, quarters } = await readUpright(worker, opaque(canvas));
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
