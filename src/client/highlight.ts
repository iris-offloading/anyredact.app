import { termRegExp } from '../shared/detect.ts';
import type { Finding } from './types.ts';

/** Laid-out text has no line break characters and shows tabs as em spaces. */
const shown = (s: string) => s.replace(/[\r\n]/g, '').replace(/\t/g, ' ');

function count(haystack: string, needle: string) {
  let n = 0;
  for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}

/** Start of the nth occurrence (0-based), or of the last one when there are fewer. */
function nthIndex(haystack: string, needle: string, nth: number) {
  let at = -1;
  for (let k = 0, i = haystack.indexOf(needle); k <= nth && i >= 0; k++, i = haystack.indexOf(needle, i + needle.length)) at = i;
  return at;
}

function textNodes(root: Node): Text[] {
  const out: Text[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) out.push(walk.currentNode as Text);
  return out;
}

/**
 * Cuts a unit's text at every span edge. Spans can overlap (a spot picked
 * inside a kept finding), so each piece shows the span on top: a redacted one
 * beats a kept one.
 */
export function pieces(length: number, spans: Finding[]) {
  const cuts = [...new Set([0, length, ...spans.flatMap((f) => [f.start, f.end])])].sort((x, y) => x - y);
  const out: { start: number; end: number; top?: Finding }[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const cover = spans.filter((f) => f.start <= cuts[i] && f.end >= cuts[i + 1]);
    const top = [...cover].reverse().find((f) => f.enabled) ?? cover[0];
    const last = out[out.length - 1];
    if (last && last.top === top) last.end = cuts[i + 1];
    else out.push({ start: cuts[i], end: cuts[i + 1], top });
  }
  return out;
}

/**
 * Wraps findings in a laid-out paragraph. Each finding is placed on the same
 * occurrence of its text as in the unit, since field codes and other unseen
 * text make unit offsets differ from the layout.
 */
export function highlight(block: HTMLElement, text: string, findings: Finding[], wrap: (f: Finding) => HTMLElement) {
  const full = textNodes(block).map((n) => n.data).join('');
  const at = new Map<Finding, number>();
  for (const f of findings) {
    const needle = shown(f.text);
    const i = needle ? nthIndex(full, needle, count(shown(text.slice(0, f.start)), needle)) : -1;
    if (i >= 0) at.set(f, i);
  }
  for (const p of pieces(text.length, findings)) {
    const base = p.top && at.get(p.top);
    if (base === undefined) continue;
    const start = base + shown(text.slice(p.top!.start, p.start)).length;
    const end = base + shown(text.slice(p.top!.start, p.end)).length;
    if (end > start) wrapRange(textNodes(block), start, end, () => wrap(p.top!));
  }
}

/** The unit range a selection covers in a laid-out paragraph, found the same way as highlights. */
export function unitRange(block: HTMLElement, text: string, range: Range): { start: number; end: number } | null {
  const offset = (node: Node, at: number) => {
    const r = document.createRange();
    r.setStart(block, 0);
    r.setEnd(node, at);
    return r.toString().length;
  };
  const full = textNodes(block).map((n) => n.data).join('');
  let from = block.contains(range.startContainer) ? offset(range.startContainer, range.startOffset) : 0;
  let to = block.contains(range.endContainer) ? offset(range.endContainer, range.endOffset) : full.length;
  while (from < to && /\s/.test(full[from])) from++;
  while (to > from && /\s/.test(full[to - 1])) to--;
  if (to <= from) return null;
  const needle = full.slice(from, to);
  // Unit text as laid out, with each laid-out character's index in the unit.
  let seen = '';
  const index: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = shown(text[i]);
    if (c) (seen += c), index.push(i);
  }
  const at = nthIndex(seen, needle, count(full.slice(0, from), needle));
  return at < 0 ? null : { start: index[at], end: index[at + needle.length - 1] + 1 };
}

function wrapRange(nodes: Text[], start: number, end: number, make: () => HTMLElement) {
  let offset = 0;
  for (const n of nodes) {
    const from = Math.max(start - offset, 0);
    const to = Math.min(end - offset, n.data.length);
    offset += n.data.length;
    if (from >= to) continue;
    const piece = from ? n.splitText(from) : n;
    if (to - from < piece.data.length) piece.splitText(to - from);
    const mark = make();
    piece.replaceWith(mark);
    mark.append(piece);
  }
}

/** Ranges over every place `term` appears in a block's text, matched like an always-redact term. */
export function termRanges(block: HTMLElement, term: string): Range[] {
  const re = termRegExp(term);
  if (!re) return [];
  const nodes = textNodes(block);
  const full = nodes.map((n) => n.data).join('');
  const at = (pos: number, end: boolean): [Text, number] => {
    let offset = 0;
    for (const n of nodes) {
      if (pos < offset + n.data.length || (end && pos === offset + n.data.length)) return [n, pos - offset];
      offset += n.data.length;
    }
    return [nodes[nodes.length - 1], nodes[nodes.length - 1].data.length];
  };
  return Array.from(full.matchAll(re), (m) => {
    const r = document.createRange();
    r.setStart(...at(m.index!, false));
    r.setEnd(...at(m.index! + m[0].length, true));
    return r;
  });
}
