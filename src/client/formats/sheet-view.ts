import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import sheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US';
import { BooleanNumber, createUniver, LocaleType, mergeLocales, type ICellData, type IStyleData, type IWorkbookData, type IWorksheetData } from '@univerjs/presets';
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

  // Always light, like Excel: Univer's dark mode recolours cells, black redaction boxes included.
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

  const original = (sheet: string, r: number, c: number): ICellData => data.sheets[ids.get(sheet)!]?.cellData?.[r]?.[c] ?? {};
  let marked = new Map<string, { sheet: string; row: number; col: number; keys: string[]; on: boolean }>();

  const nameOf = (id: string) => [...ids].find(([, x]) => x === id)?.[0];
  univerAPI.addEvent(univerAPI.Event.CellClicked, ({ worksheet, row, column }) => {
    const hit = marked.get(`${nameOf(worksheet.getSheetId())}:${row}:${column}`);
    if (hit) on.toggle(hit.keys, !hit.on);
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
      const next = new Map<string, { sheet: string; row: number; col: number; text: string; runs: { st: number; ed: number; on: boolean }[]; keys: string[]; on: boolean }>();
      for (const u of opts.units) {
        const fs = byUnit.get(u.id);
        if (!fs) continue;
        for (const g of opts.grid.get(u.id) ?? []) {
          for (const f of fs) {
            const st = Math.max(f.start, g.start) - g.start;
            const ed = Math.min(f.end, g.end) - g.start;
            if (ed <= st) continue;
            const key = `${g.sheet}:${g.row}:${g.col}`;
            const cell = next.get(key) ?? next.set(key, { sheet: g.sheet, row: g.row, col: g.col, text: u.text.slice(g.start, g.end), runs: [], keys: [], on: false }).get(key)!;
            cell.runs.push({ st, ed, on: f.enabled });
            cell.keys.push(f.key);
            cell.on ||= f.enabled;
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
      marked = new Map([...next].map(([k, c]) => [k, { sheet: c.sheet, row: c.row, col: c.col, keys: c.keys, on: c.on }]));
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
