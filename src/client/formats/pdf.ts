import * as pdfjs from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { burnBoxes, canvasToBlob, FileError, MAX_PAGES, outputName, partialPages, rectsForPage, type LoadedDoc, type Page, type Progress, type Rect, type Unit } from '../types.ts';
import { pad, readText, turned } from './ocr.ts';

declare const __PDF_WORKER_SRC__: string;
pdfjs.GlobalWorkerOptions.workerSrc = __PDF_WORKER_SRC__;

interface Glyphs {
  start: number;
  end: number;
  rect: Rect;
  str: string;
  font: string;
  /** A form field value: any part of it covers the whole field. */
  field?: boolean;
}

/** A filled form field, with its box on the page bitmap. */
interface Field {
  str: string;
  rect: Rect;
}

const measureCtx = document.createElement('canvas').getContext('2d')!;

/** Horizontal position of character `i` as a fraction of the run's width. */
function offsetRatio(run: Glyphs, i: number): number {
  if (i <= 0) return 0;
  if (i >= run.str.length) return 1;
  measureCtx.font = run.font;
  const total = measureCtx.measureText(run.str).width;
  return total > 0 ? measureCtx.measureText(run.str.slice(0, i)).width / total : i / run.str.length;
}

/** Builds page text from pdf.js text items, remembering where each item sits on the bitmap. */
function textUnit(
  id: string,
  page: number,
  items: TextItem[],
  styles: Record<string, { fontFamily: string }>,
  viewport: pdfjs.PageViewport,
  fields: Field[] = [],
): Unit {
  let text = '';
  const runs: Glyphs[] = [];
  let prev: { right: number; baseline: number; height: number } | null = null;
  for (const item of items) {
    if (!item.str) {
      if (item.hasEOL && !text.endsWith('\n')) text += '\n';
      continue;
    }
    const tx = pdfjs.Util.transform(viewport.transform, item.transform);
    const height = Math.hypot(tx[2], tx[3]) || Math.abs(item.height * viewport.scale) || 10;
    const x = tx[4];
    const baseline = tx[5];
    const width = item.width * viewport.scale;
    if (prev && !/\s$/.test(text)) {
      const sameLine = Math.abs(baseline - prev.baseline) < height * 0.5;
      if (!sameLine) text += '\n';
      else if (x - prev.right > height * 0.15) text += ' ';
    }
    const start = text.length;
    text += item.str;
    // The real font isn't available here; a same-family stand-in gets proportions close enough.
    const font = `${Math.round(height)}px ${styles[item.fontName]?.fontFamily || 'sans-serif'}`;
    runs.push({ start, end: text.length, str: item.str, font, rect: { x, y: baseline - height, w: width, h: height * 1.25 } });
    if (item.hasEOL) text += '\n';
    prev = { right: x + width, baseline, height };
  }
  // Field values are drawn on the page but are not part of its text content.
  for (const f of fields) {
    if (text && !text.endsWith('\n')) text += '\n';
    const start = text.length;
    text += f.str;
    runs.push({ start, end: text.length, str: f.str, font: '', rect: f.rect, field: true });
  }
  return {
    id,
    page,
    text,
    rectsFor(start, end) {
      const rects: Rect[] = [];
      for (const r of runs) {
        if (r.end <= start || r.start >= end) continue;
        if (r.field) {
          rects.push(pad(r.rect, 2));
          continue;
        }
        const a = offsetRatio(r, Math.max(start, r.start) - r.start) * r.rect.w;
        const b = offsetRatio(r, Math.min(end, r.end) - r.start) * r.rect.w;
        rects.push(pad({ x: r.rect.x + a, y: r.rect.y, w: b - a, h: r.rect.h }, Math.max(2, r.rect.h * 0.15)));
      }
      return rects;
    },
  };
}

/** Text and choice field values, which the page bitmap shows but its text content leaves out. */
async function formFields(page: pdfjs.PDFPageProxy, viewport: pdfjs.PageViewport): Promise<Field[]> {
  const annotations = (await page.getAnnotations().catch(() => [])) as { subtype?: string; fieldType?: string; fieldValue?: unknown; rect?: number[]; hidden?: boolean }[];
  const fields: Field[] = [];
  for (const a of annotations) {
    if (a.subtype !== 'Widget' || (a.fieldType !== 'Tx' && a.fieldType !== 'Ch') || a.hidden || !a.rect) continue;
    const str = (Array.isArray(a.fieldValue) ? a.fieldValue.join(', ') : typeof a.fieldValue === 'string' ? a.fieldValue : '').trim();
    if (!str) continue;
    const [x0, y0, x1, y1] = viewport.convertToViewportRectangle(a.rect);
    fields.push({ str, rect: { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) } });
  }
  return fields;
}

/** Asks the visitor for a locked PDF's password, again after a wrong one; null when they cancel. */
export type AskPassword = (wrong: boolean) => Promise<string | null>;

export async function loadPdf(file: File, progress: Progress, askPassword?: AskPassword): Promise<LoadedDoc> {
  progress('Opening PDF…');
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data, isEvalSupported: false });
  let cancelled = false;
  if (askPassword) {
    task.onPassword = (update: (password: string) => void, reason: number) =>
      askPassword(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD).then((password) => {
        if (password !== null) return update(password);
        cancelled = true;
        task.destroy();
      });
  }
  const doc = await task.promise.catch((err) => {
    throw cancelled ? new FileError('This PDF is locked with a password.') : err;
  });
  progress('Opening PDF…');
  const notes: string[] = [
    'Pages are flattened into images when you download, so hidden text, links, form fields and metadata are removed. The result is not text-searchable.',
  ];
  const count = Math.min(doc.numPages, MAX_PAGES);
  if (doc.numPages > MAX_PAGES) notes.push(`Only the first ${MAX_PAGES} of ${doc.numPages} pages were loaded.`);
  const partial = partialPages(doc.numPages);

  const pages: Page[] = [];
  const units: Unit[] = [];
  const sizes: { w: number; h: number }[] = [];
  let ocrPages = 0;
  for (let i = 1; i <= count; i++) {
    progress(`Rendering page ${i} of ${count}…`);
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(count > 20 ? 1.5 : 2, 3000 / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const content = await page.getTextContent();
    const items = content.items.filter((it): it is TextItem => 'str' in it);
    const scanned = items.map((it) => it.str).join('').replace(/\s/g, '').length < 8;
    let unit = textUnit(`p${i}`, i - 1, items, content.styles, viewport, await formFields(page, viewport));
    let shown = canvas;
    let size = { w: base.width, h: base.height };
    if (scanned) {
      // Probably a scanned page: fall back to OCR. A page scanned sideways or upside down is shown and saved upright.
      try {
        const read = await readText(`p${i}`, i - 1, canvas, (m) => progress(`Page ${i}: ${m}`));
        unit = read.unit;
        shown = turned(canvas, read.quarters);
        if (read.quarters % 2) size = { w: size.h, h: size.w };
        ocrPages++;
      } catch (err) {
        console.error(err);
      }
    }
    pages.push({ index: i - 1, canvas: shown });
    units.push(unit);
    sizes.push(size);
    page.cleanup();
  }
  await doc.destroy();
  if (ocrPages) notes.push(`${ocrPages} scanned page${ocrPages > 1 ? 's were' : ' was'} read with OCR. Check them carefully.`);

  return {
    kind: 'pdf',
    units,
    pages,
    notes,
    downloadNote: partial.note,
    async exportFile(findings, boxes, _style, say = progress) {
      // Only needed for the download, so it loads then.
      const { PDFDocument } = await import('pdf-lib');
      const out = await PDFDocument.create();
      for (const p of pages) {
        say(`Writing page ${p.index + 1} of ${pages.length}…`);
        const burned = burnBoxes(p.canvas, rectsForPage(p.index, findings, boxes));
        const jpg = await out.embedJpg(await (await canvasToBlob(burned, 'image/jpeg', 0.9)).arrayBuffer());
        const { w, h } = sizes[p.index];
        out.addPage([w, h]).drawImage(jpg, { x: 0, y: 0, width: w, height: h });
      }
      out.setProducer('anyredact.app');
      out.setCreator('anyredact.app');
      const bytes = await out.save();
      return { blob: new Blob([bytes], { type: 'application/pdf' }), filename: outputName(file.name, 'pdf', partial.suffix) };
    },
  };
}
