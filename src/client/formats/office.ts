import type JSZip from 'jszip';
import { rewriteSegments } from '../../shared/segments.ts';
import { burnBoxes, canvasToBlob, FileError, groupBy, outputName, rectsForPage, scaledCanvas, type Finding, type ManualMark, type Page, type Progress, type RedactStyle, type Unit } from '../types.ts';
import { ocrUnit } from './ocr.ts';

// Helpers shared by the Word, Excel and PowerPoint formats, which are all zipped XML parts.

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Text stored across several nodes. */
export interface TextRun {
  unit: Unit;
  /** Text nodes, with null for the line and paragraph breaks between them. */
  nodes: (Element | null)[];
  /** Original piece texts, so repeated exports always start from the source. */
  original: string[];
}

// Pictures the browser can decode; EMF, WMF and TIFF are left as they are.
const PICTURE = /\.(png|jpe?g|gif|bmp|webp)$/i;
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };
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
  /** Pictures the browser cannot open: EMF, WMF, TIFF or damaged files. */
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

/**
 * DrawingML text in a part: each element holding paragraphs (shapes, table
 * cells, SmartArt, chart titles, PowerPoint comments) is one unit, and so is
 * each list of chart labels.
 */
export function drawingText(xml: Document, name: string, skip: (el: Element) => boolean = () => false): TextRun[] {
  const out: TextRun[] = [];
  const holders = new Set<Element>();
  for (const p of Array.from(xml.getElementsByTagNameNS(A, 'p'))) if (p.parentElement) holders.add(p.parentElement);
  for (const holder of holders) {
    if (skip(holder)) continue;
    const nodes: (Element | null)[] = [];
    const original: string[] = [];
    for (const p of Array.from(holder.children).filter((c) => c.localName === 'p' && c.namespaceURI === A)) {
      if (nodes.length) nodes.push(null), original.push('\n');
      for (const el of Array.from(p.getElementsByTagNameNS(A, '*'))) {
        if (el.localName === 't') nodes.push(el), original.push(el.textContent ?? '');
        else if (el.localName === 'br') nodes.push(null), original.push('\n');
      }
    }
    const text = original.join('');
    if (text.trim()) out.push({ unit: { id: `${name}#${out.length}`, text }, nodes, original });
  }
  // Charts keep their labels and series names as plain values, one list per series or axis.
  const lists = new Map<Element, Element[]>();
  for (const pt of Array.from(xml.getElementsByTagName('*')).filter((e) => e.localName === 'pt')) {
    const list = pt.parentElement;
    if (!list || !['strCache', 'lvl'].includes(list.localName)) continue;
    const v = Array.from(pt.children).find((c) => c.localName === 'v') ?? (pt.children.length ? null : pt);
    if (v) (lists.get(list) ?? lists.set(list, []).get(list)!).push(v);
  }
  for (const values of lists.values()) {
    const nodes = values.flatMap((v, i) => (i ? [null, v] : [v]));
    const original = nodes.map((n) => (n ? (n.textContent ?? '') : '\n'));
    const text = original.join('');
    if (text.trim()) out.push({ unit: { id: `${name}#${out.length}`, text }, nodes, original });
  }
  return out;
}

export function writeRun(run: TextRun, spans: Finding[], style: RedactStyle) {
  const next = spans.length ? rewriteSegments(run.original, spans, style) : run.original;
  run.nodes.forEach((n, i) => {
    if (n && n.textContent !== next[i]) n.textContent = next[i];
  });
}

/**
 * Embedded files (attached documents, the workbook behind each chart) are not
 * read for review, so they are left out. Charts keep the values they show and
 * an object keeps its picture, but neither can be opened for editing.
 */
export async function dropEmbeddings(zip: JSZip, parts: Map<string, Document>, root: 'word' | 'ppt') {
  const embedded = new Set(Object.keys(zip.files).filter((n) => n.startsWith(`${root}/embeddings/`) && !zip.files[n].dir));
  embedded.forEach((n) => zip.remove(n));
  for (const rels of Object.keys(zip.files).filter((n) => n.startsWith(`${root}/`) && /_rels\/[^/]+\.rels$/.test(n))) {
    const gone = new Set<string>();
    await editXml(zip, rels, (xml) => {
      for (const rel of Array.from(xml.getElementsByTagName('Relationship'))) {
        const external = rel.getAttribute('TargetMode') === 'External';
        // A linked object or chart workbook points at a path such as C:\Users\jane\Documents.
        const linked = external && /\/(oleObject|package)$/.test(rel.getAttribute('Type') ?? '');
        if (!linked && (external || !embedded.has(resolveTarget(rels, rel.getAttribute('Target') ?? '')))) continue;
        gone.add(rel.getAttribute('Id') ?? '');
        rel.remove();
      }
      return gone.size > 0;
    });
    if (!gone.size) continue;
    const unlink = (xml: Document) => {
      for (const el of Array.from(xml.getElementsByTagName('*'))) {
        if (!gone.has(el.getAttributeNS(R, 'id') ?? '')) continue;
        if (el.localName === 'externalData') el.remove();
        else el.removeAttributeNS(R, 'id');
        // An object's name is often the file it came from.
        if (el.localName === 'oleObj') el.setAttribute('name', 'Object');
      }
      return true;
    };
    // Parts read for review are written again on every download, so they change in memory too.
    const source = rels.replace(/_rels\/([^/]+)\.rels$/, '$1');
    const held = parts.get(source);
    if (held) unlink(held), zip.file(source, xmlString(held));
    else await editXml(zip, source, unlink);
  }
  await editXml(zip, '[Content_Types].xml', (xml) => {
    for (const o of Array.from(xml.getElementsByTagName('Override'))) if (embedded.has((o.getAttribute('PartName') ?? '').slice(1))) o.remove();
    return true;
  });
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
  return groupBy(
    findings.filter((f) => f.enabled),
    (f) => f.unitId,
  );
}

async function decode(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const canvas = scaledCanvas(bitmap);
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

/** The .rels file that lists a part's relationships ('' is the package itself). */
export const relsOf = (part: string) => (part ? part.replace(/([^/]+)$/, '_rels/$1.rels') : '_rels/.rels');

export interface Rel {
  el: Element;
  type: string;
  /** The part's path in the zip, or the URL as written for an external target. */
  target: string;
  external: boolean;
}

/** A part's relationships by id, with internal targets resolved to zip paths. */
export async function readRels(zip: JSZip, part: string): Promise<{ xml: Document | null; rels: Map<string, Rel> }> {
  const name = relsOf(part);
  const xml = await readXml(zip, name);
  const rels = new Map<string, Rel>();
  for (const el of Array.from(xml?.getElementsByTagName('Relationship') ?? [])) {
    const external = el.getAttribute('TargetMode') === 'External';
    const target = el.getAttribute('Target') ?? '';
    rels.set(el.getAttribute('Id') ?? '', { el, type: el.getAttribute('Type') ?? '', target: external ? target : resolveTarget(name, target), external });
  }
  return { xml, rels };
}

/** Drops a part along with the relationship and content type that point at it. */
export async function removePart(zip: JSZip, owner: string, part: string) {
  zip.remove(part);
  const { xml, rels } = await readRels(zip, owner);
  for (const r of rels.values()) if (!r.external && r.target === part) r.el.remove();
  if (xml) saveXml(zip, relsOf(owner), xml);
  await editXml(zip, '[Content_Types].xml', (types) => {
    for (const o of Array.from(types.getElementsByTagName('Override'))) if (o.getAttribute('PartName') === `/${part}`) o.remove();
    return true;
  });
}

// Characters XML 1.0 forbids, raw or as references, which some writers still put in text and Office tolerates.
const FORBIDDEN_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|&#(?:x0*(?:[0-8bBcCeEfF]|1[0-9a-fA-F])|0*(?:[0-8]|1[124-9]|2\d|3[01]));/g;

/** Decodes a part as its byte order mark or XML declaration says, as Office does, rather than always as UTF-8. */
export function xmlText(bytes: Uint8Array): string {
  const [a, b] = bytes;
  let encoding = 'utf-8';
  if ((a === 0xff && b === 0xfe) || (a === 0x3c && b === 0x00)) encoding = 'utf-16le';
  else if ((a === 0xfe && b === 0xff) || (a === 0x00 && b === 0x3c)) encoding = 'utf-16be';
  else if (!(a === 0xef && b === 0xbb)) encoding = new TextDecoder('latin1').decode(bytes.subarray(0, 200)).match(/^<\?xml[^>]*encoding=["']([\w.:-]+)["']/)?.[1] ?? encoding;
  let text: string;
  try {
    text = new TextDecoder(encoding).decode(bytes);
  } catch {
    text = new TextDecoder().decode(bytes);
  }
  return text.replace(FORBIDDEN_CHARS, '');
}

/**
 * Parses an XML part, or returns null when the file has none. A part that will not parse
 * stops the file from opening: skipping it would leave its text unredacted in the download.
 */
export async function readXml(zip: JSZip, name: string): Promise<Document | null> {
  const f = zip.file(name);
  if (!f) return null;
  const xml = new DOMParser().parseFromString(xmlText(await f.async('uint8array')), 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new FileError(`This file has a damaged part (${name}), so it cannot be redacted safely.`);
  return xml;
}

/** Serializes a part as the UTF-8 it is saved in, whatever encoding the file declared. */
export const xmlString = (xml: Document) => new XMLSerializer().serializeToString(xml).replace(/^(<\?xml[^>]*encoding=["'])[\w.:-]+/, '$1UTF-8');

export const saveXml = (zip: JSZip, name: string, xml: Document) => zip.file(name, xmlString(xml));

/** Refuses a file with any XML part the browser cannot parse, before the visitor reviews it rather than at the download. */
export async function checkParts(zip: JSZip) {
  for (const name of Object.keys(zip.files)) if (/\.(xml|rels)$/i.test(name) && !zip.files[name].dir) await readXml(zip, name);
}

export async function editXml(zip: JSZip, name: string, edit: (xml: Document) => boolean) {
  const xml = await readXml(zip, name);
  if (xml && edit(xml)) saveXml(zip, name, xml);
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

/** Office apps can save a picture of the first page or sheet in docProps; it would show the text before redaction. */
export async function removeThumbnail(zip: JSZip) {
  const { rels } = await readRels(zip, '');
  for (const r of rels.values()) if (r.type.endsWith('/thumbnail') && !r.external) await removePart(zip, '', r.target);
  for (const n of Object.keys(zip.files)) if (/^docProps\/thumbnail\.\w+$/i.test(n)) await removePart(zip, '', n);
}

/** Replaces each redacted string inside `value` with █, keeping spaces. */
export function maskStrings(value: string, redacted: Set<string>): string {
  let out = value;
  for (const t of redacted) if (t.trim()) out = out.split(t).join(t.replace(/\S/gu, '█'));
  return out;
}

/** Whether a link target is a mail address or holds redacted text. */
export function linkHidesText(target: string, redacted: Set<string>): boolean {
  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    // A stray % (a "5%" in a query string): compare the raw target.
  }
  return /^mailto:/i.test(decoded) || [...redacted].some((t) => decoded.includes(t) || target.includes(t));
}

/** Hyperlink targets live in .rels files; blank any that point at redacted text or a mail address. */
export async function scrubRelationships(zip: JSZip, redacted: Set<string>, parts = /^word\/_rels\/.*\.rels$/) {
  for (const name of Object.keys(zip.files).filter((n) => parts.test(n))) {
    await editXml(zip, name, (xml) => {
      let changed = false;
      for (const rel of Array.from(xml.getElementsByTagName('Relationship'))) {
        if (rel.getAttribute('TargetMode') !== 'External') continue;
        if (linkHidesText(rel.getAttribute('Target') ?? '', redacted)) {
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
  // Custom properties hold whatever the author or their systems added, such as a client name or case number.
  await editXml(zip, 'docProps/custom.xml', (xml) => {
    for (const p of Array.from(xml.getElementsByTagName('*')).filter((e) => e.localName === 'property')) p.remove();
    return true;
  });
  for (const [name, attrs] of Object.entries(PEOPLE)) {
    await editXml(zip, name, (xml) => {
      for (const el of Array.from(xml.getElementsByTagName('*'))) {
        for (const attr of Array.from(el.attributes)) if (attr.localName in attrs) attr.value = attrs[attr.localName];
      }
      return true;
    });
  }
}

/** The load notes Word and PowerPoint files share. */
export function officeNotes(zip: JSZip, root: 'word' | 'ppt', unreadable: number, extra: string[] = []): string[] {
  const notes = ['Author names and document properties are removed on download.', ...extra];
  if (unreadable) notes.push(`${unreadable} picture${unreadable > 1 ? 's' : ''} could not be opened and stay${unreadable > 1 ? '' : 's'} as ${unreadable > 1 ? 'they are' : 'it is'}.`);
  if (Object.keys(zip.files).some((n) => new RegExp(`^${root}/embeddings/[^/]+$`).test(n))) notes.push('Embedded files and chart data are removed on download.');
  return notes;
}

/** The last export steps Word and PowerPoint share: drop embeddings, redact pictures, scrub links and metadata, then zip. */
export async function packOffice(
  zip: JSZip,
  opts: { root: 'word' | 'ppt'; parts: Map<string, Document>; pictures: Picture[]; findings: Finding[]; marks: ManualMark[]; redacted: Set<string>; name: string; mime: string; progress: Progress },
): Promise<{ blob: Blob; filename: string }> {
  const { root, progress } = opts;
  await dropEmbeddings(zip, opts.parts, root);
  progress('Redacting pictures…');
  await writePictures(zip, opts.pictures, opts.findings, opts.marks);
  await scrubRelationships(zip, opts.redacted, new RegExp(`^${root}/.*_rels/.*\\.rels$`));
  await scrubProperties(zip);
  await removeThumbnail(zip);
  progress(root === 'word' ? 'Packing document…' : 'Packing presentation…');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: opts.mime });
  return { blob, filename: outputName(opts.name, root === 'word' ? 'docx' : 'pptx') };
}
