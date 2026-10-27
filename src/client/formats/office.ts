import type JSZip from 'jszip';
import { rewriteSegments } from '../../shared/segments.ts';
import { burnBoxes, canvasToBlob, rectsForPage, type Finding, type ManualMark, type Page, type Progress, type RedactStyle, type Unit } from '../types.ts';
import { ocrUnit } from './ocr.ts';

// Helpers shared by the Word, Excel and PowerPoint formats, which are all zipped XML parts.

// Pictures the browser can decode; EMF, WMF and TIFF are left as they are.
const PICTURE = /\.(png|jpe?g|gif|bmp|webp)$/i;
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };
const MAX_SIDE = 6000;
// Bullets, rules and icons: re-encoded on download but not shown for review.
const MIN_REVIEW_SIDE = 48;
// Alt text and titles on pictures and shapes (DrawingML docPr/cNvPr, VML shapes).
const ALT_ATTRS: Record<string, string[]> = { docPr: ['descr', 'title'], cNvPr: ['descr', 'title'], shape: ['alt'], imagedata: ['title'] };

export interface Picture {
  name: string;
  canvas: HTMLCanvasElement;
  /** Index into the editor pages, or -1 when too small to review. */
  page: number;
  /** Set once the picture had to be saved as PNG under a new name. */
  renamed?: string;
}

export interface Pictures {
  pictures: Picture[];
  pages: Page[];
  units: Unit[];
  /** Pictures in a format the browser cannot open. */
  unreadable: number;
}

/** Opens every picture in a media folder, reads the text in it, and lists the larger ones for review. */
export async function loadPictures(zip: JSZip, folder: string, progress: Progress): Promise<Pictures> {
  const out: Pictures = { pictures: [], pages: [], units: [], unreadable: 0 };
  const media = Object.keys(zip.files).filter((n) => n.startsWith(folder) && !zip.files[n].dir);
  for (const name of media) {
    if (!PICTURE.test(name)) {
      out.unreadable++;
      continue;
    }
    progress(`Opening pictures… ${out.pictures.length + 1} of ${media.length}`);
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    let canvas: HTMLCanvasElement;
    try {
      canvas = await decode(new Blob([await zip.file(name)!.async('arraybuffer')], { type: MIME[ext] }));
    } catch (err) {
      console.warn(name, err);
      out.unreadable++;
      continue;
    }
    const review = Math.max(canvas.width, canvas.height) >= MIN_REVIEW_SIDE;
    out.pictures.push({ name, canvas, page: review ? out.pages.length : -1 });
    if (!review) continue;
    const index = out.pages.length;
    out.pages.push({ index, canvas, label: `Picture ${index + 1}` });
    try {
      out.units.push(await ocrUnit(`picture#${index}`, index, canvas, progress));
    } catch (err) {
      console.error(err);
      out.units.push({ id: `picture#${index}`, page: index, text: '' });
    }
  }
  return out;
}

/** Paints the boxes into each picture and writes it back, which also drops its metadata. */
export async function writePictures(zip: JSZip, pictures: Picture[], findings: Finding[], marks: ManualMark[]) {
  for (const pic of pictures) {
    // Re-encoding through a canvas writes pixels only, so EXIF, GPS, XMP and text chunks are left behind.
    const out = pic.page < 0 ? pic.canvas : burnBoxes(pic.canvas, rectsForPage(pic.page, findings, marks));
    const want = /\.jpe?g$/i.test(pic.name) ? 'image/jpeg' : /\.webp$/i.test(pic.name) ? 'image/webp' : 'image/png';
    const blob = await canvasToBlob(out, pic.renamed ? 'image/png' : want, 0.92);
    // GIF and BMP become PNG, as does WebP where the browser cannot write it.
    if (!pic.renamed && MIME[pic.name.slice(pic.name.lastIndexOf('.') + 1).toLowerCase()] !== blob.type) {
      const stem = pic.name.replace(/\.[^.]+$/, '');
      let name = `${stem}.png`;
      for (let n = 2; zip.file(name); n++) name = `${stem}-${n}.png`;
      await renamePart(zip, pic.name, name);
      pic.renamed = name;
    }
    zip.file(pic.renamed ?? pic.name, blob);
  }
}

export interface Alt {
  unit: Unit;
  attrs: Attr[];
}

/** Collects alt text and titles; the same description written twice becomes one unit. */
export function collectAlts(xml: Document, alts: Map<string, Alt>) {
  for (const el of Array.from(xml.getElementsByTagName('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (!ALT_ATTRS[el.localName]?.includes(attr.localName) || !attr.value.trim()) continue;
      if (!alts.has(attr.value)) alts.set(attr.value, { unit: { id: `alt#${alts.size}`, text: attr.value }, attrs: [] });
      alts.get(attr.value)!.attrs.push(attr);
    }
  }
}

export function writeAlts(alts: Map<string, Alt>, byUnit: Map<string, Finding[]>, style: RedactStyle, redacted: Set<string>) {
  for (const a of alts.values()) {
    const spans = byUnit.get(a.unit.id) ?? [];
    for (const f of spans) redacted.add(f.text);
    const next = spans.length ? rewriteSegments([a.unit.text], spans, style)[0] : a.unit.text;
    for (const attr of a.attrs) attr.value = next;
  }
}

/** Pictures keep the file name they were inserted from, such as "Jane passport.jpg". */
export function renamePictures(xml: Document) {
  for (const el of Array.from(xml.getElementsByTagName('*'))) {
    if ((el.localName === 'docPr' || el.localName === 'cNvPr') && /\.\w{2,4}$/.test(el.getAttribute('name') ?? '')) el.setAttribute('name', 'Picture');
  }
}

/** Findings per unit, leaving out the ones turned off. */
export function enabledByUnit(findings: Finding[]) {
  const byUnit = new Map<string, Finding[]>();
  for (const f of findings) if (f.enabled) (byUnit.get(f.unitId) ?? byUnit.set(f.unitId, []).get(f.unitId)!).push(f);
  return byUnit;
}

async function decode(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

/** Resolves a relationship target against the folder its .rels file describes. */
export function resolveTarget(relsName: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const base = relsName.replace(/_rels\/[^/]*\.rels$/, '').split('/').filter(Boolean);
  for (const seg of target.split('/')) {
    if (seg === '..') base.pop();
    else if (seg && seg !== '.') base.push(seg);
  }
  return base.join('/');
}

/** The .rels file that lists a part's relationships. */
export const relsOf = (part: string) => part.replace(/([^/]+)$/, '_rels/$1.rels');

export async function readXml(zip: JSZip, name: string): Promise<Document | null> {
  const f = zip.file(name);
  if (!f) return null;
  const xml = new DOMParser().parseFromString(await f.async('string'), 'application/xml');
  return xml.getElementsByTagName('parsererror').length ? null : xml;
}

async function editXml(zip: JSZip, name: string, edit: (xml: Document) => boolean) {
  const xml = await readXml(zip, name);
  if (xml && edit(xml)) zip.file(name, new XMLSerializer().serializeToString(xml));
}

/** Moves a part to a new name and points every relationship and content type at it. */
async function renamePart(zip: JSZip, from: string, to: string) {
  zip.remove(from);
  for (const rels of Object.keys(zip.files).filter((n) => n.endsWith('.rels'))) {
    await editXml(zip, rels, (xml) => {
      let changed = false;
      for (const rel of Array.from(xml.getElementsByTagName('Relationship'))) {
        const target = rel.getAttribute('Target') ?? '';
        if (rel.getAttribute('TargetMode') === 'External' || resolveTarget(rels, target) !== from) continue;
        rel.setAttribute('Target', target.replace(/[^/]+$/, to.slice(to.lastIndexOf('/') + 1)));
        changed = true;
      }
      return changed;
    });
  }
  await editXml(zip, '[Content_Types].xml', (xml) => {
    const root = xml.documentElement;
    for (const o of Array.from(root.getElementsByTagName('Override'))) if (o.getAttribute('PartName') === '/' + from) o.setAttribute('PartName', '/' + to);
    if (Array.from(root.getElementsByTagName('Default')).some((d) => d.getAttribute('Extension')?.toLowerCase() === 'png')) return true;
    const d = xml.createElementNS(root.namespaceURI, 'Default');
    d.setAttribute('Extension', 'png');
    d.setAttribute('ContentType', 'image/png');
    root.insertBefore(d, root.firstChild);
    return true;
  });
}

/** Word and PowerPoint can save a picture of the first page in docProps; it would show the text before redaction. */
export async function removeThumbnail(zip: JSZip) {
  const thumbs = Object.keys(zip.files).filter((n) => /^docProps\/thumbnail\.\w+$/i.test(n));
  if (!thumbs.length) return;
  thumbs.forEach((n) => zip.remove(n));
  await editXml(zip, '_rels/.rels', (xml) => {
    for (const rel of Array.from(xml.getElementsByTagName('Relationship'))) {
      if (thumbs.includes(resolveTarget('_rels/.rels', rel.getAttribute('Target') ?? ''))) rel.remove();
    }
    return true;
  });
  await editXml(zip, '[Content_Types].xml', (xml) => {
    for (const o of Array.from(xml.getElementsByTagName('Override'))) if (thumbs.includes((o.getAttribute('PartName') ?? '').slice(1))) o.remove();
    return true;
  });
}

/** Hyperlink targets live in .rels files; blank any that point at redacted text or a mail address. */
export async function scrubRelationships(zip: JSZip, redacted: Set<string>, parts = /^word\/_rels\/.*\.rels$/) {
  for (const name of Object.keys(zip.files).filter((n) => parts.test(n))) {
    await editXml(zip, name, (xml) => {
      let changed = false;
      for (const rel of Array.from(xml.getElementsByTagName('Relationship'))) {
        if (rel.getAttribute('TargetMode') !== 'External') continue;
        const target = decodeURIComponent(rel.getAttribute('Target') ?? '');
        if (/^mailto:/i.test(target) || [...redacted].some((t) => target.includes(t))) {
          rel.setAttribute('Target', 'about:blank');
          changed = true;
        }
      }
      return changed;
    });
  }
}

// Lists of everyone who tracked changes or commented, and the attributes that name them.
const PEOPLE: Record<string, Record<string, string>> = {
  'word/people.xml': { author: 'Redacted', userId: 'Redacted' },
  'ppt/commentAuthors.xml': { name: 'Redacted', initials: 'R' },
  'ppt/authors.xml': { name: 'Redacted', initials: 'R', userId: 'Redacted' },
};

export async function scrubProperties(zip: JSZip) {
  const blank: Record<string, string[]> = {
    'docProps/core.xml': ['creator', 'lastModifiedBy', 'title', 'subject', 'description', 'keywords', 'category'],
    'docProps/app.xml': ['Company', 'Manager'],
  };
  for (const [name, tags] of Object.entries(blank)) {
    await editXml(zip, name, (xml) => {
      for (const el of Array.from(xml.getElementsByTagName('*'))) if (tags.includes(el.localName)) el.textContent = '';
      return true;
    });
  }
  for (const [name, attrs] of Object.entries(PEOPLE)) {
    await editXml(zip, name, (xml) => {
      for (const el of Array.from(xml.getElementsByTagName('*'))) {
        for (const attr of Array.from(el.attributes)) if (attr.localName in attrs) attr.value = attrs[attr.localName];
      }
      return true;
    });
  }
}
