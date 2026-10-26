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
  | 'other'
  // Picture regions found in the browser (src/client/visual.ts).
  | 'face'
  | 'screen'
  | 'sign'
  | 'plate';

export interface Span {
  start: number;
  end: number;
  type: EntityType;
  source: 'pattern' | 'ai' | 'term' | 'visual';
  /** Set when the match is probably not personal (e.g. a public helpline), so it starts unticked. */
  publicHint?: string;
}

export const ENTITY_LABELS: Record<EntityType, string> = {
  email: 'Email',
  phone: 'Phone',
  ssn: 'SSN / ITIN',
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
  other: 'Other sensitive',
  face: 'Face',
  screen: 'Screen',
  sign: 'Road sign',
  plate: 'Number plate',
};

/** Types the offline engine can find (names via names.ts); the UI lets users toggle each. */
export const PATTERN_TYPES: EntityType[] = ['name', 'email', 'phone', 'ssn', 'card', 'iban', 'ip', 'url', 'date'];

/** Separator between digit groups: spaces, a dot or dash, and at most one line break. */
const SEP = String.raw`(?:[ \t]*[.-][ \t]*(?:\r?\n[ \t]*)?|[ \t]+(?:\r?\n[ \t]*)?|\r?\n[ \t]*)`;

// Free or non-geographic prefixes used by businesses and public services:
// UK 0800/0808/0300/03xx/084x/087x, US/Canada toll-free 8xx, Australia 1300/1800.
const SERVICE_PREFIX = /^(?:\+44|0)?(?:80[08]|3\d\d|84\d|87\d)|^(?:\+?1)?\(?8(?:00|33|44|55|66|77|88)\)?|^(?:\+61)?1[38]00/;
const SERVICE_WORDS = /\b(?:helpline|hotline|freephone|textphone|relay uk|call us|contact us|customer (?:service|support|care)|enquiries|inquiries|switchboard|reception|main office|head office|support line|advice line|information line|emergency services|callers|tty|tdd|toll[- ]free|questions|for (?:more )?information|for help|assistance)\b/i;

/** Flags phone numbers that look like a public or business line rather than a person's. */
export function phonePublicHint(text: string, start: number, match: string): string | undefined {
  const compact = match.replace(/[\s().-]/g, '');
  if (SERVICE_PREFIX.test(compact)) return 'Toll-free or service number';
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const before = text.slice(Math.max(lineStart, start - 80), start);
  if (SERVICE_WORDS.test(before)) return 'Looks like a helpline';
  return undefined;
}

// Same-line signs that a contact detail belongs to an organisation: company
// registration and VAT numbers, legal forms and web addresses, as in letterheads and footers.
const ORG_CONTEXT = /(?:^|[^\p{L}])(?:IČO?|DIČ|VAT(?: (?:No|Reg))?|USt-?IdNr|Steuernummer|HRB|SIRE[NT]|TVA|KvK|BTW|NIF|CIF|P\.? ?IVA|Reg(?:istration)?\.? ?No|Company (?:No|Number|Reg)|ABN|ACN|EIN)\b|www\.|\b(?:s\.r\.o\.|z\.s\.p\.o\.?|a\.s\.|GmbH|AG|Ltd|LLC|LLP|PLC|Inc\.?|Corp\.?|S\.A\.|SAS|SARL|S\.p\.A\.|S\.r\.l\.|B\.V\.|N\.V\.|Oy|AB|ApS|Sp\. z o\.o\.)(?![\p{L}])/u;
// Mailboxes that belong to a team or company rather than a person.
const GENERIC_MAILBOX = /^(?:info|kontakt|contact|contacto|contatto|office|kancelar|support|help|hello|hi|sales|admin|enquiries|inquiries|service|customerservice|noreply|no-reply|press|media|hr|jobs|careers|billing|invoices?|accounts|mail|team|reception|post|postmaster|webmaster|privacy|dpo|legal|marketing|orders|booking|bookings)(?:[._-][a-z]+)?@/i;

/**
 * Flags contact details (phones, emails, addresses, links) that look like an
 * organisation's or a public service's rather than a private person's.
 */
export function contactPublicHint(text: string, start: number, end: number, type: EntityType): string | undefined {
  const match = text.slice(start, end);
  if (type === 'phone') {
    const hint = phonePublicHint(text, start, match);
    if (hint) return hint;
  }
  if (type === 'email' && GENERIC_MAILBOX.test(match)) return 'Generic company mailbox';
  if (type === 'phone' || type === 'email' || type === 'url' || type === 'address') {
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = text.indexOf('\n', end);
    const line = text.slice(lineStart, start) + ' ' + text.slice(end, lineEnd < 0 ? text.length : lineEnd);
    if (ORG_CONTEXT.test(line)) return 'Company letterhead or footer';
  }
  return undefined;
}

interface Rule {
  type: EntityType;
  re: RegExp;
  validate?: (match: string) => boolean;
  publicHint?: (text: string, start: number, match: string) => string | undefined;
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
  { type: 'ssn', re: /\b(?!000|666|9\d\d)\d{3}[- ](?!00)\d{2}[- ](?!0000)\d{4}\b/g },
  // US ITIN: 9XX-7X-XXXX style, middle group 50-65, 70-88, 90-92 or 94-99.
  { type: 'ssn', re: /\b9\d{2}[- ](?:5\d|6[0-5]|7\d|8[0-8]|9[0-24-9])[- ]\d{4}\b/g },
  { type: 'card', re: /\b\d(?:[ -]?(?:\r?\n[ \t]*)?\d){12,18}\b/g, validate: luhn },
  { type: 'iban', re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g, validate: validIban },
  {
    type: 'ip',
    re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
  },
  { type: 'ip', re: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g },
  {
    type: 'phone',
    // Optional country code, optional area code in parentheses, then digit groups.
    // Groups may be split across a line break (wrapped text, PDF lines, OCR).
    // Never stop part-way through a longer number such as a reference.
    re: new RegExp(
      String.raw`(?:\+\d{1,3}${SEP}?|(?<![\d.-])1[ .-])?(?:\(\d{1,4}\)${SEP}?)?(?<![\d+])\d{2,5}(?:${SEP}\d{2,6}){1,4}\b(?![.-]?\d)|\+\d{8,15}\b`,
      'g',
    ),
    validate: (m) => {
      const n = digits(m).length;
      if (n < 7 || n > 15) return false;
      // 3-2-4 grouping is an SSN/ITIN/EIN shape, not a phone number.
      if (/^\d{3}[- ]\d{2}[- ]\d{4}$/.test(m.trim())) return false;
      // One wrapped line is plausible; numbers spread over several lines are likely a table.
      if ((m.match(/\n/g) ?? []).length > 1) return false;
      // Skip things that look like dates.
      const flat = m.replace(/\s+/g, '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(flat)) return false;
      if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(flat)) return false;
      return true;
    },
    publicHint: phonePublicHint,
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
      const hint = rule.publicHint?.(text, start, value);
      spans.push({ start, end: start + value.length, type: rule.type, source: 'pattern', ...(hint && { publicHint: hint }) });
    }
  }
  return dedupe(spans);
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Finds every occurrence of each term (case-insensitive unless asked, whitespace-tolerant). */
export function findTerms(
  text: string,
  terms: { text: string; type: EntityType }[],
  source: Span['source'] = 'term',
  caseSensitive = false,
): Span[] {
  const spans: Span[] = [];
  for (const term of terms) {
    const t = term.text.trim();
    if (t.length < 2) continue;
    const pattern = t.split(/\s+/).map(escapeRe).join('\\s+');
    const wordy = /^\w/.test(t) && /\w$/.test(t);
    const re = new RegExp(wordy ? `(?<![\\w])${pattern}(?![\\w])` : pattern, caseSensitive ? 'g' : 'gi');
    for (const m of text.matchAll(re)) {
      spans.push({ start: m.index!, end: m.index! + m[0].length, type: term.type, source });
    }
  }
  return spans;
}

// Field labels a model sometimes returns as if they were the sensitive value.
const LABEL_WORDS = new Set([
  'ssn', 'itin', 'ein', 'tin', 'ssn/itin', 'itin/ssn', 'ssn or itin', 'dob', 'date of birth', 'name', 'full name',
  'first name', 'last name', 'address', 'phone', 'phone number', 'telephone', 'mobile', 'email', 'e-mail', 'id',
  'id number', 'account', 'account number', 'policy number', 'member id', 'patient id', 'passport',
  'passport number', 'license', 'licence', "driver's license", 'social security number', 'tax id',
  'taxpayer identification number', 'individual taxpayer identification number', 'signature', 'n/a', 'none',
  'redacted',
]);

/** Rejects values a model returned that can't be the sensitive data itself. */
export function plausibleEntity(text: string, type: EntityType): boolean {
  const t = text.trim();
  if (t.length < 2) return false;
  if (LABEL_WORDS.has(t.toLowerCase().replace(/[:#.]+$/, '').trim())) return false;
  // Numbers must contain digits.
  if (['phone', 'ssn', 'card', 'iban', 'ip', 'id'].includes(type) && !/\d/.test(t)) return false;
  return true;
}

/** Drops spans fully contained in an earlier-listed span; keeps partial overlaps. */
export function dedupe(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    const cover = out.find((o) => o.start <= s.start && o.end >= s.end);
    if (cover) {
      // Keep a public hint from a duplicate of the same text (e.g. the AI saying a rule match is a company's).
      if (s.publicHint && !cover.publicHint && cover.start === s.start && cover.end === s.end) cover.publicHint = s.publicHint;
      continue;
    }
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
