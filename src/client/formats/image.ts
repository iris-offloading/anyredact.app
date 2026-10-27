import { burnBoxes, canvasToBlob, outputName, rectsForPage, scaledCanvas, type LoadedDoc, type MetaField, type Page, type Progress, type Unit } from '../types.ts';
import { readMetadata } from './metadata.ts';
import { ocrUnit } from './ocr.ts';

const HEIC = /^image\/hei[cf]/;
// Drawings are rendered with this many pixels on their long side, so OCR can read small labels.
const SVG_MIN_SIDE = 1600;
const SVG_MAX_SIDE = 4000;
// Pages read from one TIFF, as for PDFs.
const MAX_PAGES = 60;

function isHeic(file: File) {
  return HEIC.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

export function isTiff(file: File) {
  return file.type === 'image/tiff' || /\.tiff?$/i.test(file.name);
}

export function isSvg(file: File) {
  return file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
}

/** Decodes with the browser where it can (Safari reads HEIC), else with libheif for iPhone photos. */
async function decode(file: File, progress: Progress): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (err) {
    if (!isHeic(file)) throw err;
  }
  progress('Opening HEIC photo…');
  const { heicTo } = await import('heic-to/csp');
  return heicTo({ blob: file, type: 'bitmap' });
}

// WebCodecs' ImageDecoder is missing from TypeScript's DOM types.
declare const ImageDecoder: { new (init: { data: ReadableStream<Uint8Array>; type: string }): { completed: Promise<void>; tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null }; close(): void } } | undefined;

/** Frames in an animated GIF, WebP, PNG or AVIF; 1 where the browser cannot tell. */
async function frameCount(file: File): Promise<number> {
  if (typeof ImageDecoder === 'undefined' || !/^image\/(gif|webp|png|apng|avif)$/.test(file.type)) return 1;
  try {
    const decoder = new ImageDecoder({ data: file.stream(), type: file.type });
    await decoder.completed;
    const n = decoder.tracks.selectedTrack?.frameCount ?? 1;
    decoder.close();
    return n;
  } catch {
    return 1;
  }
}

/** Every page of a TIFF, skipping the thumbnails some scanners add. */
async function decodeTiff(file: File, progress: Progress): Promise<{ canvases: HTMLCanvasElement[]; total: number }> {
  const { default: UTIF } = await import('utif2');
  const buf = await file.arrayBuffer();
  const ifds = UTIF.decode(buf).filter((ifd) => ifd.t256 && ifd.t257 && !(Number((ifd.t254 as number[] | undefined)?.[0]) & 1));
  if (!ifds.length) throw new Error('This TIFF has no pages to show.');
  const canvases: HTMLCanvasElement[] = [];
  for (const [i, ifd] of ifds.slice(0, MAX_PAGES).entries()) {
    if (ifds.length > 1) progress(`Opening page ${i + 1} of ${Math.min(ifds.length, MAX_PAGES)}…`);
    UTIF.decodeImage(buf, ifd);
    const raw = document.createElement('canvas');
    raw.width = ifd.width;
    raw.height = ifd.height;
    raw.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(UTIF.toRGBA8(ifd).buffer), ifd.width, ifd.height), 0, 0);
    canvases.push(scaledCanvas(raw));
  }
  return { canvases, total: ifds.length };
}

/** Writes the pages as one RGB TIFF, each page a single Deflate strip. */
async function writeTiff(canvases: HTMLCanvasElement[]): Promise<Blob> {
  const { default: UTIF } = await import('utif2');
  const strips = await Promise.all(
    canvases.map(async (c) => {
      const { data } = onWhite(c).getContext('2d')!.getImageData(0, 0, c.width, c.height);
      const rgb = new Uint8Array(c.width * c.height * 3);
      for (let p = 0, q = 0; p < data.length; p += 4, q += 3) rgb.set(data.subarray(p, p + 3), q);
      return new Uint8Array(await new Response(new Blob([rgb]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
    }),
  );
  const ifds = (offsets: number[]) =>
    canvases.map((c, i) => ({ t256: [c.width], t257: [c.height], t258: [8, 8, 8], t259: [8], t262: [2], t273: [offsets[i]], t277: [3], t278: [c.height], t279: [strips[i].length], t284: [1] }));
  // The directories are the same size whatever the offsets, so a first pass gives where the pixels start.
  let at = UTIF.encode(ifds(strips.map(() => 0)) as never).byteLength;
  const offsets = strips.map((s) => ((at += s.length), at - s.length));
  return new Blob([UTIF.encode(ifds(offsets) as never), ...strips], { type: 'image/tiff' });
}

/** A copy with transparent areas made white, for OCR and formats without transparency. */
function onWhite(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, 0);
  return out;
}

/** Draws an SVG into pixels. Inside an <img>, its scripts never run and nothing outside the file loads. */
async function renderSvg(file: File): Promise<{ canvas: HTMLCanvasElement; metadata: MetaField[] }> {
  const doc = new DOMParser().parseFromString(await file.text(), 'image/svg+xml');
  const svg = doc.documentElement;
  if (doc.querySelector('parsererror') || svg.localName !== 'svg') throw new Error('This SVG file could not be read.');
  const length = (v: string | null) => (v && /^\s*[\d.]+(px)?\s*$/.test(v) ? parseFloat(v) : NaN);
  const box = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const hasBox = box.length === 4 && box[2] > 0 && box[3] > 0;
  let w = length(svg.getAttribute('width'));
  let h = length(svg.getAttribute('height'));
  if (!(w > 0) && !(h > 0)) [w, h] = hasBox ? [box[2], box[3]] : [300, 150];
  else if (!(w > 0)) w = hasBox ? (h * box[2]) / box[3] : h;
  else if (!(h > 0)) h = hasBox ? (w * box[3]) / box[2] : w;
  if (!hasBox) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const scale = Math.min(SVG_MAX_SIDE / Math.max(w, h), Math.max(1, SVG_MIN_SIDE / Math.max(w, h)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  svg.setAttribute('width', String(canvas.width));
  svg.setAttribute('height', String(canvas.height));

  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }

  // What the file holds besides the drawing, all of which the PNG leaves behind.
  const text = (sel: string) => [...doc.querySelectorAll(sel)].map((el) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '').filter(Boolean);
  const links = [...doc.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? a.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '').filter(Boolean);
  const metadata: MetaField[] = [];
  const add = (label: string, values: string[], key = true) => values.length && metadata.push({ label, value: values.join(', ').slice(0, 160), key });
  add('Title', text('title'));
  add('Description', text('desc'));
  add('Metadata', text('metadata'));
  add('Links', [...new Set(links)]);
  add('Scripts', doc.querySelectorAll('script').length ? [String(doc.querySelectorAll('script').length)] : [], false);
  return { canvas, metadata };
}

/** Reads each page with OCR, noting when it finds nothing or fails. */
async function readPages(canvases: HTMLCanvasElement[], progress: Progress, notes: string[]): Promise<Unit[]> {
  const units: Unit[] = [];
  let failed = false;
  for (const [i, canvas] of canvases.entries()) {
    const id = canvases.length > 1 ? `p${i + 1}` : 'image';
    try {
      units.push(await ocrUnit(id, i, onWhite(canvas), canvases.length > 1 ? (m) => progress(`Page ${i + 1}: ${m}`) : progress));
    } catch (err) {
      console.error(err);
      failed = true;
      units.push({ id, page: i, text: '' });
    }
  }
  const where = canvases.length > 1 ? 'these pages' : 'this image';
  if (failed) notes.push('Automatic text reading failed, so nothing was detected. Drag on the image to draw redaction boxes.');
  else if (!units.some((u) => u.text.trim())) notes.push(`No text was found in ${where}. Drag on the image to draw redaction boxes.`);
  return units;
}

// What each source comes back as. Browsers cannot write HEIC, AVIF, GIF or BMP.
const OUTPUT: Record<string, string> = { 'image/png': 'image/png', 'image/jpeg': 'image/jpeg', 'image/webp': 'image/webp', 'image/avif': 'image/webp' };
const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export async function loadImage(file: File, progress: Progress): Promise<LoadedDoc> {
  progress('Opening image…');
  const notes: string[] = [];
  let canvases: HTMLCanvasElement[];
  let metadata: Promise<MetaField[]> | MetaField[] = [];
  if (isSvg(file)) {
    const svg = await renderSvg(file);
    canvases = [svg.canvas];
    metadata = svg.metadata;
  } else if (isTiff(file)) {
    metadata = readMetadata(file);
    const tiff = await decodeTiff(file, progress);
    canvases = tiff.canvases;
    if (tiff.total > MAX_PAGES) notes.push(`Only the first ${MAX_PAGES} of ${tiff.total} pages were loaded.`);
  } else {
    metadata = readMetadata(file);
    const [bitmap, frames] = await Promise.all([decode(file, progress), frameCount(file)]);
    canvases = [scaledCanvas(bitmap)];
    bitmap.close();
    if (frames > 1) notes.push('This image is animated. Only its first frame is kept.');
  }

  const pages: Page[] = canvases.map((canvas, index) => ({ index, canvas }));
  const units = await readPages(canvases, progress, notes);
  const type = isTiff(file) ? 'image/tiff' : isHeic(file) ? 'image/jpeg' : (OUTPUT[file.type] ?? 'image/png');
  return {
    kind: 'image',
    units,
    pages,
    notes,
    metadata: await metadata,
    async exportFile(findings, boxes) {
      // Re-encoding through a canvas writes pixels only, so EXIF, GPS, XMP and IPTC are left behind.
      const out = pages.map((p) => burnBoxes(p.canvas, rectsForPage(p.index, findings, boxes)));
      const blob = type === 'image/tiff' ? await writeTiff(out) : await canvasToBlob(type === 'image/jpeg' ? onWhite(out[0]) : out[0], type, 0.92);
      // Safari writes PNG when asked for WebP, so the name follows what came out.
      return { blob, filename: outputName(file.name, type === 'image/tiff' ? undefined : (EXTENSIONS[blob.type] ?? 'png')) };
    },
  };
}
