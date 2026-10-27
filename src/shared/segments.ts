import { ENTITY_LABELS, type Span } from './detect.ts';

/**
 * Rewrites text that is stored across several pieces (e.g. DOCX runs), where
 * spans are offsets into the concatenated text. Returns the new piece texts.
 * In 'label' style the label is written into the piece where a span starts
 * and the rest of the span is removed.
 */
export function rewriteSegments(
  pieces: string[],
  spans: Pick<Span, 'start' | 'end' | 'type'>[],
  /** 'label' writes [TYPE] labels; any other style blocks characters out. */
  style: string,
  char = '█',
): string[] {
  const total = pieces.reduce((n, p) => n + p.length, 0);
  const covered = new Uint8Array(total);
  const labelAt = new Map<number, string>();
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    if (style === 'label' && !covered[s.start]) labelAt.set(s.start, `[${ENTITY_LABELS[s.type].toUpperCase()}]`);
    covered.fill(1, s.start, s.end);
  }
  const out: string[] = [];
  let offset = 0;
  for (const piece of pieces) {
    let s = '';
    for (let i = 0; i < piece.length; i++) {
      const g = offset + i;
      const c = piece[i];
      if (!covered[g]) s += c;
      else if (style === 'label') s += labelAt.get(g) ?? '';
      else if (/\s/.test(c)) s += c;
      else if (!(c.charCodeAt(0) >= 0xdc00 && c.charCodeAt(0) <= 0xdfff)) s += char;
    }
    out.push(s);
    offset += piece.length;
  }
  return out;
}
