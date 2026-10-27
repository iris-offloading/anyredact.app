import { IRenderManagerService, UniverSheetsCorePreset, Vector2, type SpreadsheetSkeleton } from '@univerjs/preset-sheets-core';
import sheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US';
import {
  BooleanNumber, CellValueType, createUniver, HorizontalAlign, LocaleType, mergeLocales, VerticalAlign, WrapStrategy,
  type ICellData, type IStyleData, type IWorkbookData, type IWorksheetData,
} from '@univerjs/presets';
import ExcelJS from 'exceljs';
import type { DocView, Finding, Unit, ViewHandlers } from '../types.ts';

// The spreadsheet preview: Univer draws the workbook (sheet tabs, styles, merged
// cells, frozen panes) read-only, and cells holding findings get highlighted runs.
// ExcelJS reads the styles of .xlsx files; .ods files are shown with their values only.

declare const __UNIVER_CSS__: string;

/** Where a piece of a unit's text sits in the grid. Offsets are into the unit text. */
export interface GridCell {
  sheet: string;
  row: number;
  col: number;
  start: number;
  end: number;
}

export interface SheetMeta {
  name: string;
  hidden: boolean;
}

interface Options {
  sheets: SheetMeta[];
  units: Unit[];
  grid: Map<string, GridCell[]>;
  /** The original .xlsx file, for styles. */
  xlsx?: ArrayBuffer;
}

// Same as the text preview: a see-through bar over redacted text, so it stays readable while reviewing.
const ON = 'rgba(0, 0, 0, 0.45)';
const OFF = '#ffe8cc';

// Office's default theme, for colours given as a theme index.
const THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];
const BORDERS: Record<string, number> = {
  thin: 1, hair: 2, dotted: 3, dashed: 4, dashDot: 5, dashDotDot: 6, double: 7, medium: 8,
  mediumDashed: 9, mediumDashDot: 10, mediumDashDotDot: 11, slantDashDot: 12, thick: 13,
};
const H_ALIGN: Record<string, number> = { left: 1, center: 2, centerContinuous: 2, right: 3, justify: 4, distributed: 4 };
const V_ALIGN: Record<string, number> = { top: 1, middle: 2, bottom: 3 };

function color(c?: Partial<ExcelJS.Color> & { tint?: number }): { rgb: string } | undefined {
  let hex = c?.argb ? c.argb.slice(-6) : c?.theme !== undefined ? THEME[c.theme] : undefined;
  if (!hex) return undefined;
  if (c?.tint) {
    const t = c.tint;
    hex = [0, 2, 4]
      .map((i) => {
        const v = parseInt(hex!.slice(i, i + 2), 16);
        const out = t < 0 ? v * (1 + t) : v + (255 - v) * t;
        return Math.round(out).toString(16).padStart(2, '0');
      })
      .join('');
  }
  return { rgb: `#${hex}` };
}

function style(s: Partial<ExcelJS.Style>): IStyleData {
  const out: IStyleData = {};
  const f = s.font;
  if (f) {
    if (f.name) out.ff = f.name;
    if (f.size) out.fs = f.size;
    if (f.bold) out.bl = BooleanNumber.TRUE;
    if (f.italic) out.it = BooleanNumber.TRUE;
    if (f.underline) out.ul = { s: BooleanNumber.TRUE };
    if (f.strike) out.st = { s: BooleanNumber.TRUE };
    const cl = color(f.color);
    if (cl) out.cl = cl;
  }
  if (s.fill?.type === 'pattern' && s.fill.pattern !== 'none') {
    const bg = color(s.fill.fgColor ?? s.fill.bgColor);
    if (bg) out.bg = bg;
  }
  const a = s.alignment;
  if (a) {
    if (a.horizontal && H_ALIGN[a.horizontal]) out.ht = H_ALIGN[a.horizontal];
    if (a.vertical && V_ALIGN[a.vertical]) out.vt = V_ALIGN[a.vertical];
    if (a.wrapText) out.tb = 3;
  }
  if (s.border) {
    const bd: NonNullable<IStyleData['bd']> = {};
    for (const [from, to] of [['top', 't'], ['bottom', 'b'], ['left', 'l'], ['right', 'r']] as const) {
      const b = s.border[from];
      if (b?.style && BORDERS[b.style]) bd[to] = { s: BORDERS[b.style], cl: color(b.color) ?? { rgb: '#000000' } };
    }
    if (Object.keys(bd).length) out.bd = bd;
  }
  if (s.numFmt && s.numFmt !== 'General') out.n = { pattern: s.numFmt };
  return out;
}

/** Excel's serial number for a date, which Univer formats with the cell's number format. */
const serial = (d: Date) => d.getTime() / 86_400_000 + 25_569;

function value(cell: ExcelJS.Cell): ICellData['v'] {
  const v = cell.value;
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return serial(v);
  if (typeof v !== 'object') return v;
  if ('richText' in v) return v.richText.map((r) => r.text).join('');
  if ('formula' in v || 'sharedFormula' in v) {
    const r = (v as ExcelJS.CellFormulaValue).result;
    return r instanceof Date ? serial(r) : typeof r === 'object' && r ? (r as ExcelJS.CellErrorValue).error : r;
  }
  if ('hyperlink' in v) return typeof v.text === 'string' ? v.text : cell.text;
  if ('error' in v) return v.error;
  return cell.text;
}

const colWidth = (chars?: number) => Math.round((chars ?? 8.43) * 7 + 5);

async function fromXlsx(buffer: ArrayBuffer, sheets: SheetMeta[]): Promise<Record<string, IWorksheetData>> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  const out: Record<string, IWorksheetData> = {};
  for (const ws of book.worksheets) {
    if (!sheets.some((s) => s.name === ws.name)) continue;
    const cellData: IWorksheetData['cellData'] = {};
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        const v = value(cell);
        const s = style(cell.style);
        if (v === undefined && !Object.keys(s).length) return;
        (cellData[r - 1] ??= {})[c - 1] = { ...(v === undefined ? {} : { v }), s };
      });
    });
    const columnData: IWorksheetData['columnData'] = {};
    (ws.columns ?? []).forEach((col, i) => {
      if (col.width || col.hidden) columnData[i] = { w: colWidth(col.width), hd: col.hidden ? BooleanNumber.TRUE : BooleanNumber.FALSE };
    });
    const rowData: IWorksheetData['rowData'] = {};
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      if (row.height || row.hidden) rowData[r - 1] = { h: Math.round((row.height ?? 15) * 4 / 3), hd: row.hidden ? BooleanNumber.TRUE : BooleanNumber.FALSE };
    });
    const mergeData = (Object.values((ws.model as { merges?: string[] }).merges ?? []) as string[]).map((ref) => {
      const [a, b] = ref.split(':').map((x) => ws.getCell(x));
      return { startRow: Number(a.row) - 1, startColumn: Number(a.col) - 1, endRow: Number(b.row) - 1, endColumn: Number(b.col) - 1 };
    });
    const view = ws.views?.[0] as Partial<ExcelJS.WorksheetViewFrozen> & { showGridLines?: boolean } | undefined;
    const x = view?.state === 'frozen' ? view.xSplit ?? 0 : 0;
    const y = view?.state === 'frozen' ? view.ySplit ?? 0 : 0;
    out[ws.name] = {
      id: '',
      name: ws.name,
      cellData,
      columnData,
      rowData,
      mergeData,
      rowCount: Math.max(ws.rowCount + 20, 60),
      columnCount: Math.max(ws.columnCount + 4, 14),
      defaultColumnWidth: colWidth(ws.properties.defaultColWidth),
      defaultRowHeight: Math.round((ws.properties.defaultRowHeight ?? 15) * 4 / 3),
      freeze: { xSplit: x, ySplit: y, startRow: y, startColumn: x },
      showGridlines: view?.showGridLines === false ? BooleanNumber.FALSE : BooleanNumber.TRUE,
      tabColor: color(ws.properties.tabColor)?.rgb ?? '',
    } as IWorksheetData;
  }
  return out;
}

interface Run {
  st: number;
  ed: number;
  on: boolean;
  key: string;
}

/** A box in sheet coordinates. */
interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Where each run of a cell's text is drawn, which can be past the cell when the
 * text overflows into its neighbours. Follows Univer's font extension and
 * Documents.draw: the text is laid out from the first overflow column, then
 * aligned by the cell's own width.
 */
function runBoxes(sk: SpreadsheetSkeleton, row: number, col: number, runs: Run[]): Box[][] {
  const font = sk.getFont(row, col);
  const page = font?.documentSkeleton?.getSkeletonData()?.pages[0];
  if (!font || !page || font.vertexAngle || font.centerAngle) return runs.map(() => []);
  const cell = sk.getCellWithCoordByIndex(row, col, false);
  const { startX, startY, endX, endY } = cell.isMergedMainCell ? cell.mergeInfo : cell;
  let x = startX;
  let y = startY;
  const overflow = font.wrapStrategy !== WrapStrategy.WRAP && sk.overflowCache.getValue(row, col);
  if (overflow) {
    const first = sk.getCellWithCoordByIndex(overflow.startRow, overflow.startColumn, false);
    x = first.startX;
    y = first.startY;
  }
  const { horizontalAlign = HorizontalAlign.LEFT, verticalAlign = VerticalAlign.TOP, cellValueType } = page.renderConfig ?? {};
  const h = horizontalAlign !== HorizontalAlign.UNSPECIFIED ? horizontalAlign
    : cellValueType === CellValueType.NUMBER ? HorizontalAlign.RIGHT
    : cellValueType === CellValueType.BOOLEAN ? HorizontalAlign.CENTER
    : HorizontalAlign.LEFT;
  const width = endX - startX;
  const height = endY - startY;
  x += h === HorizontalAlign.CENTER ? (width - page.width) / 2 : h === HorizontalAlign.RIGHT ? width - page.width - page.marginRight : page.marginLeft;
  y += verticalAlign === VerticalAlign.MIDDLE ? (height - page.height) / 2 : verticalAlign === VerticalAlign.TOP ? page.marginTop : height - page.height - page.marginBottom;

  const out: Box[][] = runs.map(() => []);
  for (const section of page.sections) {
    for (const column of section.columns) {
      for (const line of column.lines) {
        // A single line takes the whole row height, so a tap anywhere beside the text counts.
        const y0 = page.sections.length === 1 && column.lines.length === 1 ? startY : y + section.top + line.top;
        const y1 = page.sections.length === 1 && column.lines.length === 1 ? endY : y0 + line.lineHeight;
        for (const divide of line.divides) {
          let i = divide.st;
          for (const glyph of divide.glyphGroup) {
            const gx = x + column.left + divide.left + divide.paddingLeft + glyph.left;
            runs.forEach((r, n) => {
              if (i >= r.ed || i + glyph.count <= r.st) return;
              const boxes = out[n];
              const last = boxes[boxes.length - 1];
              if (last && last.y0 === y0 && Math.abs(last.x1 - gx) < 1) last.x1 = gx + glyph.width;
              else boxes.push({ x0: gx, x1: gx + glyph.width, y0, y1 });
            });
            i += glyph.count;
          }
        }
      }
    }
  }
  return out;
}

function loadCss() {
  if (document.querySelector('link[data-univer]')) return;
  document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: __UNIVER_CSS__ }));
  document.head.lastElementChild!.setAttribute('data-univer', '');
}

export async function mountSheetView(el: HTMLElement, opts: Options, on: ViewHandlers): Promise<DocView> {
  loadCss();
  const fromFile = opts.xlsx ? await fromXlsx(opts.xlsx, opts.sheets) : {};

  // Every cell text the units know about, so .ods files and cells ExcelJS skipped still show.
  const texts = new Map<string, Map<string, string>>();
  const spots = new Map<string, { unitId: string; start: number; end: number }>();
  for (const u of opts.units) {
    for (const g of opts.grid.get(u.id) ?? []) {
      (texts.get(g.sheet) ?? texts.set(g.sheet, new Map()).get(g.sheet)!).set(`${g.row}:${g.col}`, u.text.slice(g.start, g.end));
      spots.set(`${g.sheet}:${g.row}:${g.col}`, { unitId: u.id, start: g.start, end: g.end });
    }
  }

  const ids = new Map<string, string>();
  const data: IWorkbookData = {
    id: 'book',
    name: '',
    appVersion: '',
    locale: LocaleType.EN_US,
    styles: {},
    sheetOrder: [],
    sheets: {},
  };
  opts.sheets.forEach((meta, i) => {
    const id = `sheet${i}`;
    ids.set(meta.name, id);
    const sheet: Partial<IWorksheetData> = fromFile[meta.name] ?? { cellData: {}, rowCount: 60, columnCount: 14 };
    for (const [key, text] of texts.get(meta.name) ?? []) {
      const [r, c] = key.split(':').map(Number);
      const row = (sheet.cellData![r] ??= {});
      if (row[c]?.v === undefined) row[c] = { ...row[c], v: text };
      sheet.rowCount = Math.max(sheet.rowCount ?? 0, r + 20);
      sheet.columnCount = Math.max(sheet.columnCount ?? 0, c + 4);
    }
    // Hidden sheets are shown too, since they are redacted like the others.
    data.sheets[id] = { ...sheet, id, name: meta.hidden ? `${meta.name} (hidden)` : meta.name, hidden: BooleanNumber.FALSE } as IWorksheetData;
    data.sheetOrder.push(id);
  });

  // Always light, like Excel: Univer's dark mode recolours cells, redaction bars included.
  const { univer, univerAPI } = createUniver({
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: mergeLocales(sheetsCoreEnUS) },
    presets: [
      UniverSheetsCorePreset({
        container: el,
        header: false,
        toolbar: false,
        contextMenu: false,
        formulaBar: false,
        footer: { sheetBar: true, statisticBar: false, menus: false, zoomSlider: el.clientWidth > 600, addSheetButtonConfig: { show: false } },
      }),
    ],
  });
  const book = univerAPI.createWorkbook(data);
  book.setEditable(false);
  // Typing or double-clicking a read-only cell would otherwise open a "range is protected" alert.
  univerAPI.setPermissionDialogVisible(false);

  const original = (sheet: string, r: number, c: number): ICellData => data.sheets[ids.get(sheet)!]?.cellData?.[r]?.[c] ?? {};
  let marked = new Map<string, { sheet: string; row: number; col: number; runs: Run[] }>();

  const nameOf = (id: string) => [...ids].find(([, x]) => x === id)?.[0];
  // Univer's cell events carry no coordinates, so keep the last press.
  let press = { x: 0, y: 0 };
  el.addEventListener('pointerdown', (e) => (press = { x: e.clientX, y: e.clientY }), true);

  /** The runs under the press: a click toggles the highlight it lands on, also where the text overflows into the next cell. */
  function runsAt(sheetName: string, row: number, column: number, sk: SpreadsheetSkeleton): Run[] {
    const render = univer.__getInjector().get(IRenderManagerService).getRenderUnitById(book.getId());
    if (!render) return [];
    const { scene } = render;
    const rect = render.engine.getCanvasElement().getBoundingClientRect();
    const rel = scene.getCoordRelativeToViewport(Vector2.FromArray([press.x - rect.left, press.y - rect.top]));
    const scroll = scene.getScrollXYInfoByViewport(rel);
    const { scaleX, scaleY } = scene.getAncestorScale();
    const x = rel.x / scaleX + scroll.x - sk.rowHeaderWidthAndMarginLeft;
    const y = rel.y / scaleY + scroll.y - sk.columnHeaderHeightAndMarginTop;
    const slack = 3 / scaleX;
    let nearest: { run: Run; d: number } | undefined;
    const hits: Run[] = [];
    for (const cell of marked.values()) {
      if (cell.sheet !== sheetName) continue;
      const own = cell.row === row && cell.col === column;
      const boxes = runBoxes(sk, cell.row, cell.col, cell.runs);
      cell.runs.forEach((run, n) => {
        for (const b of boxes[n]) {
          const d = Math.hypot(x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0, y < b.y0 ? b.y0 - y : y > b.y1 ? y - b.y1 : 0);
          if (d <= slack) hits.push(run);
          // Elsewhere in a cell with highlights, the closest one.
          else if (own && (!nearest || d < nearest.d)) nearest = { run, d };
        }
      });
    }
    if (hits.length) return hits;
    if (nearest) return [nearest.run];
    // No layout to go by: the whole cell, as one.
    return marked.get(`${sheetName}:${row}:${column}`)?.runs ?? [];
  }

  univerAPI.addEvent(univerAPI.Event.CellClicked, ({ worksheet, row, column }) => {
    const sk = worksheet.getSkeleton();
    const sheetName = nameOf(worksheet.getSheetId());
    if (!sk || !sheetName) return;
    const runs = runsAt(sheetName, row, column, sk);
    if (runs.length) on.toggle([...new Set(runs.map((r) => r.key))], !runs.some((r) => r.on));
  });
  // Selecting a cell without highlights offers to redact its text.
  univerAPI.addEvent(univerAPI.Event.SelectionChanged, ({ worksheet, selections }) => {
    const r = selections[0];
    const key = r && r.startRow === r.endRow && r.startColumn === r.endColumn ? `${nameOf(worksheet.getSheetId())}:${r.startRow}:${r.startColumn}` : '';
    on.select(marked.has(key) ? null : spots.get(key) ?? null);
  });

  return {
    update(findings: Finding[]) {
      const byUnit = new Map<string, Finding[]>();
      for (const f of findings) (byUnit.get(f.unitId) ?? byUnit.set(f.unitId, []).get(f.unitId)!).push(f);
      const next = new Map<string, { sheet: string; row: number; col: number; text: string; runs: Run[] }>();
      for (const u of opts.units) {
        const fs = byUnit.get(u.id);
        if (!fs) continue;
        for (const g of opts.grid.get(u.id) ?? []) {
          for (const f of fs) {
            const st = Math.max(f.start, g.start) - g.start;
            const ed = Math.min(f.end, g.end) - g.start;
            if (ed <= st) continue;
            const key = `${g.sheet}:${g.row}:${g.col}`;
            const cell = next.get(key) ?? next.set(key, { sheet: g.sheet, row: g.row, col: g.col, text: u.text.slice(g.start, g.end), runs: [] }).get(key)!;
            cell.runs.push({ st, ed, on: f.enabled, key: f.key });
          }
        }
      }
      book.setEditable(true);
      for (const [key, old] of marked) {
        if (!next.has(key)) book.getSheetBySheetId(ids.get(old.sheet)!)?.getRange(old.row, old.col).setValue(original(old.sheet, old.row, old.col));
      }
      for (const cell of next.values()) {
        const base = original(cell.sheet, cell.row, cell.col);
        const runs = cell.runs.sort((a, b) => a.st - b.st);
        book
          .getSheetBySheetId(ids.get(cell.sheet)!)
          ?.getRange(cell.row, cell.col)
          .setValue({
            s: base.s,
            v: cell.text,
            p: {
              id: 'cell',
              documentStyle: {},
              body: {
                dataStream: `${cell.text}\r\n`,
                paragraphs: [{ startIndex: cell.text.length, paragraphId: 'p' }],
                textRuns: runs.map((r) => ({ st: r.st, ed: r.ed, ts: { bg: { rgb: r.on ? ON : OFF } } })),
              },
            },
          });
      }
      book.setEditable(false);
      marked = new Map([...next].map(([k, c]) => [k, { sheet: c.sheet, row: c.row, col: c.col, runs: c.runs }]));
    },
    reveal(f: Finding) {
      const g = opts.grid.get(f.unitId)?.find((c) => c.start <= f.start && f.start < c.end);
      const sheet = g && book.getSheetBySheetId(ids.get(g.sheet)!);
      if (!g || !sheet) return false;
      book.setActiveSheet(sheet);
      sheet.getRange(g.row, g.col).activate();
      el.scrollIntoView({ block: 'nearest' });
      return true;
    },
    dispose() {
      univer.dispose();
    },
  };
}
