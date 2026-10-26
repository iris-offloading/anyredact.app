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
  /** Maps a character range to rectangles in page bitmap pixels. */
  rectsFor?(start: number, end: number): Rect[];
}

/** A rendered page bitmap (PDF page or image) that can carry redaction boxes. */
export interface Page {
  index: number;
  canvas: HTMLCanvasElement;
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
}

export interface ManualBox extends Rect {
  id: string;
  page: number;
}

export interface MetaField {
  label: string;
  value: string;
  /** Location, camera, dates, people: shown first. */
  key: boolean;
}

export type RedactStyle = 'block' | 'label';

export interface LoadedDoc {
  kind: 'text' | 'image' | 'pdf' | 'docx';
  name: string;
  units: Unit[];
  pages: Page[];
  /** Shown to the user under the preview, e.g. limitations of the format. */
  notes: string[];
  /** Embedded metadata, listed for review; the export leaves it out. */
  metadata?: MetaField[];
  exportFile(findings: Finding[], boxes: ManualBox[], style: RedactStyle): Promise<{ blob: Blob; filename: string }>;
}

export type Progress = (message: string) => void;

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

export function rectsForPage(page: number, findings: Finding[], boxes: ManualBox[]): Rect[] {
  return [
    ...findings.filter((f) => f.enabled && f.page === page).flatMap((f) => f.rects),
    ...boxes.filter((b) => b.page === page),
  ];
}
