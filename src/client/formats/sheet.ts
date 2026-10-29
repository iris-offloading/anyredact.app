import { numfmt } from '@univerjs/core';
import BUILTIN_FORMATS from 'exceljs/lib/xlsx/defaultnumformats.js';
import JSZip from 'jszip';
import { rewriteSegments } from '../../shared/segments.ts';
import { enabledTexts, FileError, outputName, type Finding, type LoadedDoc, type Progress, type RedactStyle, type Unit } from '../types.ts';
import { checkParts, enabledByUnit, linkHidesText, readRels, readXml, removePart, removeThumbnail, saveXml, scrubProperties, scrubRelationships } from './office.ts';
import type { GridCell, SheetMeta } from './sheet-view.ts';

// Spreadsheets are edited in place, like DOCX: only the text of redacted cells
// changes, so styles, column widths, charts and pivot tables survive. Each row
// is one detection unit (cells joined by tabs) so a name sits next to its email.

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
const TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
const STYLE = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
const CALCEXT = 'urn:org:documentfoundation:names:experimental:calc:xmlns:calcext:1.0';
const DC = 'http://purl.org/dc/elements/1.1/';
const META = 'urn:oasis:names:tc:opendocument:xmlns:meta:1.0';
const MANIFEST = 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0';
const XLINK = 'http://www.w3.org/1999/xlink';
// Header and footer fields that the app fills in when printing.
const ODF_FIELDS = new Set(['date', 'time', 'page-number', 'page-count', 'sheet-name', 'title', 'file-name']);

/** Text stored across one or more nodes; null nodes are separators that are read but never written. */
interface Cell {
  original: string[];
  write(next: string[]): void;
  /** Zero-based grid position, for worksheet cells. */
  at?: { row: number; col: number };
}

interface Block {
  unit: Unit;
  cells: Cell[];
  grid: GridCell[];
}

interface Workbook {
  blocks: Block[];
  sheets: SheetMeta[];
  /** Applies the cell edits that need the whole workbook, scrubs metadata and writes every part back. */
  finish(changed: Map<string, string>, redacted: Set<string>): Promise<void>;
}

const kids = (el: Element, ns: string, name: string) => Array.from(el.children).filter((c) => c.namespaceURI === ns && c.localName === name);
const kid = (el: Element, ns: string, name: string) => kids(el, ns, name)[0] as Element | undefined;
const preserve = (t: Element) => t.setAttributeNS(XML_NS, 'xml:space', 'preserve');

function block(id: string, section: string, cells: Cell[], sheet?: string): Block {
  const grid: GridCell[] = [];
  let pos = 0;
  for (const c of cells) {
    const len = c.original.join('').length;
    if (sheet !== undefined && c.at) grid.push({ sheet, ...c.at, start: pos, end: pos + len });
    pos += len + 1;
  }
  return { unit: { id, section, text: cells.map((c) => c.original.join('')).join('\t') }, cells, grid };
}

/** A cell whose pieces are the text of the given nodes, with null marking a read-only separator. */
function nodeCell(pieces: { text: string; node: Node | null }[], after?: (next: string[]) => void): Cell {
  return {
    original: pieces.map((p) => p.text),
    write(next) {
      pieces.forEach((p, i) => {
        if (!p.node || p.node.textContent === next[i]) return;
        p.node.textContent = next[i];
        if (p.node instanceof Element && p.node.localName === 't') preserve(p.node);
      });
      after?.(next);
    },
  };
}

export async function loadSheet(file: File, progress: Progress): Promise<LoadedDoc> {
  progress('Opening spreadsheet…');
  const ods = /\.ods$/i.test(file.name);
  const open = async () => {
    const zip = await JSZip.loadAsync(file);
    await checkParts(zip);
    return { zip, book: ods ? await readOds(zip) : await readXlsx(zip) };
  };
  const { book } = await open();
  const notes = ['Pictures, text boxes and chart titles are not scanned. Author names and file properties are cleared from the download.'];
  const hidden = book.sheets.filter((s) => s.hidden).map((s) => s.name);
  if (hidden.length) notes.push(`Includes hidden sheets: ${hidden.join(', ')}.`);
  const units = book.blocks.map((b) => b.unit);
  const grid = new Map(book.blocks.filter((b) => b.grid.length).map((b) => [b.unit.id, b.grid]));

  return {
    kind: 'sheet',
    units,
    pages: [],
    notes,
    gridUnits: new Set(grid.keys()),
    async mountView(el, on) {
      const { mountSheetView } = await import('./sheet-view.ts');
      return mountSheetView(el, { sheets: book.sheets, units, grid, xlsx: ods ? undefined : await file.arrayBuffer() }, on);
    },
    async exportFile(findings, _boxes, style, say = progress) {
      // Start from the original file each time, since redaction changes cell types.
      const { zip, book } = await open();
      const { changed, redacted } = applyFindings(book.blocks, findings, style);
      await book.finish(changed, redacted);
      say('Packing spreadsheet…');
      if (ods) zip.file('mimetype', 'application/vnd.oasis.opendocument.spreadsheet', { compression: 'STORE' });
      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        mimeType: ods ? 'application/vnd.oasis.opendocument.spreadsheet' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      return { blob, filename: outputName(file.name, ods ? 'ods' : 'xlsx') };
    },
  };
}

/** Rewrites every block with enabled findings; returns the old to new text of each changed cell. */
function applyFindings(blocks: Block[], findings: Finding[], style: RedactStyle) {
  const byUnit = enabledByUnit(findings);
  const redacted = enabledTexts(findings);
  const changed = new Map<string, string>();
  for (const b of blocks) {
    const spans = byUnit.get(b.unit.id);
    if (!spans) continue;
    const flat = b.cells.flatMap((c, i) => (i ? ['\t', ...c.original] : c.original));
    const next = rewriteSegments(flat, spans, style);
    let pos = 0;
    b.cells.forEach((c, i) => {
      if (i) pos++;
      const mine = next.slice(pos, pos + c.original.length);
      pos += c.original.length;
      if (mine.every((t, j) => t === c.original[j])) return;
      c.write(mine);
      changed.set(c.original.join(''), mine.join(''));
    });
  }
  return { changed, redacted };
}

// ---------------------------------------------------------------- XLSX

/** Formats a number cell's stored value with its number format (dates, phone and ID patterns), as Excel displays it. */
async function numberFormats(zip: JSZip, stylesPath: string | undefined, book: Document): Promise<(value: string, style: string | null) => string> {
  const styles = stylesPath ? await readXml(zip, stylesPath) : null;
  if (!styles) return (v) => v;
  const S = styles.documentElement.namespaceURI ?? '';
  const custom = new Map(Array.from(styles.getElementsByTagNameNS(S, 'numFmt'), (f) => [f.getAttribute('numFmtId'), f.getAttribute('formatCode') ?? '']));
  const xfs = styles.getElementsByTagNameNS(S, 'cellXfs')[0];
  const patterns = Array.from(xfs?.getElementsByTagNameNS(S, 'xf') ?? [], (xf) => {
    const id = xf.getAttribute('numFmtId') ?? '0';
    const builtin = BUILTIN_FORMATS[id];
    return custom.get(id) ?? builtin?.f ?? builtin?.['en-us'] ?? 'General';
  });
  // Workbooks from old Mac Excel count dates from 1904.
  const pr = book.getElementsByTagNameNS(book.documentElement.namespaceURI ?? '', 'workbookPr')[0];
  const offset1904 = /^(1|true)$/.test(pr?.getAttribute('date1904') ?? '') ? 1462 : 0;
  return (value, style) => {
    const pattern = patterns[Number(style ?? 0)] ?? 'General';
    const n = Number(value);
    if (pattern === 'General' || !value.trim() || !Number.isFinite(n)) return value;
    try {
      return numfmt.format(pattern, numfmt.isDateFormat(pattern) ? n + offset1904 : n) || value;
    } catch {
      return value;
    }
  };
}

async function readXlsx(zip: JSZip): Promise<Workbook> {
  const root = await readRels(zip, '');
  const bookPath = [...root.rels.values()].find((r) => r.type.endsWith('/officeDocument'))?.target ?? 'xl/workbook.xml';
  const book = await readXml(zip, bookPath);
  if (!book) throw new FileError('This does not look like an Excel (.xlsx) workbook.');
  const S = book.documentElement.namespaceURI ?? '';
  const bookRels = (await readRels(zip, bookPath)).rels;
  const relTarget = (suffix: string) => [...bookRels.values()].find((r) => r.type.endsWith(suffix))?.target;
  const parts = new Map<string, Document>([[bookPath, book]]);
  const blocks: Block[] = [];
  const sheetList: SheetMeta[] = [];

  // Shared strings: each <si> may be used by many cells, so edits are collected and settled in finish().
  const sstPath = relTarget('/sharedStrings');
  const sst = sstPath ? await readXml(zip, sstPath) : null;
  if (sst && sstPath) parts.set(sstPath, sst);
  const items = sst ? kids(sst.documentElement, S, 'si') : [];
  const refs = new Array<number>(items.length).fill(0);
  const sstWrites: { cell: Element; idx: number; next: string[] }[] = [];
  const textNodes = (el: Element) => Array.from(el.getElementsByTagNameNS(S, 't')).filter((t) => t.parentElement?.localName !== 'rPh');
  const setTexts = (el: Element, next: string[]) => {
    textNodes(el).forEach((t, i) => {
      t.textContent = next[i];
      preserve(t);
    });
    // Phonetic guides repeat the reading of the original text.
    for (const ph of Array.from(el.getElementsByTagNameNS(S, 'rPh'))) ph.remove();
  };

  const shown = await numberFormats(zip, relTarget('/styles'), book);

  let formulasRemoved = false;
  const droppedShared = new Map<Document, Set<string>>();
  /** Turns a value or formula cell into plain text. */
  const toInline = (c: Element, text: string) => {
    const doc = c.ownerDocument;
    const f = kid(c, S, 'f');
    if (f) {
      // Other cells may share this formula's definition; they keep their values instead.
      if (f.getAttribute('t') === 'shared' && f.hasAttribute('ref')) {
        (droppedShared.get(doc) ?? droppedShared.set(doc, new Set()).get(doc)!).add(f.getAttribute('si') ?? '');
      }
      f.remove();
      formulasRemoved = true;
    }
    kid(c, S, 'v')?.remove();
    kid(c, S, 'is')?.remove();
    c.setAttribute('t', 'inlineStr');
    const is = doc.createElementNS(S, 'is');
    const t = doc.createElementNS(S, 't');
    t.textContent = text;
    preserve(t);
    is.append(t);
    c.insertBefore(is, kid(c, S, 'extLst') ?? null);
  };

  const sheets = Array.from(book.getElementsByTagNameNS(S, 'sheet'));
  for (const sheet of sheets) {
    const name = sheet.getAttribute('name') ?? '';
    const rel = bookRels.get(sheet.getAttributeNS(REL, 'id') ?? '');
    if (!rel || !rel.type.endsWith('/worksheet')) continue;
    const xml = await readXml(zip, rel.target);
    if (!xml) continue;
    parts.set(rel.target, xml);
    sheetList.push({ name, hidden: /hidden/i.test(sheet.getAttribute('state') ?? '') });

    let rowIdx = -1;
    for (const row of Array.from(xml.getElementsByTagNameNS(S, 'row'))) {
      const cells: Cell[] = [];
      rowIdx = Number(row.getAttribute('r') ?? rowIdx + 2) - 1;
      let colIdx = -1;
      for (const c of kids(row, S, 'c')) {
        const ref = /^([A-Z]+)(\d+)$/.exec(c.getAttribute('r') ?? '');
        colIdx = ref ? [...ref[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 : colIdx + 1;
        const at = { row: rowIdx, col: colIdx };
        const type = c.getAttribute('t') ?? 'n';
        if (type === 's') {
          const idx = Number(kid(c, S, 'v')?.textContent);
          const si = items[idx];
          if (!si) continue;
          refs[idx]++;
          const original = textNodes(si).map((t) => t.textContent ?? '');
          if (original.join('').trim()) cells.push({ original, at, write: (next) => sstWrites.push({ cell: c, idx, next }) });
        } else if (type === 'inlineStr') {
          const is = kid(c, S, 'is');
          const nodes = is ? textNodes(is) : [];
          const original = nodes.map((t) => t.textContent ?? '');
          if (!original.join('').trim()) continue;
          cells.push({ original, at, write: (next) => (kid(c, S, 'f') ? toInline(c, next.join('')) : setTexts(is!, next)) });
        } else if (type !== 'b' && type !== 'e') {
          const v = kid(c, S, 'v')?.textContent ?? '';
          // Numbers are scanned as Excel shows them, so a birth date reads 01/02/1993, not 33970.
          const text = type === 'n' ? shown(v, c.getAttribute('s')) : v;
          if (text.trim()) cells.push({ original: [text], at, write: (next) => toInline(c, next[0]) });
        }
      }
      if (cells.length) blocks.push(block(`${rel.target}!${rowIdx}`, name, cells, name));
    }

    for (const hf of Array.from(xml.getElementsByTagNameNS(S, 'headerFooter'))) {
      for (const el of Array.from(hf.children)) {
        const text = el.textContent ?? '';
        if (!text.trim()) continue;
        const b = block(`${rel.target}!${el.localName}`, `${name}: header and footer`, [nodeCell([{ text, node: el }])]);
        b.unit.quiet = true;
        blocks.push(b);
      }
    }

    // Notes (legacy comments) and threaded comments live in their own parts.
    const sheetRels = (await readRels(zip, rel.target)).rels;
    for (const r of sheetRels.values()) {
      if (r.external) continue;
      if (r.type.endsWith('/comments')) {
        const cx = await readXml(zip, r.target);
        if (!cx) continue;
        parts.set(r.target, cx);
        for (const a of Array.from(cx.getElementsByTagNameNS(S, 'author'))) a.textContent = 'Redacted';
        Array.from(cx.getElementsByTagNameNS(S, 'comment')).forEach((cm, i) => {
          const nodes = textNodes(cm);
          const text = nodes.map((t) => t.textContent ?? '');
          if (text.join('').trim()) blocks.push(block(`${r.target}#${i}`, `${name}: comments`, [nodeCell(nodes.map((n, j) => ({ text: text[j], node: n })))]));
        });
      } else if (r.type.endsWith('/threadedComment')) {
        const tx = await readXml(zip, r.target);
        if (!tx) continue;
        parts.set(r.target, tx);
        Array.from(tx.getElementsByTagName('*'))
          .filter((el) => el.localName === 'text' && el.parentElement?.localName === 'threadedComment')
          .forEach((el, i) => {
            const text = el.textContent ?? '';
            if (text.trim()) blocks.push(block(`${r.target}#${i}`, `${name}: comments`, [nodeCell([{ text, node: el }])]));
          });
      }
    }
  }
  if (!blocks.length && !sheets.length) throw new FileError('This workbook has no sheets.');

  return {
    blocks,
    sheets: sheetList,
    async finish(changed, redacted) {
      // Shared strings: a string still used unredacted elsewhere stays, and each new variant is appended.
      const byIdx = new Map<number, Map<string, { next: string[]; cells: Element[] }>>();
      for (const w of sstWrites) {
        const variants = byIdx.get(w.idx) ?? byIdx.set(w.idx, new Map()).get(w.idx)!;
        const key = JSON.stringify(w.next);
        (variants.get(key) ?? variants.set(key, { next: w.next, cells: [] }).get(key)!).cells.push(w.cell);
      }
      if (sst) {
        let count = items.length;
        for (const [idx, variants] of byIdx) {
          const used = [...variants.values()].reduce((n, v) => n + v.cells.length, 0);
          let inPlace = used >= refs[idx];
          for (const v of variants.values()) {
            if (inPlace) {
              setTexts(items[idx], v.next);
              inPlace = false;
              continue;
            }
            const copy = items[idx].cloneNode(true) as Element;
            setTexts(copy, v.next);
            sst.documentElement.append(copy);
            for (const c of v.cells) kid(c, S, 'v')!.textContent = String(count);
            count++;
          }
        }
        sst.documentElement.setAttribute('uniqueCount', String(count));
      }

      for (const [doc, ids] of droppedShared) {
        for (const f of Array.from(doc.getElementsByTagNameNS(S, 'f'))) {
          if (f.getAttribute('t') === 'shared' && ids.has(f.getAttribute('si') ?? '')) f.remove();
        }
      }
      // Excel rebuilds the calculation chain; a stale one makes it offer to repair the file.
      const calcChain = relTarget('/calcChain');
      if (formulasRemoved && calcChain && zip.file(calcChain)) await removePart(zip, bookPath, calcChain);

      // Charts and pivot tables keep their own copies of cell values.
      if (changed.size) {
        for (const name of Object.keys(zip.files).filter((n) => /^xl\/charts\/chart[^/]*\.xml$/.test(n))) {
          const xml = await readXml(zip, name);
          if (!xml) continue;
          for (const v of Array.from(xml.getElementsByTagName('*')).filter((e) => e.localName === 'v' && e.parentElement?.localName === 'pt')) {
            const next = changed.get(v.textContent ?? '');
            if (next === undefined) continue;
            if (v.parentElement!.parentElement?.localName === 'numCache') v.parentElement!.remove();
            else v.textContent = next;
          }
          parts.set(name, xml);
        }
        for (const name of Object.keys(zip.files).filter((n) => /^xl\/pivotCache\/pivotCache(Definition|Records)[^/]*\.xml$/.test(n))) {
          const xml = await readXml(zip, name);
          if (!xml) continue;
          for (const s of Array.from(xml.getElementsByTagName('*')).filter((e) => e.localName === 's' && e.hasAttribute('v'))) {
            const next = changed.get(s.getAttribute('v')!);
            if (next !== undefined) s.setAttribute('v', next);
          }
          if (name.includes('Definition')) xml.documentElement.setAttribute('refreshOnLoad', '1');
          parts.set(name, xml);
        }
      }

      // Hyperlink labels and tooltips can repeat a redacted address.
      for (const [name, xml] of parts) {
        if (!name.includes('/worksheets/')) continue;
        for (const link of Array.from(xml.getElementsByTagNameNS(S, 'hyperlink'))) {
          for (const attr of ['display', 'tooltip']) {
            const v = link.getAttribute(attr);
            if (v && [...redacted].some((t) => v.includes(t))) link.removeAttribute(attr);
          }
        }
      }
      await scrubRelationships(zip, redacted, /^xl\/worksheets\/_rels\/.*\.rels$/);

      // People and paths: threaded comment authors, shared-workbook user, and the folder the file was saved in.
      const persons = relTarget('/person');
      const px = persons ? await readXml(zip, persons) : null;
      if (px && persons) {
        for (const p of Array.from(px.getElementsByTagName('*')).filter((e) => e.localName === 'person')) {
          p.setAttribute('displayName', 'Redacted');
          p.setAttribute('userId', 'Redacted');
          p.setAttribute('providerId', 'None');
        }
        parts.set(persons, px);
      }
      for (const fs of Array.from(book.getElementsByTagNameNS(S, 'fileSharing'))) fs.removeAttribute('userName');
      for (const abs of Array.from(book.getElementsByTagName('*')).filter((e) => e.localName === 'absPath')) {
        const wrapper = abs.closest('AlternateContent') ?? (abs.parentElement?.localName === 'Choice' ? abs.parentElement.parentElement : null);
        (wrapper ?? abs).remove();
      }

      for (const [name, xml] of parts) if (zip.file(name)) saveXml(zip, name, xml);
      await scrubProperties(zip);
      await removeThumbnail(zip);
    },
  };
}

// ---------------------------------------------------------------- ODS

/** Text pieces of the paragraphs inside an ODF element; spaces, tabs and breaks are read-only separators. */
function odfPieces(container: Element, skip: (el: Element) => boolean = () => false) {
  const pieces: { text: string; node: Node | null }[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      pieces.push({ text: n.nodeValue ?? '', node: n });
      return;
    }
    if (!(n instanceof Element) || skip(n) || (n.namespaceURI === TEXT && ODF_FIELDS.has(n.localName))) return;
    if (n.namespaceURI === TEXT && n.localName === 's') pieces.push({ text: ' '.repeat(Number(n.getAttributeNS(TEXT, 'c') || 1)), node: null });
    else if (n.namespaceURI === TEXT && n.localName === 'tab') pieces.push({ text: '\t', node: null });
    else if (n.namespaceURI === TEXT && n.localName === 'line-break') pieces.push({ text: '\n', node: null });
    else n.childNodes.forEach(walk);
  };
  const paras = Array.from(container.getElementsByTagNameNS(TEXT, 'p')).filter((p) => !skip(p));
  paras.forEach((p, i) => {
    if (i) pieces.push({ text: '\n', node: null });
    p.childNodes.forEach(walk);
  });
  return pieces;
}

/** Makes an edited cell a plain string, so numbers and formulas don't bring the old value back. */
function odsToString(cell: Element, text: string) {
  for (const a of ['value', 'date-value', 'time-value', 'boolean-value', 'currency']) cell.removeAttributeNS(OFFICE, a);
  cell.removeAttributeNS(TABLE, 'formula');
  if (cell.hasAttributeNS(OFFICE, 'value-type')) cell.setAttributeNS(OFFICE, 'office:value-type', 'string');
  if (cell.hasAttributeNS(CALCEXT, 'value-type')) cell.setAttributeNS(CALCEXT, 'calcext:value-type', 'string');
  if (cell.hasAttributeNS(OFFICE, 'string-value')) cell.setAttributeNS(OFFICE, 'office:string-value', text);
}

async function readOds(zip: JSZip): Promise<Workbook> {
  const content = await readXml(zip, 'content.xml');
  if (!content || !content.getElementsByTagNameNS(OFFICE, 'spreadsheet').length) throw new FileError('This does not look like an OpenDocument (.ods) spreadsheet.');
  const styles = await readXml(zip, 'styles.xml');
  const blocks: Block[] = [];
  const sheets: SheetMeta[] = [];
  const notes: Block[] = [];
  // Counts every sheet's comments, so their ids stay unique across sheets.
  let noteCount = 0;
  const inNote = (el: Element) => el.closest('annotation') !== null;

  const hiddenStyles = new Set(
    Array.from(content.getElementsByTagNameNS(STYLE, 'table-properties'))
      .filter((p) => p.getAttributeNS(TABLE, 'display') === 'false')
      .map((p) => p.parentElement?.getAttributeNS(STYLE, 'name')),
  );

  for (const table of Array.from(content.getElementsByTagNameNS(TABLE, 'table'))) {
    const name = table.getAttributeNS(TABLE, 'name') ?? '';
    sheets.push({ name, hidden: hiddenStyles.has(table.getAttributeNS(TABLE, 'style-name')) });
    const repeat = (el: Element, what: string) => Number(el.getAttributeNS(TABLE, `number-${what}-repeated`) || 1);
    let r = 0;
    for (const row of Array.from(table.getElementsByTagNameNS(TABLE, 'table-row'))) {
      const cells: Cell[] = [];
      let col = 0;
      for (const cell of Array.from(row.children).filter((c) => c.namespaceURI === TABLE && /^(covered-)?table-cell$/.test(c.localName))) {
        const pieces = odfPieces(cell, inNote);
        if (pieces.map((p) => p.text).join('').trim()) cells.push({ ...nodeCell(pieces, (next) => odsToString(cell, next.join(''))), at: { row: r, col } });
        col += repeat(cell, 'columns');
        for (const note of kids(cell, OFFICE, 'annotation')) {
          for (const who of [...kids(note, DC, 'creator'), ...kids(note, META, 'creator-initials')]) who.textContent = 'Redacted';
          const np = odfPieces(note);
          if (np.map((p) => p.text).join('').trim()) notes.push(block(`content.xml#note${noteCount++}`, `${name}: comments`, [nodeCell(np)]));
        }
      }
      if (cells.length) blocks.push(block(`content.xml!${name}!${r}`, name, cells, name));
      r += repeat(row, 'rows');
    }
    blocks.push(...notes.splice(0));
  }

  if (styles) {
    const regions = Array.from(styles.getElementsByTagNameNS(STYLE, '*')).filter((el) => /^(header|footer)(-left|-first)?$/.test(el.localName));
    regions.forEach((el, i) => {
      const pieces = odfPieces(el);
      if (!pieces.map((p) => p.text).join('').trim()) return;
      const b = block(`styles.xml#${i}`, 'Header and footer', [nodeCell(pieces)]);
      b.unit.quiet = true;
      blocks.push(b);
    });
  }

  return {
    blocks,
    sheets,
    async finish(changed, redacted) {
      for (const a of Array.from(content.getElementsByTagNameNS(TEXT, 'a'))) {
        if (linkHidesText(a.getAttributeNS(XLINK, 'href') ?? '', redacted)) a.setAttributeNS(XLINK, 'xlink:href', 'about:blank');
      }
      saveXml(zip, 'content.xml', content);
      if (styles) saveXml(zip, 'styles.xml', styles);

      // Charts are embedded documents with their own copy of the plotted cells.
      if (changed.size) {
        for (const name of Object.keys(zip.files).filter((n) => /^Object [^/]+\/content\.xml$/.test(n))) {
          const xml = await readXml(zip, name);
          if (!xml) continue;
          for (const cell of Array.from(xml.getElementsByTagNameNS(TABLE, 'table-cell'))) {
            const paras = Array.from(cell.getElementsByTagNameNS(TEXT, 'p'));
            const text = paras.map((p) => p.textContent).join('\n');
            const next = changed.get(text) ?? changed.get(cell.getAttributeNS(OFFICE, 'value') ?? '\0');
            if (next === undefined) continue;
            paras.forEach((p, i) => (i ? p.remove() : (p.textContent = next)));
            odsToString(cell, next);
          }
          saveXml(zip, name, xml);
        }
      }

      const meta = await readXml(zip, 'meta.xml');
      if (meta) {
        const drop = new Set(['creator', 'initial-creator', 'printed-by', 'user-defined', 'title', 'subject', 'description', 'keyword']);
        for (const el of Array.from(meta.getElementsByTagName('*'))) if (drop.has(el.localName) && el.parentElement?.localName === 'meta') el.remove();
        saveXml(zip, 'meta.xml', meta);
      }
      // The thumbnail is a picture of the first sheet.
      if (zip.file('Thumbnails/thumbnail.png')) {
        zip.remove('Thumbnails/thumbnail.png');
        const manifest = await readXml(zip, 'META-INF/manifest.xml');
        if (manifest) {
          for (const e of Array.from(manifest.getElementsByTagNameNS(MANIFEST, 'file-entry'))) {
            if (e.getAttributeNS(MANIFEST, 'full-path')?.startsWith('Thumbnails/')) e.remove();
          }
          saveXml(zip, 'META-INF/manifest.xml', manifest);
        }
      }
    },
  };
}
