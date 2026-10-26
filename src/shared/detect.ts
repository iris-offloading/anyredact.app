// Pattern-based PII detection. Runs entirely in the browser (and in tests),
// so it must stay dependency-free.

export type EntityType =
  | 'email'
  | 'phone'
  | 'ssn'
  | 'card'
  | 'iban'
  | 'ip'
  | 'url'
  | 'date'
  | 'name'
  | 'address'
  | 'id'
  | 'org'
  | 'custom'
  | 'other';

export interface Span {
  start: number;
  end: number;
  type: EntityType;
  source: 'pattern' | 'ai' | 'term';
}

export const ENTITY_LABELS: Record<EntityType, string> = {
  email: 'Email',
  phone: 'Phone',
  ssn: 'SSN / national ID',
  card: 'Card number',
  iban: 'IBAN / bank',
  ip: 'IP address',
  url: 'URL',
  date: 'Date',
  name: 'Name',
  address: 'Address',
  id: 'ID number',
  org: 'Organization',
  custom: 'Custom term',
  other: 'Other',
};

/** Types the offline pattern engine can find; the UI lets users toggle each. */
export const PATTERN_TYPES: EntityType[] = ['email', 'phone', 'ssn', 'card', 'iban', 'ip', 'url', 'date'];

interface Rule {
  type: EntityType;
  re: RegExp;
  validate?: (match: string) => boolean;
}

const digits = (s: string) => s.replace(/\D/g, '');

export function luhn(num: string): boolean {
  const d = digits(num);
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = d.charCodeAt(d.length - 1 - i) - 48;
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

export function validIban(raw: string): boolean {
  const s = raw.replace(/\s/g, '').toUpperCase();
  if (s.length < 15 || s.length > 34) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const code = ch.charCodeAt(0);
    const val = code >= 65 && code <= 90 ? String(code - 55) : ch;
    for (const c of val) rem = (rem * 10 + (c.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}

const RULES: Rule[] = [
  { type: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { type: 'url', re: /\bhttps?:\/\/[^\s<>"')\]]*[^\s<>"')\].,;:!?]/g },
  { type: 'ssn', re: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g },
  { type: 'card', re: /\b\d(?:[ -]?\d){12,18}\b/g, validate: luhn },
  { type: 'iban', re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g, validate: validIban },
  {
    type: 'ip',
    re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
  },
  { type: 'ip', re: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g },
  {
    type: 'phone',
    // Optional country code, optional area code in parentheses, then 2-4 digit groups.
    re: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]\d{2,4}){1,4}\b|\+\d{8,15}\b/g,
    validate: (m) => {
      const n = digits(m).length;
      if (n < 7 || n > 15) return false;
      // Skip things that look like dates or plain years ranges.
      if (/^\d{4}-\d{2}-\d{2}$/.test(m.trim())) return false;
      if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(m.trim())) return false;
      return true;
    },
  },
  {
    type: 'date',
    re: /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|(?:\d{1,2}\s)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s\d{1,2}(?:st|nd|rd|th)?,?\s\d{4}|\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s\d{4})\b/g,
  },
];

/** Earlier rules win on overlap, so order RULES from most to least specific. */
export function detectPatterns(text: string, enabled: Iterable<EntityType> = PATTERN_TYPES): Span[] {
  const on = new Set(enabled);
  const spans: Span[] = [];
  for (const rule of RULES) {
    if (!on.has(rule.type)) continue;
    rule.re.lastIndex = 0;
    for (const m of text.matchAll(rule.re)) {
      const value = m[0];
      if (rule.validate && !rule.validate(value)) continue;
      const start = m.index!;
      spans.push({ start, end: start + value.length, type: rule.type, source: 'pattern' });
    }
  }
  return dedupe(spans);
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Finds every occurrence of each term (case-insensitive, whitespace-tolerant). */
export function findTerms(
  text: string,
  terms: { text: string; type: EntityType }[],
  source: Span['source'] = 'term',
): Span[] {
  const spans: Span[] = [];
  for (const term of terms) {
    const t = term.text.trim();
    if (t.length < 2) continue;
    const pattern = t.split(/\s+/).map(escapeRe).join('\\s+');
    const wordy = /^\w/.test(t) && /\w$/.test(t);
    const re = new RegExp(wordy ? `(?<![\\w])${pattern}(?![\\w])` : pattern, 'gi');
    for (const m of text.matchAll(re)) {
      spans.push({ start: m.index!, end: m.index! + m[0].length, type: term.type, source });
    }
  }
  return spans;
}

/** Drops spans fully contained in an earlier-listed span; keeps partial overlaps. */
export function dedupe(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    if (out.some((o) => o.start <= s.start && o.end >= s.end)) continue;
    for (let i = out.length - 1; i >= 0; i--) {
      if (s.start <= out[i].start && s.end >= out[i].end) out.splice(i, 1);
    }
    out.push(s);
  }
  return out.sort((a, b) => a.start - b.start || b.end - a.end);
}

/** Replaces each non-whitespace character inside a span with a mask character. */
export function maskText(text: string, spans: Pick<Span, 'start' | 'end'>[], char = '█'): string {
  const covered = new Uint8Array(text.length);
  for (const s of spans) covered.fill(1, s.start, s.end);
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (!covered[i] || /\s/.test(c)) out += c;
    else if (!isLowSurrogate(text.charCodeAt(i))) out += char;
  }
  return out;
}

function isLowSurrogate(code: number) {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Replaces each span with a [TYPE] label. Offsets are not preserved. */
export function labelText(text: string, spans: Pick<Span, 'start' | 'end' | 'type'>[]): string {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let out = '';
  let pos = 0;
  for (const s of sorted) {
    if (s.start < pos) {
      pos = Math.max(pos, s.end);
      continue;
    }
    out += text.slice(pos, s.start) + `[${ENTITY_LABELS[s.type].toUpperCase()}]`;
    pos = s.end;
  }
  return out + text.slice(pos);
}
