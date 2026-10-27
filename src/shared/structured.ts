import { visit } from 'jsonc-parser';
import { ENTITY_LABELS, labelText, maskText, type Span } from './detect.ts';

// Redaction for text files with a syntax, so the download still parses.
// Quotes, brackets, keys' quotes and markup are never covered, escapes and
// entities are covered whole or not at all, and a redacted JSON number,
// boolean or null becomes a string.

export type Syntax = 'json' | 'jsonl' | 'xml' | 'plain';

export function syntaxOf(name: string, text: string): Syntax {
  const n = name.toLowerCase();
  if (/\.(jsonl|ndjson)$/.test(n)) return 'jsonl';
  if (/\.(json|jsonc|geojson|webmanifest)$/.test(n)) return 'json';
  if (/\.(xml|xhtml|html?|plist|svg|xaml|csproj)$/.test(n)) return 'xml';
  // Pasted text and .txt files are checked by content.
  if (/\.(txt|text)$/.test(n) || !n.includes('.')) {
    const t = text.trimStart();
    if (/^[[{]/.test(t) && parses(text)) return 'json';
    if (/^<(\?xml|[a-z][\w:.-]*[\s>/])/i.test(t)) return 'xml';
  }
  return 'plain';
}

function parses(text: string) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

interface Shape {
  /** 1 where a character must stay as it is. */
  keep: Uint8Array;
  /** Ranges covered whole when any part of them is. */
  atoms: [number, number][];
  /** Atoms that need quotes around their replacement. */
  quoted: Map<number, number>;
}

function shapeOf(text: string, syntax: Syntax): Shape | null {
  const shape: Shape = { keep: new Uint8Array(text.length), atoms: [], quoted: new Map() };
  if (syntax === 'json') return jsonShape(text, 0, text.length, shape) ? shape : null;
  if (syntax === 'jsonl') {
    let pos = 0;
    for (const line of text.split('\n')) {
      if (line.trim() && !jsonShape(text, pos, pos + line.length, shape)) return null;
      pos += line.length + 1;
    }
    return shape;
  }
  if (syntax === 'xml') return xmlShape(text, shape);
  return null;
}

function open(shape: Shape, from: number, to: number) {
  shape.keep.fill(0, from, to);
}

function jsonShape(text: string, from: number, to: number, shape: Shape): boolean {
  shape.keep.fill(1, from, to);
  const string = (offset: number, length: number) => {
    const start = from + offset + 1;
    const end = from + offset + length - 1;
    open(shape, start, end);
    for (const m of text.slice(start, end).matchAll(/\\(u[0-9a-fA-F]{4}|.)/g)) shape.atoms.push([start + m.index, start + m.index + m[0].length]);
  };
  let ok = true;
  visit(
    text.slice(from, to),
    {
      onObjectProperty: (_name, offset, length) => string(offset, length),
      onLiteralValue: (value, offset, length) => {
        if (typeof value === 'string') return string(offset, length);
        const start = from + offset;
        open(shape, start, start + length);
        shape.atoms.push([start, start + length]);
        shape.quoted.set(start, start + length);
      },
      onComment: (offset, length) => open(shape, from + offset + 2, from + offset + length - (text.startsWith('/*', from + offset) ? 2 : 0)),
      onError: () => (ok = false),
    },
    { allowTrailingComma: true },
  );
  return ok;
}

function xmlShape(text: string, shape: Shape): Shape {
  for (const m of text.matchAll(/<!--([\s\S]*?)-->|<!\[CDATA\[([\s\S]*?)\]\]>|<[!?][^>]*>|<[^>]*>/g)) {
    const at = m.index;
    shape.keep.fill(1, at, at + m[0].length);
    if (m[1] !== undefined) open(shape, at + 4, at + 4 + m[1].length);
    else if (m[2] !== undefined) open(shape, at + 9, at + 9 + m[2].length);
    else if (m[0][1] !== '!' && m[0][1] !== '?') {
      // Attribute values stay redactable, their quotes do not.
      for (const a of m[0].matchAll(/=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        const value = a[1] ?? a[2];
        const start = at + a.index + a[0].length - 1 - value.length;
        open(shape, start, start + value.length);
      }
    }
  }
  for (const m of text.matchAll(/&(#x?[0-9a-fA-F]+|[\w.-]+);/g)) shape.atoms.push([m.index, m.index + m[0].length]);
  return shape;
}

/** Masks or labels the spans, keeping JSON and XML files valid. */
export function redactStructured(text: string, spans: Pick<Span, 'start' | 'end' | 'type'>[], style: 'block' | 'label', syntax: Syntax): string {
  const shape = shapeOf(text, syntax);
  if (!shape) return style === 'label' ? labelText(text, spans) : maskText(text, spans);

  const owner = new Int32Array(text.length).fill(-1);
  spans.forEach((s, i) => {
    for (let p = s.start; p < s.end; p++) if (owner[p] < 0) owner[p] = i;
  });
  for (const [s, e] of shape.atoms) {
    let who = -1;
    for (let p = s; p < e && who < 0; p++) who = owner[p];
    if (who >= 0) owner.fill(who, s, e);
  }
  for (let p = 0; p < text.length; p++) if (shape.keep[p]) owner[p] = -1;

  let out = '';
  for (let p = 0; p < text.length; ) {
    const who = owner[p];
    if (who < 0) {
      out += text[p++];
      continue;
    }
    let q = p;
    while (q < text.length && owner[q] === who) q++;
    const piece = style === 'label' ? `[${ENTITY_LABELS[spans[who].type].toUpperCase()}]` : maskText(text.slice(p, q), [{ start: 0, end: q - p }]);
    out += shape.quoted.get(p) === q ? `"${piece}"` : piece;
    p = q;
  }
  return out;
}
