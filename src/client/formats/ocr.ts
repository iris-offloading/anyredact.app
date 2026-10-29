import type { Progress, Rect, Unit } from '../types.ts';

type TesseractWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;
let workerPromise: Promise<TesseractWorker> | null = null;
let report: Progress = () => {};
let probing = false;

function getWorker(): Promise<TesseractWorker> {
  workerPromise ??= import('tesseract.js').then((mod) =>
    // tesseract.js is CommonJS, so the bundle may expose it under `default`.
    (mod.createWorker ?? (mod as unknown as { default: typeof mod }).default.createWorker)('eng', 1, {
      logger: (m: { status: string; progress: number }) => {
        if (probing) report('Checking which way up the page is…');
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

/** Draws the canvas turned clockwise by quarter turns, optionally scaled down. */
function turned(canvas: HTMLCanvasElement, quarters: number, scale = 1): HTMLCanvasElement {
  const w = Math.round(canvas.width * scale);
  const h = Math.round(canvas.height * scale);
  const out = document.createElement('canvas');
  [out.width, out.height] = quarters % 2 ? [h, w] : [w, h];
  const ctx = out.getContext('2d')!;
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((quarters * Math.PI) / 2);
  ctx.drawImage(canvas, -w / 2, -h / 2, w, h);
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

/**
 * Reads the canvas the way up its text runs. Scans and photos can be sideways or upside down,
 * and Tesseract only reads upright text, so when the first pass finds little it tries the
 * other three quarter turns on a smaller copy and rereads at full size the turn that wins.
 */
async function readUpright(worker: TesseractWorker, canvas: HTMLCanvasElement): Promise<{ data: Page; quarters: number }> {
  const { data } = await worker.recognize(canvas);
  const first = score(data);
  const words = (data.lines ?? []).reduce((n, l) => n + l.words.length, 0);
  if (first >= 40 && first >= words * 2) return { data, quarters: 0 };
  const scale = Math.min(1, 1600 / Math.max(canvas.width, canvas.height));
  probing = true;
  let best = { quarters: 0, score: 0 };
  try {
    for (const quarters of [0, 2, 1, 3]) {
      if (quarters === 0 && scale === 1) {
        best = { quarters, score: first };
        continue;
      }
      const s = score((await worker.recognize(turned(canvas, quarters, scale))).data);
      if (s > best.score) best = { quarters, score: s };
    }
  } finally {
    probing = false;
  }
  if (best.quarters === 0 || best.score < 4) return { data, quarters: 0 };
  return { data: (await worker.recognize(turned(canvas, best.quarters))).data, quarters: best.quarters };
}

/** Runs OCR on a bitmap and returns a text unit whose ranges map back to word boxes. */
export async function ocrUnit(id: string, page: number, canvas: HTMLCanvasElement, progress: Progress): Promise<Unit> {
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
  return {
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
      return [...byLine.values()].map((r) => unturn(pad(r, Math.max(2, r.h * 0.12)), quarters, canvas.width, canvas.height));
    },
  };
}

export function pad(r: Rect, p: number): Rect {
  return { x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p };
}
