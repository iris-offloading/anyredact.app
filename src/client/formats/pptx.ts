import JSZip from 'jszip';
import { rewriteSegments } from '../../shared/segments.ts';
import { outputName, TEXT_STYLES, type Layout, type LoadedDoc, type Progress, type Unit } from '../types.ts';
import { collectAlts, enabledByUnit, loadPictures, readXml, relsOf, removeThumbnail, renamePictures, resolveTarget, scrubProperties, scrubRelationships, writeAlts, writePictures, type Alt, type Picture } from './office.ts';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const EMU_PER_PX = 9525;

interface Body {
  unit: Unit;
  /** Text nodes, with null for the line and paragraph breaks between them. */
  nodes: (Element | null)[];
  /** Original piece texts, so repeated exports always start from the source. */
  original: string[];
  /** Slides this text shows on, as indexes into the deck. */
  slides: number[];
}

interface Rel {
  type: string;
  target: string;
}

async function relsFor(zip: JSZip, part: string): Promise<Map<string, Rel>> {
  const out = new Map<string, Rel>();
  const xml = await readXml(zip, relsOf(part));
  for (const rel of Array.from(xml?.getElementsByTagName('Relationship') ?? [])) {
    if (rel.getAttribute('TargetMode') === 'External') continue;
    out.set(rel.getAttribute('Id') ?? '', { type: rel.getAttribute('Type') ?? '', target: resolveTarget(relsOf(part), rel.getAttribute('Target') ?? '') });
  }
  return out;
}

const relsOfType = (rels: Map<string, Rel>, type: RegExp) => [...rels.values()].filter((r) => type.test(r.type)).map((r) => r.target);

function placeholderOf(el: Element) {
  let n: Element | null = el;
  while (n && !(n.localName === 'sp' && n.namespaceURI === P)) n = n.parentElement;
  return n?.getElementsByTagNameNS(P, 'ph')[0];
}

/** Placeholder shapes on layouts and masters hold prompts such as "Click to edit Master title style". */
const inPlaceholder = (el: Element) => !!placeholderOf(el);
/** Slide numbers change with the deck and say nothing about anyone. */
const isSlideNumber = (el: Element) => placeholderOf(el)?.getAttribute('type') === 'sldNum';

/**
 * Every run of text in a part: each element holding DrawingML paragraphs
 * (shapes, table cells, SmartArt, modern comments) is one unit, and so is
 * each legacy comment.
 */
function bodiesOf(xml: Document, name: string, skip: (el: Element) => boolean): Omit<Body, 'slides'>[] {
  const out: Omit<Body, 'slides'>[] = [];
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
  for (const t of Array.from(xml.getElementsByTagNameNS(P, 'text'))) {
    const text = t.textContent ?? '';
    if (text.trim()) out.push({ unit: { id: `${name}#${out.length}`, text }, nodes: [t], original: [text] });
  }
  return out;
}

export async function loadPptx(file: File, progress: Progress): Promise<LoadedDoc> {
  progress('Opening PowerPoint file…');
  const zip = await JSZip.loadAsync(file);
  const presentation = await readXml(zip, 'ppt/presentation.xml');
  if (!presentation) throw new Error('This does not look like a PowerPoint (.pptx) file.');
  const presRels = await relsFor(zip, 'ppt/presentation.xml');
  const slides = Array.from(presentation.getElementsByTagNameNS(P, 'sldId'), (s) => presRels.get(s.getAttributeNS(R, 'id') ?? '')?.target).filter((t): t is string => !!t && !!zip.file(t));

  const parts = new Map<string, Document>();
  const bodies = new Map<string, Body>();
  const alts = new Map<string, Alt>();
  const hidden: number[] = [];
  // Text on a layout or master shows on every slide that uses it, so it is listed once, after the slides.
  const shared: Body[] = [];
  const read = async (name: string, skip: (el: Element) => boolean, extra: Partial<Unit> = {}) => {
    if (parts.has(name)) return [...bodies.values()].filter((b) => b.unit.id.startsWith(name + '#'));
    const xml = await readXml(zip, name);
    if (!xml) return [];
    parts.set(name, xml);
    collectAlts(xml, alts);
    return bodiesOf(xml, name, skip).map((b) => {
      const body = { ...b, unit: { ...b.unit, ...extra }, slides: [] };
      bodies.set(body.unit.id, body);
      return body;
    });
  };

  const units: Unit[] = [];
  for (const [i, slide] of slides.entries()) {
    progress(`Reading slides… ${i + 1} of ${slides.length}`);
    const n = i + 1;
    const onSlide = await read(slide, isSlideNumber);
    if (parts.get(slide)!.documentElement.getAttribute('show') === '0') hidden.push(n);
    const rels = await relsFor(zip, slide);
    const off: Body[] = [];
    for (const notes of relsOfType(rels, /\/notesSlide$/)) off.push(...(await read(notes, isSlideNumber, { section: `Slide ${n} notes` })));
    for (const comments of relsOfType(rels, /\/comments$/)) off.push(...(await read(comments, () => false, { section: `Slide ${n} comments` })));
    for (const diagram of relsOfType(rels, /\/diagram(Data|Drawing)$/)) {
      // The drawing repeats the data's text as laid out, so it is listed only when something is found in it.
      off.push(...(await read(diagram, () => false, { section: `Slide ${n} SmartArt`, quiet: /drawing\d*\.xml$/.test(diagram) })));
    }
    for (const layout of relsOfType(rels, /\/slideLayout$/)) {
      const masters = relsOfType(await relsFor(zip, layout), /\/slideMaster$/);
      for (const part of [layout, ...masters]) {
        for (const b of await read(part, inPlaceholder, { section: 'On every slide', quiet: true })) {
          if (!shared.includes(b)) shared.push(b);
          b.slides.push(i);
        }
      }
    }
    for (const b of onSlide) b.slides.push(i);
    units.push(...onSlide.map((b) => b.unit), ...off.map((b) => b.unit));
  }
  units.push(...shared.map((b) => b.unit));

  const { pictures, pages, units: pictureUnits, unreadable } = await loadPictures(zip, 'ppt/media/', progress);

  const notes = ['Author names and document properties are removed on download.'];
  if (hidden.length) notes.push(`Includes hidden slides: ${hidden.join(', ')}`);
  if (unreadable) notes.push(`${unreadable} picture${unreadable > 1 ? 's' : ''} in EMF, WMF or TIFF format could not be opened and stay as they are.`);
  if (Object.keys(zip.files).some((n) => /^ppt\/(charts|embeddings)\/[^/]+$/.test(n))) notes.push('Charts and embedded files stay as they are.');

  const size = presentation.getElementsByTagNameNS(P, 'sldSz')[0];
  const width = Math.round(Number(size?.getAttribute('cx') ?? 12192000) / EMU_PER_PX);
  const height = Math.round(Number(size?.getAttribute('cy') ?? 6858000) / EMU_PER_PX);

  return {
    kind: 'pptx',
    styles: TEXT_STYLES,
    name: file.name,
    units: [...units, ...[...alts.values()].map((a) => ({ ...a.unit, section: 'Alt text' })), ...pictureUnits],
    pages,
    notes,
    render: (container) => render(file, zip, slides.length, width, height, [...bodies.values()], pictures, container),
    async exportFile(findings, boxes, style) {
      const byUnit = enabledByUnit(findings);
      const redacted = new Set<string>();
      for (const b of bodies.values()) {
        const spans = byUnit.get(b.unit.id) ?? [];
        for (const f of spans) redacted.add(f.text);
        const next = spans.length ? rewriteSegments(b.original, spans, style) : b.original;
        b.nodes.forEach((n, i) => {
          if (n && n.textContent !== next[i]) n.textContent = next[i];
        });
      }
      writeAlts(alts, byUnit, style, redacted);
      const ser = new XMLSerializer();
      for (const [name, xml] of parts) {
        renamePictures(xml);
        zip.file(name, ser.serializeToString(xml));
      }
      // The file properties list each slide title.
      const app = await readXml(zip, 'docProps/app.xml');
      if (app) {
        const found = findings.filter((f) => f.enabled && f.text.trim());
        for (const s of Array.from(app.getElementsByTagName('*')).filter((e) => e.localName === 'lpstr')) {
          let text = s.textContent ?? '';
          for (const f of found) text = text.split(f.text).join(rewriteSegments([f.text], [{ start: 0, end: f.text.length, type: f.type }], style)[0]);
          s.textContent = text;
        }
        zip.file('docProps/app.xml', ser.serializeToString(app));
      }
      progress('Redacting pictures…');
      await writePictures(zip, pictures, findings, boxes);
      await scrubRelationships(zip, redacted, /^ppt\/.*_rels\/.*\.rels$/);
      await scrubProperties(zip);
      const custom = await readXml(zip, 'docProps/custom.xml');
      if (custom) {
        for (const p of Array.from(custom.getElementsByTagName('*')).filter((e) => e.localName === 'property')) p.remove();
        zip.file('docProps/custom.xml', ser.serializeToString(custom));
      }
      await removeThumbnail(zip);
      progress('Packing presentation…');
      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      });
      return { blob, filename: outputName(file.name, 'pptx') };
    },
  };
}

/** Laid-out text has no line breaks, and a line break inside a paragraph may show as a space. */
const key = (s: string) => s.replace(/\s+/g, '');

// What pptx-to-html draws with. It writes some values from the file (colors in charts) into
// attributes as they are, so a crafted deck could add elements of its own, such as a frame
// that loads outside scripts. Anything else is dropped before the slide is shown.
const TAGS = new Set(['div', 'span', 'ul', 'ol', 'li', 'br', 'img', 'table', 'colgroup', 'col', 'tbody', 'tr', 'td', 'svg', 'defs', 'marker', 'path', 'polyline', 'polygon', 'line', 'circle', 'text']);
const ATTRS = new Set(['class', 'style', 'src', 'colspan', 'rowspan', 'viewbox', 'overflow', 'd', 'points', 'fill', 'fill-opacity', 'stroke', 'stroke-width', 'vector-effect', 'marker-start', 'marker-end', 'id', 'markerunits', 'markerwidth', 'markerheight', 'refx', 'refy', 'orient', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'width', 'height', 'text-anchor', 'font-size']);

function sanitize(root: DocumentFragment) {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    // Skips what went with a removed parent.
    if (!root.contains(el)) continue;
    if (!TAGS.has(el.localName)) {
      el.remove();
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (!ATTRS.has(name) || (name === 'src' && !/^data:image\/(png|jpeg|gif|webp|bmp|svg\+xml|tiff);base64,/.test(attr.value))) el.removeAttribute(attr.name);
    }
  }
}

/**
 * Draws each slide with pptx-to-html, at the deck's own size. The renderer
 * leaves no trace of which shape became which element, so each text unit is
 * matched to the innermost element on its slide holding the same text.
 */
async function render(file: File, zip: JSZip, count: number, width: number, height: number, bodies: Body[], pictures: Picture[], container: HTMLElement): Promise<Layout> {
  const { pptxToHtml } = await import('@jvmr/pptx-to-html');
  const html = await pptxToHtml(await file.arrayBuffer(), { width, height });
  if (html.length !== count) throw new Error(`Laid out ${html.length} of ${count} slides`);
  const slides = html.map((s, i) => {
    const el = document.createElement('div');
    el.className = 'slide-page';
    el.setAttribute('aria-label', `Slide ${i + 1}`);
    // A template parses the markup without loading anything, so it can be cleaned first.
    const t = document.createElement('template');
    t.innerHTML = s;
    sanitize(t.content);
    // Markup that closed the slide early is left out with the rest of what falls outside it.
    const drawn = t.content.firstElementChild;
    if (drawn?.classList.contains('slide')) el.append(drawn);
    // A text box is a flex column, where a highlight would become a line of its own; one span keeps the text inline.
    for (const box of Array.from(el.querySelectorAll<HTMLElement>('div'))) {
      if (box.style.display !== 'flex' || !Array.from(box.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim())) continue;
      const span = document.createElement('span');
      span.append(...box.childNodes);
      box.append(span);
    }
    return el;
  });
  container.replaceChildren(...slides);

  const blocks = new Map<string, HTMLElement[]>();
  slides.forEach((slide, i) => {
    const all = Array.from(slide.querySelectorAll<HTMLElement>('.slide *'));
    const keys = new Map(all.map((el) => [el, key(el.textContent ?? '')]));
    // Innermost elements first: an element whose child holds the same text is only a wrapper.
    const inner = all.filter((el) => keys.get(el) && !Array.from(el.children).some((c) => keys.get(c as HTMLElement) === keys.get(el)));
    const used = new Set<HTMLElement>();
    for (const b of bodies) {
      if (!b.slides.includes(i)) continue;
      const want = key(b.unit.text);
      const el = inner.find((e) => !used.has(e) && keys.get(e) === want);
      if (!el) continue;
      used.add(el);
      (blocks.get(b.unit.id) ?? blocks.set(b.unit.id, []).get(b.unit.id)!).push(el);
    }
  });

  // Pictures come out as data URLs of the file in the package.
  const pageOf = new Map<string, number>();
  for (const p of pictures) if (p.page >= 0) pageOf.set(await zip.file(p.name)!.async('base64'), p.page);
  const placed: Layout['pictures'] = [];
  for (const img of Array.from(container.querySelectorAll('img'))) {
    const page = pageOf.get(img.src.slice(img.src.indexOf(',') + 1));
    if (page !== undefined) placed.push({ page, img });
  }
  return { blocks, pictures: placed };
}
