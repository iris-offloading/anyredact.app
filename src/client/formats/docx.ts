import JSZip from 'jszip';
import { rewriteSegments } from '../../shared/segments.ts';
import { burnBoxes, canvasToBlob, outputName, rectsForPage, type LoadedDoc, type Page, type Progress, type Unit } from '../types.ts';
import { ocrUnit } from './ocr.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const TEXT_PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;
// Text-bearing elements: visible text, deleted (tracked) text and field codes such as HYPERLINK "mailto:…".
const TEXT_TAGS = new Set(['t', 'delText', 'instrText']);
// Run-level breaks become whitespace in the detection text so words and numbers don't run together.
const BREAKS: Record<string, string> = { br: '\n', cr: '\n', tab: '\t' };
// Pictures the browser can decode; EMF, WMF and TIFF are left as they are.
const PICTURE = /^word\/media\/[^/]+\.(png|jpe?g|gif|bmp|webp)$/i;
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };
const MAX_SIDE = 6000;
// Bullets, rules and icons: re-encoded on download but not shown for review.
const MIN_REVIEW_SIDE = 48;
// Alt text and titles on pictures and shapes (DrawingML docPr/cNvPr, VML shapes).
const ALT_ATTRS: Record<string, string[]> = { docPr: ['descr', 'title'], cNvPr: ['descr', 'title'], shape: ['alt'], imagedata: ['title'] };

function textOf(el: Element): string {
  return TEXT_TAGS.has(el.localName) ? (el.textContent ?? '') : BREAKS[el.localName];
}

interface Para {
  unit: Unit;
  nodes: Element[];
  /** Original node texts, so repeated exports always start from the source. */
  original: string[];
}

interface Alt {
  unit: Unit;
  attrs: Attr[];
}

interface Picture {
  name: string;
  canvas: HTMLCanvasElement;
  /** Index into the editor pages, or -1 when too small to review. */
  page: number;
  /** Set once the picture had to be saved as PNG under a new name. */
  renamed?: string;
}

function ownParagraph(el: Element): Element | null {
  let n = el.parentElement;
  while (n && !(n.localName === 'p' && n.namespaceURI === W)) n = n.parentElement;
  return n;
}

export async function loadDocx(file: File, progress: Progress): Promise<LoadedDoc> {
  progress('Opening Word document…');
  const zip = await JSZip.loadAsync(file);
  const parts = new Map<string, Document>();
  const paras: Para[] = [];
  const alts = new Map<string, Alt>();
  const names = Object.keys(zip.files).filter((n) => TEXT_PARTS.test(n));
  // Body first, then headers/footers/notes, so the preview reads naturally.
  names.sort((a, b) => Number(b === 'word/document.xml') - Number(a === 'word/document.xml') || a.localeCompare(b));
  for (const name of names) {
    const xml = new DOMParser().parseFromString(await zip.file(name)!.async('string'), 'application/xml');
    if (xml.getElementsByTagName('parsererror').length) continue;
    parts.set(name, xml);
    const byPara = new Map<Element, Element[]>();
    for (const el of Array.from(xml.getElementsByTagNameNS(W, '*'))) {
      const isBreak = el.localName in BREAKS && el.parentElement?.localName === 'r';
      if (!TEXT_TAGS.has(el.localName) && !isBreak) continue;
      const p = ownParagraph(el);
      if (!p) continue;
      if (!byPara.has(p)) byPara.set(p, []);
      byPara.get(p)!.push(el);
    }
    let i = 0;
    for (const nodes of byPara.values()) {
      const original = nodes.map(textOf);
      const text = original.join('');
      if (!text.trim()) continue;
      paras.push({ unit: { id: `${name}#${i++}`, text }, nodes, original });
    }
    for (const el of Array.from(xml.getElementsByTagName('*'))) {
      for (const attr of Array.from(el.attributes)) {
        if (!ALT_ATTRS[el.localName]?.includes(attr.localName) || !attr.value.trim()) continue;
        // Word writes the same description on docPr and cNvPr; one unit covers both.
        if (!alts.has(attr.value)) alts.set(attr.value, { unit: { id: `alt#${alts.size}`, text: attr.value }, attrs: [] });
        alts.get(attr.value)!.attrs.push(attr);
      }
    }
  }
  if (!parts.has('word/document.xml')) throw new Error('This does not look like a Word (.docx) document.');

  const pictures: Picture[] = [];
  const pages: Page[] = [];
  const pictureUnits: Unit[] = [];
  let unreadable = 0;
  const media = Object.keys(zip.files).filter((n) => n.startsWith('word/media/') && !zip.files[n].dir);
  for (const name of media) {
    if (!PICTURE.test(name)) {
      unreadable++;
      continue;
    }
    progress(`Opening pictures… ${pictures.length + 1} of ${media.length}`);
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    let canvas: HTMLCanvasElement;
    try {
      canvas = await decode(new Blob([await zip.file(name)!.async('arraybuffer')], { type: MIME[ext] }));
    } catch (err) {
      console.warn(name, err);
      unreadable++;
      continue;
    }
    const review = Math.max(canvas.width, canvas.height) >= MIN_REVIEW_SIDE;
    pictures.push({ name, canvas, page: review ? pages.length : -1 });
    if (!review) continue;
    const index = pages.length;
    pages.push({ index, canvas, label: `Picture ${index + 1}` });
    try {
      pictureUnits.push(await ocrUnit(`picture#${index}`, index, canvas, progress));
    } catch (err) {
      console.error(err);
      pictureUnits.push({ id: `picture#${index}`, page: index, text: '' });
    }
  }

  const notes = ['Author names and document properties are removed on download.'];
  if (unreadable) notes.push(`${unreadable} picture${unreadable > 1 ? 's' : ''} in EMF, WMF or TIFF format could not be opened and stay as they are.`);

  return {
    kind: 'docx',
    name: file.name,
    units: [...paras.map((p) => p.unit), ...[...alts.values()].map((a) => a.unit), ...pictureUnits],
    pages,
    notes,
    async exportFile(findings, boxes, style) {
      const byUnit = new Map<string, typeof findings>();
      for (const f of findings) if (f.enabled) (byUnit.get(f.unitId) ?? byUnit.set(f.unitId, []).get(f.unitId)!).push(f);
      const redacted = new Set<string>();
      for (const p of paras) {
        const spans = byUnit.get(p.unit.id) ?? [];
        for (const f of spans) redacted.add(f.text);
        const next = spans.length ? rewriteSegments(p.original, spans, style) : p.original;
        p.nodes.forEach((n, i) => {
          if (!TEXT_TAGS.has(n.localName) || n.textContent === next[i]) return;
          n.textContent = next[i];
          if (n.localName !== 'instrText') n.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
        });
      }
      for (const a of alts.values()) {
        const spans = byUnit.get(a.unit.id) ?? [];
        for (const f of spans) redacted.add(f.text);
        const next = spans.length ? rewriteSegments([a.unit.text], spans, style)[0] : a.unit.text;
        for (const attr of a.attrs) attr.value = next;
      }
      const ser = new XMLSerializer();
      for (const [name, xml] of parts) {
        // Tracked changes and comments carry their authors' names.
        for (const el of Array.from(xml.getElementsByTagNameNS(W, '*'))) {
          if (el.hasAttributeNS(W, 'author')) el.setAttributeNS(W, 'w:author', 'Redacted');
          if (el.hasAttributeNS(W, 'initials')) el.setAttributeNS(W, 'w:initials', 'R');
        }
        // Pictures keep the file name they were inserted from, such as "Jane passport.jpg".
        for (const el of Array.from(xml.getElementsByTagName('*'))) {
          if ((el.localName === 'docPr' || el.localName === 'cNvPr') && /\.\w{2,4}$/.test(el.getAttribute('name') ?? '')) el.setAttribute('name', 'Picture');
        }
        zip.file(name, ser.serializeToString(xml));
      }
      progress('Redacting pictures…');
      for (const pic of pictures) {
        // Re-encoding through a canvas writes pixels only, so EXIF, GPS, XMP and text chunks are left behind.
        const out = pic.page < 0 ? pic.canvas : burnBoxes(pic.canvas, rectsForPage(pic.page, findings, boxes));
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
      await scrubRelationships(zip, redacted);
      await scrubProperties(zip);
      await removeThumbnail(zip);
      progress('Packing document…');
      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      return { blob, filename: outputName(file.name, 'docx') };
    },
  };
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
function resolveTarget(relsName: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const base = relsName.replace(/_rels\/[^/]*\.rels$/, '').split('/').filter(Boolean);
  for (const seg of target.split('/')) {
    if (seg === '..') base.pop();
    else if (seg && seg !== '.') base.push(seg);
  }
  return base.join('/');
}

async function editXml(zip: JSZip, name: string, edit: (xml: Document) => boolean) {
  const f = zip.file(name);
  if (!f) return;
  const xml = new DOMParser().parseFromString(await f.async('string'), 'application/xml');
  if (edit(xml)) zip.file(name, new XMLSerializer().serializeToString(xml));
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

/** Word can save a picture of the first page in docProps; it would show the text before redaction. */
async function removeThumbnail(zip: JSZip) {
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
async function scrubRelationships(zip: JSZip, redacted: Set<string>) {
  for (const name of Object.keys(zip.files).filter((n) => /^word\/_rels\/.*\.rels$/.test(n))) {
    const xml = new DOMParser().parseFromString(await zip.file(name)!.async('string'), 'application/xml');
    let changed = false;
    for (const rel of Array.from(xml.getElementsByTagName('Relationship'))) {
      if (rel.getAttribute('TargetMode') !== 'External') continue;
      const target = decodeURIComponent(rel.getAttribute('Target') ?? '');
      if (/^mailto:/i.test(target) || [...redacted].some((t) => target.includes(t))) {
        rel.setAttribute('Target', 'about:blank');
        changed = true;
      }
    }
    if (changed) zip.file(name, new XMLSerializer().serializeToString(xml));
  }
}

async function scrubProperties(zip: JSZip) {
  const blank: Record<string, string[]> = {
    'docProps/core.xml': ['creator', 'lastModifiedBy', 'title', 'subject', 'description', 'keywords', 'category'],
    'docProps/app.xml': ['Company', 'Manager'],
  };
  for (const [name, tags] of Object.entries(blank)) {
    const f = zip.file(name);
    if (!f) continue;
    const xml = new DOMParser().parseFromString(await f.async('string'), 'application/xml');
    for (const el of Array.from(xml.getElementsByTagName('*'))) if (tags.includes(el.localName)) el.textContent = '';
    zip.file(name, new XMLSerializer().serializeToString(xml));
  }
  // word/people.xml lists everyone who tracked changes or commented.
  const people = zip.file('word/people.xml');
  if (people) {
    const xml = new DOMParser().parseFromString(await people.async('string'), 'application/xml');
    for (const el of Array.from(xml.getElementsByTagName('*'))) {
      for (const attr of Array.from(el.attributes)) {
        if (attr.localName === 'author' || attr.localName === 'userId') attr.value = 'Redacted';
      }
    }
    zip.file('word/people.xml', new XMLSerializer().serializeToString(xml));
  }
}
