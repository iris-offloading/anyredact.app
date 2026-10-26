import JSZip from 'jszip';
import { rewriteSegments } from '../../shared/segments.ts';
import { outputName, type LoadedDoc, type Progress, type Unit } from '../types.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const TEXT_PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;
// Text-bearing elements: visible text, deleted (tracked) text and field codes such as HYPERLINK "mailto:…".
const TEXT_TAGS = new Set(['t', 'delText', 'instrText']);

interface Para {
  unit: Unit;
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
  const names = Object.keys(zip.files).filter((n) => TEXT_PARTS.test(n));
  // Body first, then headers/footers/notes, so the preview reads naturally.
  names.sort((a, b) => Number(b === 'word/document.xml') - Number(a === 'word/document.xml') || a.localeCompare(b));
  for (const name of names) {
    const xml = new DOMParser().parseFromString(await zip.file(name)!.async('string'), 'application/xml');
    if (xml.getElementsByTagName('parsererror').length) continue;
    parts.set(name, xml);
    const byPara = new Map<Element, Element[]>();
    for (const el of Array.from(xml.getElementsByTagNameNS(W, '*'))) {
      if (!TEXT_TAGS.has(el.localName)) continue;
      const p = ownParagraph(el);
      if (!p) continue;
      if (!byPara.has(p)) byPara.set(p, []);
      byPara.get(p)!.push(el);
    }
    let i = 0;
    for (const nodes of byPara.values()) {
      const original = nodes.map((n) => n.textContent ?? '');
      const text = original.join('');
      if (!text.trim()) continue;
      paras.push({ unit: { id: `${name}#${i++}`, text }, nodes, original });
    }
  }
  if (!parts.has('word/document.xml')) throw new Error('This does not look like a Word (.docx) document.');

  return {
    kind: 'docx',
    name: file.name,
    units: paras.map((p) => p.unit),
    pages: [],
    notes: [
      'Images embedded in the document are not scanned. Author names and document properties are removed on download.',
    ],
    async exportFile(findings, _boxes, style) {
      const byUnit = new Map<string, typeof findings>();
      for (const f of findings) if (f.enabled) (byUnit.get(f.unitId) ?? byUnit.set(f.unitId, []).get(f.unitId)!).push(f);
      const redacted = new Set<string>();
      for (const p of paras) {
        const spans = byUnit.get(p.unit.id) ?? [];
        for (const f of spans) redacted.add(f.text);
        const next = spans.length ? rewriteSegments(p.original, spans, style) : p.original;
        p.nodes.forEach((n, i) => {
          if (n.textContent === next[i]) return;
          n.textContent = next[i];
          if (n.localName !== 'instrText') n.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
        });
      }
      const ser = new XMLSerializer();
      for (const [name, xml] of parts) {
        // Tracked changes and comments carry their authors' names.
        for (const el of Array.from(xml.getElementsByTagNameNS(W, '*'))) {
          if (el.hasAttributeNS(W, 'author')) el.setAttributeNS(W, 'w:author', 'Redacted');
          if (el.hasAttributeNS(W, 'initials')) el.setAttributeNS(W, 'w:initials', 'R');
        }
        zip.file(name, ser.serializeToString(xml));
      }
      await scrubRelationships(zip, redacted);
      await scrubProperties(zip);
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
