import type { EntityType, Span } from '../shared/detect.ts';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A run of text that detection operates on (a paragraph, a page, an image). */
export interface Unit {
  id: string;
  text: string;
  /** Page index for visual formats. */
  page?: number;
  /** Heading the preview shows above the first unit of a group, such as a sheet name. */
  section?: string;
  /** Shown in the preview only when something was found in it, e.g. a header holding just a page number. */
  quiet?: boolean;
  /** Maps a character range to rectangles in page bitmap pixels. */
  rectsFor?(start: number, end: number): Rect[];
  /** Audio: each spoken word, as its character range in `text` and its time in the recording. */
  words?: SpokenWord[];
  /** Audio: maps a character range of the transcript to seconds in the recording. */
  timesFor?(start: number, end: number): [number, number] | null;
}

export interface SpokenWord {
  from: number;
  to: number;
  start: number;
  end: number;
}

/** A rendered page bitmap (PDF page or image) that can carry redaction boxes. */
export interface Page {
  index: number;
  canvas: HTMLCanvasElement;
  /** Accessible name; defaults to "Page n". */
  label?: string;
}

export interface Finding {
  key: string;
  unitId: string;
  start: number;
  end: number;
  type: EntityType;
  source: Span['source'];
  text: string;
  enabled: boolean;
  publicHint?: string;
  page?: number;
  rects: Rect[];
  /** Audio: the stretch of the recording to bleep, in seconds. */
  times?: [number, number];
}

/** A box drawn on a page. */
export interface ManualBox extends Rect {
  id: string;
  page: number;
}

/** Audio: a stretch picked on the timeline, in seconds. */
export interface ManualStretch {
  id: string;
  times: [number, number];
}

/** What the visitor marked by hand: boxes on pages, stretches of a recording. */
export type ManualMark = ManualBox | ManualStretch;

export const isBox = (m: ManualMark): m is ManualBox => 'page' in m;

export interface MetaField {
  label: string;
  value: string;
  /** Location, camera, dates, people: shown first. */
  key: boolean;
}

export type RedactStyle = 'block' | 'label' | 'beep' | 'silence';

export interface ViewHandlers {
  toggle(keys: string[], on: boolean): void;
  /** A spot the user selected in the view, or null when the selection holds none. */
  select(pick: { unitId: string; start: number; end: number } | null): void;
}

/** A preview drawn by the format itself, such as the spreadsheet grid. */
export interface DocView {
  update(findings: Finding[]): void;
  /** Shows the finding in the view; false when it has no place there. */
  reveal(f: Finding): boolean;
  dispose(): void;
}

export interface LoadedDoc {
  kind: 'text' | 'image' | 'pdf' | 'docx' | 'pptx' | 'sheet' | 'audio';
  name: string;
  units: Unit[];
  pages: Page[];
  /** Shown to the user under the preview, e.g. limitations of the format. */
  notes: string[];
  /** Embedded metadata, listed for review; the export leaves it out. */
  metadata?: MetaField[];
  /** Word and PowerPoint: lays out the pages or slides in the preview, as the app shows them. */
  render?(container: HTMLElement): Promise<Layout>;
  /** Units shown in the custom view; the rest are listed under it. */
  gridUnits?: Set<string>;
  mountView?(el: HTMLElement, on: ViewHandlers): Promise<DocView>;
  /** Redaction styles to offer, default first; none for formats with only one. */
  styles?: [RedactStyle, string][];
  /** Audio: the recording, for the player and timeline. */
  audio?: { url: string; duration: number };
  /** Audio: writes out the speech, which fills `units`. Runs once the user agreed to send it. */
  transcribe?(progress: Progress): Promise<void>;
  /** Frees what the loader holds (object URLs, open readers) when the file is closed. */
  dispose?(): void;
  exportFile(findings: Finding[], marks: ManualMark[], style: RedactStyle, progress?: Progress): Promise<{ blob: Blob; filename: string }>;
}

export interface Layout {
  /** Rendered paragraphs per unit id. Units left out are not on the pages, such as comments and alt text. */
  blocks: Map<string, HTMLElement[]>;
  /** Rendered pictures, with their editor page index. */
  pictures: { page: number; img: HTMLImageElement }[];
}

export type Progress = (message: string) => void;

export const TEXT_STYLES: [RedactStyle, string][] = [
  ['block', 'Black out (█████)'],
  ['label', 'Replace with label ([EMAIL])'],
];

export function outputName(name: string, ext?: string): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const e = ext ?? (dot > 0 ? name.slice(dot + 1) : 'txt');
  return `${base}-redacted.${e}`;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, quality),
  );
}

/** Copies a page bitmap and paints solid boxes over it. */
export function burnBoxes(src: HTMLCanvasElement, rects: Rect[]): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  ctx.fillStyle = '#000';
  for (const r of rects) ctx.fillRect(Math.floor(r.x), Math.floor(r.y), Math.ceil(r.w) + 1, Math.ceil(r.h) + 1);
  return out;
}

export function rectsForPage(page: number, findings: Finding[], marks: ManualMark[]): Rect[] {
  return [
    ...findings.filter((f) => f.enabled && f.page === page).flatMap((f) => f.rects),
    ...marks.filter((b): b is ManualBox => isBox(b) && b.page === page),
  ];
}
