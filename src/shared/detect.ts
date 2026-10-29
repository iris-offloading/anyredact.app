// Matching, filtering and masking of detected values. Runs in the browser,
// the Worker and tests, so it must stay dependency-free.

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
  source: 'ai' | 'term' | 'visual';
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

// Free or non-geographic prefixes used by businesses and public services:
// UK 0800/0808/0300/03xx/084x/087x, US/Canada toll-free 8xx, Australia 1300/1800.
const SERVICE_PREFIX = /^(?:\+44|0)?(?:80[08]|3\d\d|84\d|87\d)|^(?:\+?1)?\(?8(?:00|33|44|55|66|77|88)\)?|^(?:\+61)?1[38]00/;
const SERVICE_WORDS = /\b(?:helpline|hotline|freephone|textphone|relay uk|call us|contact us|customer (?:service|support|care)|enquiries|inquiries|switchboard|reception|main office|head office|support line|advice line|information line|emergency services|callers|tty|tdd|toll[- ]free|questions|for (?:more )?information|for help|assistance)\b/i;

/** Flags phone numbers that look like a public or business line rather than a person's. */
function phonePublicHint(text: string, start: number, match: string): string | undefined {
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
/** A US SSN or ITIN: 3-2-4 digits. */
export const SSN_SHAPE = /^\d{3}[- ]\d{2}[- ]\d{4}$/;
const ORG_WINDOW = 80;
// Mailboxes that belong to a team or company rather than a person.
const GENERIC_MAILBOX = /^(?:info|kontakt|contact|contacto|contatto|office|kancelar|support|help|hello|hi|sales|admin|enquiries|inquiries|service|customerservice|noreply|no-reply|press|media|hr|jobs|careers|billing|invoices?|accounts|mail|team|reception|post|postmaster|webmaster|privacy|dpo|legal|marketing|orders|booking|bookings)(?:[._-][a-z]+)?@/i;

/**
 * Flags contact details (phones, emails, addresses, links) that look like an
 * organisation's or a public service's rather than a private person's.
 */
export function contactPublicHint(text: string, start: number, end: number, type: EntityType, personal = false): string | undefined {
  const match = text.slice(start, end);
  if (type === 'phone') {
    const hint = phonePublicHint(text, start, match);
    if (hint) return hint;
  }
  if (type === 'email' && GENERIC_MAILBOX.test(match)) return 'Generic company mailbox';
  // A company word nearby is only a guess, so it gives way when the AI says the contact is a person's.
  if (!personal && (type === 'phone' || type === 'email' || type === 'url' || type === 'address')) {
    // The same line, but no further than a short window: in a paragraph of
    // prose, a company named two sentences away says nothing about an address.
    const lineStart = Math.max(text.lastIndexOf('\n', start - 1) + 1, start - ORG_WINDOW);
    const lineEnd = text.indexOf('\n', end);
    const line = text.slice(lineStart, start) + ' ' + text.slice(end, Math.min(lineEnd < 0 ? text.length : lineEnd, end + ORG_WINDOW));
    if (ORG_CONTEXT.test(line)) return 'Company letterhead or footer';
  }
  return undefined;
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

/** Splits text into pieces of at most `size` characters, at the last line break or space where there is one. */
export function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    let end = Math.min(text.length, pos + size);
    if (end < text.length) {
      const slice = text.slice(pos, end);
      const brk = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf(' '));
      if (brk > size / 2) end = pos + brk + 1;
    }
    chunks.push(text.slice(pos, end));
    pos = end;
  }
  return chunks;
}

// Private keys are found by their armour rather than by the model, which
// skips long blobs such as the key in a Google service account file. Line
// breaks may be real or escaped as \n, as in JSON and source code.
const KEY_LABEL = String.raw`(?:[A-Z0-9]+\s+)*PRIVATE\s+KEY(?:\s+BLOCK)?-----`;
const KEY_BEGIN = new RegExp(String.raw`-----BEGIN\s+${KEY_LABEL}`, 'g');
const KEY_END = new RegExp(String.raw`-----END\s+${KEY_LABEL}`, 'g');
const KEY_BREAK = /(\r?\n|\\+[nr])/;
const KEY_LINE = /^[ \t]*[A-Za-z0-9+/=]*[ \t]*$/;
const MAX_KEY = 20_000;

/** Length of the base64 lines at the start of `parts` (lines and breaks, as split with KEY_BREAK). */
function keyLines(parts: string[]): number {
  let n = 0;
  let taken = 0;
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0 && !KEY_LINE.test(parts[i])) break;
    n += parts[i].length;
    if (i % 2 === 0 && parts[i].trim()) taken = n;
  }
  return taken;
}

/**
 * Finds PEM, OpenSSH and PGP private keys, header to footer. A key cut off by
 * the end of the text, or starting before it, is taken as far as its base64 lines go.
 */
export function findPrivateKeys(text: string): string[] {
  const keys: [number, number][] = [];
  for (const begin of text.matchAll(KEY_BEGIN)) {
    const from = begin.index + begin[0].length;
    if (keys.length && begin.index < keys[keys.length - 1][1]) continue;
    KEY_END.lastIndex = from;
    const end = KEY_END.exec(text);
    const next = text.slice(from, from + MAX_KEY);
    keys.push([begin.index, end && end.index - from < MAX_KEY ? end.index + end[0].length : from + keyLines(next.split(KEY_BREAK))]);
  }
  for (const end of text.matchAll(KEY_END)) {
    if (keys.some(([a, b]) => end.index >= a && end.index < b)) continue;
    const before = text.slice(Math.max(0, end.index - MAX_KEY), end.index).split(KEY_BREAK).reverse();
    keys.push([end.index - keyLines(before), end.index + end[0].length]);
  }
  return keys.map(([a, b]) => text.slice(a, b).trim());
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
      if (cover.start === s.start && cover.end === s.end) {
        // The AI reads the context, so its type wins over a custom term's.
        if (s.source === 'ai' && cover.source !== 'ai' && s.type !== cover.type) {
          cover.type = s.type;
          cover.publicHint = s.publicHint;
        }
        // Keep a public hint from a duplicate of the same text.
        else if (s.publicHint && !cover.publicHint) cover.publicHint = s.publicHint;
      }
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
