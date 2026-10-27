import { parseAsync, renderDocument } from 'docx-preview';
import JSZip from 'jszip';
import { rewriteSegments } from '../../shared/segments.ts';
import { enabledTexts, TEXT_STYLES, type Layout, type LoadedDoc, type Progress, type Unit } from '../types.ts';
import { collectAlts, drawingText, editXml, enabledByUnit, maskStrings, loadPictures, officeNotes, packOffice, readXml, renamePictures, writeAlts, writeRun, type Alt, type Picture, type TextRun } from './office.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const TEXT_PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;
// Text-bearing elements: visible text, deleted (tracked) text and field codes such as HYPERLINK "mailto:…".
const TEXT_TAGS = new Set(['t', 'delText', 'instrText']);
// Run-level breaks become whitespace in the detection text so words and numbers don't run together.
const BREAKS: Record<string, string> = { br: '\n', cr: '\n', tab: '\t' };
const CHART_PARTS = /^word\/charts\/chart(Ex)?\d*\.xml$/;

function textOf(el: Element): string {
  return TEXT_TAGS.has(el.localName) ? (el.textContent ?? '') : BREAKS[el.localName];
}

interface Para {
  unit: Unit;
  el: Element;
  nodes: Element[];
  /** Original node texts, so repeated exports always start from the source. */
  original: string[];
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
    for (const [el, nodes] of byPara) {
      const original = nodes.map(textOf);
      const text = original.join('');
      if (!text.trim()) continue;
      paras.push({ unit: { id: `${name}#${i++}`, text }, el, nodes, original });
    }
    // Word writes the same description on docPr and cNvPr; one unit covers both.
    collectAlts(xml, alts);
  }
  if (!parts.has('word/document.xml')) throw new Error('This does not look like a Word (.docx) document.');
  // Chart titles, labels and series names.
  const charts: TextRun[] = [];
  for (const name of Object.keys(zip.files).filter((n) => CHART_PARTS.test(n))) {
    const xml = await readXml(zip, name);
    if (!xml) continue;
    parts.set(name, xml);
    charts.push(...drawingText(xml, name).map((r) => ({ ...r, unit: { ...r.unit, section: 'Charts' } })));
  }

  const { pictures, pages, units: pictureUnits, unreadable } = await loadPictures(zip, 'word/media/', progress);

  const notes = officeNotes(zip, 'word', unreadable);

  return {
    kind: 'docx',
    styles: TEXT_STYLES,
    units: [...paras.map((p) => p.unit), ...charts.map((c) => c.unit), ...[...alts.values()].map((a) => a.unit), ...pictureUnits],
    pages,
    notes,
    render: (container) => render(file, parts, paras, pictures, container),
    async exportFile(findings, boxes, style, say = progress) {
      const byUnit = enabledByUnit(findings);
      const redacted = enabledTexts(findings);
      for (const p of paras) {
        const spans = byUnit.get(p.unit.id) ?? [];
        const next = spans.length ? rewriteSegments(p.original, spans, style) : p.original;
        p.nodes.forEach((n, i) => {
          if (!TEXT_TAGS.has(n.localName) || n.textContent === next[i]) return;
          n.textContent = next[i];
          if (n.localName !== 'instrText') n.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
        });
      }
      for (const c of charts) {
        const spans = byUnit.get(c.unit.id) ?? [];
        writeRun(c, spans, style);
      }
      writeAlts(alts, byUnit, style, redacted);
      const ser = new XMLSerializer();
      for (const [name, xml] of parts) {
        // Tracked changes and comments carry their authors' names.
        for (const el of Array.from(xml.getElementsByTagNameNS(W, '*'))) {
          if (el.hasAttributeNS(W, 'author')) el.setAttributeNS(W, 'w:author', 'Redacted');
          if (el.hasAttributeNS(W, 'initials')) el.setAttributeNS(W, 'w:initials', 'R');
          // Simple fields keep their code in an attribute, such as HYPERLINK "mailto:…".
          if (el.localName === 'fldSimple' && el.hasAttributeNS(W, 'instr')) el.setAttributeNS(W, 'w:instr', maskStrings(el.getAttributeNS(W, 'instr')!, redacted));
          // A bound content control is refilled from customXml when Word opens the file; unbind it so it keeps the redacted text.
          if (el.localName === 'dataBinding') el.remove();
        }
        renamePictures(xml);
        zip.file(name, ser.serializeToString(xml));
      }
      await maskCustomXml(zip, redacted);
      return packOffice(zip, { root: 'word', parts, pictures, findings, marks: boxes, redacted, name: file.name, progress: say, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    },
  };
}

/** Content controls bound to customXml/item*.xml hold a second copy of their text there. */
async function maskCustomXml(zip: JSZip, redacted: Set<string>) {
  if (!redacted.size) return;
  for (const name of Object.keys(zip.files).filter((n) => /^customXml\/item\d+\.xml$/.test(n))) {
    await editXml(zip, name, (xml) => {
      let changed = false;
      const walker = xml.createTreeWalker(xml.documentElement, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      for (let n: Node | null = walker.currentNode; n; n = walker.nextNode()) {
        if (n.nodeType === Node.TEXT_NODE) {
          const next = maskStrings(n.nodeValue ?? '', redacted);
          if (next !== n.nodeValue) (n.nodeValue = next), (changed = true);
        } else {
          for (const a of Array.from((n as Element).attributes)) {
            const next = maskStrings(a.value, redacted);
            if (next !== a.value) (a.value = next), (changed = true);
          }
        }
      }
      return changed;
    });
  }
}

/**
 * Lays out the document with docx-preview. A bookmark at the start of each
 * paragraph shows where its unit lands; the bookmarks go into a copy of the
 * package, so the download never carries them.
 */
async function render(file: File, parts: Map<string, Document>, paras: Para[], pictures: Picture[], container: HTMLElement): Promise<Layout> {
  const marks = paras.map((p, i) => {
    const b = p.el.ownerDocument.createElementNS(W, 'w:bookmarkStart');
    b.setAttributeNS(W, 'w:id', String(1e9 + i));
    b.setAttributeNS(W, 'w:name', `anyredact-${i}`);
    const props = Array.from(p.el.children).find((c) => c.localName === 'pPr');
    p.el.insertBefore(b, props ? props.nextSibling : p.el.firstChild);
    return b;
  });
  const copy = await JSZip.loadAsync(file);
  const ser = new XMLSerializer();
  for (const [name, xml] of parts) copy.file(name, ser.serializeToString(xml));
  for (const b of marks) b.remove();

  // Tracked deletions stay in the file until redacted, so show them as Word does.
  // Alt chunks are HTML pages inside the file; docx-preview would load them, scripts included, in a same-origin frame.
  const options = { renderChanges: true, renderAltChunks: false };
  const doc = await parseAsync(await copy.generateAsync({ type: 'blob', compression: 'STORE' }), options);
  // Note which part each picture came from, so the editor can take its place.
  const sources = new Map<string, string>();
  const loadImage = doc.loadDocumentImage.bind(doc);
  doc.loadDocumentImage = async (id: string, part: unknown) => {
    const url = await loadImage(id, part);
    const path = doc.getPathById(part ?? doc.documentPart, id);
    if (url && path) sources.set(url, path);
    return url;
  };
  container.replaceChildren(...(await renderDocument(doc, options)));

  const blocks = new Map<string, HTMLElement[]>();
  paras.forEach((p, i) => {
    // Headers and footers repeat on every page.
    const found = Array.from(container.querySelectorAll<HTMLElement>(`[id="anyredact-${i}"]`), (span) => span.parentElement!);
    if (found.length) blocks.set(p.unit.id, found);
  });
  const pageOf = new Map(pictures.filter((p) => p.page >= 0).map((p) => [p.name, p.page]));
  const placed: Layout['pictures'] = [];
  for (const img of Array.from(container.querySelectorAll('img'))) {
    const page = pageOf.get(sources.get(img.src) ?? '');
    if (page !== undefined) placed.push({ page, img });
  }
  return { blocks, pictures: placed };
}
