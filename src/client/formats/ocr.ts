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

interface WordBox {
  start: number;
  end: number;
  line: number;
  box: Rect;
}

/** Runs OCR on a bitmap and returns a text unit whose ranges map back to word boxes. */
export async function ocrUnit(id: string, page: number, canvas: HTMLCanvasElement, progress: Progress): Promise<Unit> {
  report = progress;
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas);
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
      return [...byLine.values()].map((r) => pad(r, Math.max(2, r.h * 0.12)));
    },
  };
}

export function pad(r: Rect, p: number): Rect {
  return { x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p };
}
