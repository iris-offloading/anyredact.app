import { burnBoxes, canvasToBlob, FileError, MAX_PAGES, outputName, partialPages, rectsForPage, scaledCanvas, type LoadedDoc, type MetaField, type Page, type Progress, type Unit } from '../types.ts';
import { readMetadata } from './metadata.ts';
import { readText, turned } from './ocr.ts';

const HEIC = /^image\/hei[cf]/;
// Drawings are rendered with this many pixels on their long side, so OCR can read small labels.
const SVG_MIN_SIDE = 1600;
const SVG_MAX_SIDE = 4000;
// CSS pixels per unit, for SVG sizes given in print units.
const UNITS: Record<string, number> = { '': 1, px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72, pc: 16 };
const TYPES: Record<string, string> = { png: 'image/png', apng: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', bmp: 'image/bmp' };

/** The file's type, from its name when the browser gives none. */
function typeOf(file: File) {
  return file.type || TYPES[file.name.match(/\.(\w+)$/)?.[1].toLowerCase() ?? ''] || '';
}

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
  const type = typeOf(file);
  if (typeof ImageDecoder === 'undefined' || !/^image\/(gif|webp|png|avif)$/.test(type)) return 1;
  let decoder: InstanceType<NonNullable<typeof ImageDecoder>> | undefined;
  try {
    decoder = new ImageDecoder({ data: file.stream(), type });
    await decoder.completed;
    return decoder.tracks.selectedTrack?.frameCount ?? 1;
  } catch {
    return 1;
  } finally {
    decoder?.close();
  }
}

/** Every page of a TIFF, skipping the thumbnails some scanners add. */
async function decodeTiff(file: File, progress: Progress): Promise<{ canvases: HTMLCanvasElement[]; total: number }> {
  const { default: UTIF } = await import('utif2');
  const buf = await file.arrayBuffer();
  const ifds = UTIF.decode(buf).filter((ifd) => ifd.t256 && ifd.t257 && !(Number((ifd.t254 as number[] | undefined)?.[0]) & 1));
  if (!ifds.length) throw new FileError('This TIFF has no pages to show.');
  const canvases: HTMLCanvasElement[] = [];
  for (const [i, ifd] of ifds.slice(0, MAX_PAGES).entries()) {
    if (ifds.length > 1) progress(`Opening page ${i + 1} of ${Math.min(ifds.length, MAX_PAGES)}…`);
    UTIF.decodeImage(buf, ifd);
    const raw = document.createElement('canvas');
    raw.width = ifd.width;
    raw.height = ifd.height;
    raw.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(UTIF.toRGBA8(ifd).buffer), ifd.width, ifd.height), 0, 0);
    // Pages are decoded one at a time, so only the current page's pixels are held twice.
    delete (ifd as { data?: Uint8Array }).data;
    canvases.push(scaledCanvas(raw));
  }
  return { canvases, total: ifds.length };
}

/** Writes the pages as one RGB TIFF, each page a single Deflate strip. Pages are drawn one at a time to keep memory down. */
async function writeTiff(count: number, draw: (i: number) => HTMLCanvasElement): Promise<Blob> {
  const { default: UTIF } = await import('utif2');
  const sizes: { w: number; h: number }[] = [];
  const strips: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const c = onWhite(draw(i));
    const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    const rgb = new Uint8Array(c.width * c.height * 3);
    for (let p = 0, q = 0; p < data.length; p += 4, q += 3) {
      rgb[q] = data[p];
      rgb[q + 1] = data[p + 1];
      rgb[q + 2] = data[p + 2];
    }
    sizes.push({ w: c.width, h: c.height });
    strips.push(new Uint8Array(await new Response(new Blob([rgb]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()));
  }
  const ifds = (offsets: number[]) =>
    sizes.map(({ w, h }, i) => ({ t256: [w], t257: [h], t258: [8, 8, 8], t259: [8], t262: [2], t273: [offsets[i]], t277: [3], t278: [h], t279: [strips[i].length], t284: [1] }));
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

/** Draws the parsed SVG at w by h user units, scaled so OCR can read it. Inside an <img>, its scripts never run and nothing outside the file loads. */
async function drawSvg(doc: Document, w: number, h: number): Promise<HTMLCanvasElement> {
  const scale = Math.min(SVG_MAX_SIDE / Math.max(w, h), Math.max(1, SVG_MIN_SIDE / Math.max(w, h)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  doc.documentElement.setAttribute('width', String(canvas.width));
  doc.documentElement.setAttribute('height', String(canvas.height));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
  return canvas;
}

/** False when the browser has locked the canvas, so it cannot be read or saved. */
function readable(canvas: HTMLCanvasElement) {
  try {
    canvas.getContext('2d')!.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
}

async function renderSvg(file: File, notes: string[]): Promise<{ canvas: HTMLCanvasElement; metadata: MetaField[] }> {
  const doc = new DOMParser().parseFromString(await file.text(), 'image/svg+xml');
  const svg = doc.documentElement;
  if (doc.querySelector('parsererror') || svg.localName !== 'svg') throw new FileError('This SVG file could not be read.');
  // Relative sizes (%, em) fall back to the viewBox.
  const length = (v: string | null) => {
    const m = v?.trim().match(/^([\d.]+)([a-z]*)$/i);
    return m && m[2].toLowerCase() in UNITS ? parseFloat(m[1]) * UNITS[m[2].toLowerCase()] : NaN;
  };
  const box = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const hasBox = box.length === 4 && box[2] > 0 && box[3] > 0;
  let w = length(svg.getAttribute('width'));
  let h = length(svg.getAttribute('height'));
  if (!(w > 0) && !(h > 0)) [w, h] = hasBox ? [box[2], box[3]] : [300, 150];
  else if (!(w > 0)) w = hasBox ? (h * box[2]) / box[3] : h;
  else if (!(h > 0)) h = hasBox ? (w * box[3]) / box[2] : w;
  if (!hasBox) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  // What the file holds besides the drawing, all of which the PNG leaves behind.
  const text = (sel: string) => [...doc.querySelectorAll(sel)].map((el) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '').filter(Boolean);
  const links = [...doc.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? a.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '').filter(Boolean);
  const metadata: MetaField[] = [];
  const add = (label: string, values: string[], key = true) => values.length && metadata.push({ label, value: values.join(', ').slice(0, 160), key });
  add('Title', text('title'));
  add('Description', text('desc'));
  add('Metadata', text('metadata'));
  add('Links', [...new Set(links)]);
  const scripts = doc.querySelectorAll('script').length;
  add('Scripts', scripts ? [String(scripts)] : [], false);

  let canvas = await drawSvg(doc, w, h);
  // Safari will not let a page read back a drawing with embedded HTML, so that part is left out.
  const objects = doc.querySelectorAll('foreignObject');
  if (!readable(canvas) && objects.length) {
    objects.forEach((el) => el.remove());
    canvas = await drawSvg(doc, w, h);
    notes.push('Embedded HTML in this drawing cannot be drawn here, so it is left out of the preview and the download.');
  }
  if (!readable(canvas)) throw new FileError('This SVG file could not be drawn.');
  return { canvas, metadata };
}

/** Reads each page with OCR, noting when it finds nothing or fails. A page lying sideways or upside down is turned upright in place. */
async function readPages(canvases: HTMLCanvasElement[], progress: Progress, notes: string[]): Promise<Unit[]> {
  const units: Unit[] = [];
  let failed = false;
  for (const [i, canvas] of canvases.entries()) {
    const id = canvases.length > 1 ? `p${i + 1}` : 'image';
    try {
      const read = await readText(id, i, canvas, canvases.length > 1 ? (m) => progress(`Page ${i + 1}: ${m}`) : progress);
      canvases[i] = turned(canvas, read.quarters);
      units.push(read.unit);
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
  let partial = partialPages(1);
  if (isSvg(file)) {
    const svg = await renderSvg(file, notes);
    canvases = [svg.canvas];
    metadata = svg.metadata;
  } else if (isTiff(file)) {
    metadata = readMetadata(file);
    const tiff = await decodeTiff(file, progress);
    canvases = tiff.canvases;
    if (tiff.total > MAX_PAGES) notes.push(`Only the first ${MAX_PAGES} of ${tiff.total} pages were loaded.`);
    partial = partialPages(tiff.total);
  } else {
    metadata = readMetadata(file);
    const [bitmap, frames] = await Promise.all([decode(file, progress), frameCount(file)]);
    canvases = [scaledCanvas(bitmap)];
    bitmap.close();
    if (frames > 1) notes.push('This image is animated. Only its first frame is kept.');
  }

  const units = await readPages(canvases, progress, notes);
  const pages: Page[] = canvases.map((canvas, index) => ({ index, canvas }));
  const type = isTiff(file) ? 'image/tiff' : isHeic(file) ? 'image/jpeg' : (OUTPUT[typeOf(file)] ?? 'image/png');
  return {
    kind: 'image',
    units,
    pages,
    notes,
    downloadNote: partial.note,
    metadata: await metadata,
    async exportFile(findings, boxes) {
      // Re-encoding through a canvas writes pixels only, so EXIF, GPS, XMP and IPTC are left behind.
      const burn = (i: number) => burnBoxes(pages[i].canvas, rectsForPage(i, findings, boxes));
      if (type === 'image/tiff') return { blob: await writeTiff(pages.length, burn), filename: outputName(file.name, /\.tiff?$/i.test(file.name) ? undefined : 'tiff', partial.suffix) };
      const blob = await canvasToBlob(type === 'image/jpeg' ? onWhite(burn(0)) : burn(0), type, 0.92);
      // Safari writes PNG when asked for WebP, so the name follows what came out.
      return { blob, filename: outputName(file.name, EXTENSIONS[blob.type] ?? 'png') };
    },
  };
}
