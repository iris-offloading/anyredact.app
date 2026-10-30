import JSZip from 'jszip';
import { rewriteSegments } from '../../shared/segments.ts';
import { enabledTexts, FileError, TEXT_STYLES, type Layout, type LoadedDoc, type Progress, type Unit } from '../types.ts';
import { checkParts, collectAlts, drawingText, enabledByUnit, loadPictures, officeNotes, packOffice, readRels, readXml, renamePictures, writeAlts, writeRun, xmlString, type Alt, type Picture, type Rel, type TextRun } from './office.ts';

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const EMU_PER_PX = 9525;

interface Body extends TextRun {
  /** Slides this text shows on, as indexes into the deck. */
  slides: number[];
}

async function relsFor(zip: JSZip, part: string): Promise<Map<string, Rel>> {
  return new Map([...(await readRels(zip, part)).rels].filter(([, r]) => !r.external));
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

/** Every run of text in a part, as drawingText finds it, and each legacy comment. */
function bodiesOf(xml: Document, name: string, skip: (el: Element) => boolean): TextRun[] {
  const out = drawingText(xml, name, skip);
  for (const t of Array.from(xml.getElementsByTagNameNS(P, 'text'))) {
    const text = t.textContent ?? '';
    if (text.trim()) out.push({ unit: { id: `${name}#${out.length}`, text }, nodes: [t], original: [text] });
  }
  return out;
}

export async function loadPptx(file: File, progress: Progress): Promise<LoadedDoc> {
  progress('Opening PowerPoint file…');
  const zip = await JSZip.loadAsync(file);
  await checkParts(zip);
  const presentation = await readXml(zip, 'ppt/presentation.xml');
  if (!presentation) throw new FileError('This does not look like a PowerPoint (.pptx) file.');
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
    for (const chart of relsOfType(rels, /\/chart(Ex)?$/)) {
      const shapes = relsOfType(await relsFor(zip, chart), /\/chartUserShapes$/);
      for (const part of [chart, ...shapes]) off.push(...(await read(part, () => false, { section: `Slide ${n} chart` })));
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

  const notes = officeNotes(zip, 'ppt', unreadable, hidden.length ? [`Includes hidden slides: ${hidden.join(', ')}`] : []);

  const size = presentation.getElementsByTagNameNS(P, 'sldSz')[0];
  const width = Math.round(Number(size?.getAttribute('cx') ?? 12192000) / EMU_PER_PX);
  const height = Math.round(Number(size?.getAttribute('cy') ?? 6858000) / EMU_PER_PX);

  return {
    kind: 'pptx',
    styles: TEXT_STYLES,
    units: [...units, ...[...alts.values()].map((a) => ({ ...a.unit, section: 'Alt text' })), ...pictureUnits],
    pages,
    notes,
    render: (container) => render(file, zip, slides.length, width, height, [...bodies.values()], pictures, container),
    async exportFile(findings, boxes, style, say = progress) {
      const byUnit = enabledByUnit(findings);
      const redacted = enabledTexts(findings);
      for (const b of bodies.values()) {
        const spans = byUnit.get(b.unit.id) ?? [];
        writeRun(b, spans, style);
      }
      writeAlts(alts, byUnit, style, redacted);
      for (const [name, xml] of parts) {
        renamePictures(xml);
        zip.file(name, xmlString(xml));
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
        zip.file('docProps/app.xml', xmlString(app));
      }
      return packOffice(zip, { root: 'ppt', parts, pictures, findings, marks: boxes, redacted, name: file.name, progress: say, mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
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
