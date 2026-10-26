import { contactPublicHint, dedupe, SSN_SHAPE, detectPatterns, findTerms, plausibleEntity, type EntityType, type Span } from './detect.ts';
import { detectNames, nameVariants } from './names.ts';

export interface Term {
  text: string;
  type: EntityType;
  /** Set by the AI for contact details that belong to a business or public service. */
  owner?: 'person' | 'organization';
}

const CONTACT_TYPES = new Set<EntityType>(['phone', 'email', 'url', 'address']);
// Types the AI may mark as an organisation's: contact details plus company registration and VAT numbers.
const ORG_TYPES = new Set<EntityType>([...CONTACT_TYPES, 'id']);

/**
 * Whether a finding starts ticked. Public contacts start unticked, and so do
 * dates only the date rule matched: the AI reports birth dates and other
 * personal dates, while the rule also matches every invoice and letter date.
 */
export function startsTicked(s: Span): boolean {
  return !s.publicHint && !(s.type === 'date' && s.source === 'pattern');
}

export interface UnitSpan extends Span {
  unitId: string;
}

/**
 * Runs every detector over the whole document at once, so matches can cross
 * unit boundaries (a phone number wrapped onto the next paragraph), then
 * splits each match back into unit-relative pieces.
 */
export function analyzeUnits(
  units: { id: string; text: string }[],
  opts: { types: Iterable<EntityType>; terms?: Term[]; ai?: Term[] | null },
): UnitSpan[] {
  const types = new Set(opts.types);
  const starts: number[] = [];
  let text = '';
  for (const u of units) {
    if (text) text += '\n';
    starts.push(text.length);
    text += u.text;
  }

  const spans: Span[] = [...findTerms(text, opts.terms ?? []), ...detectPatterns(text, types)];
  const names: string[] = [];
  if (types.has('name')) {
    const found = detectNames(text);
    spans.push(...found);
    names.push(...found.map((s) => text.slice(s.start, s.end)));
  }
  const ai = opts.ai?.filter((e) => plausibleEntity(e.text, e.type));
  if (ai) {
    const orgOwned = new Set(ai.filter((e) => e.owner === 'organization' && ORG_TYPES.has(e.type)).map((e) => e.text.trim().toLowerCase()));
    for (let s of findTerms(text, ai, 'ai')) {
      // Models sometimes call an SSN/ITIN-shaped number a phone number.
      if (s.type === 'phone' && SSN_SHAPE.test(text.slice(s.start, s.end))) s = { ...s, type: 'ssn' };
      if (ORG_TYPES.has(s.type) && orgOwned.has(text.slice(s.start, s.end).toLowerCase())) s = { ...s, publicHint: 'AI: belongs to an organisation' };
      spans.push(s);
    }
    names.push(...ai.filter((e) => e.type === 'name').map((e) => e.text));
  }
  // Once a name is known, catch every other mention of it, including first or last name alone.
  const variants = nameVariants(names).map((t) => ({ text: t, type: 'name' as EntityType }));
  spans.push(...findTerms(text, variants, 'pattern', true));

  // Business and public-service contact details start unticked. The same
  // number or address is treated the same everywhere: if any mention looks
  // public (e.g. next to "Helpline" or in a letterhead), flag every mention.
  const merged = dedupe(spans);
  for (const s of merged) if (!s.publicHint && CONTACT_TYPES.has(s.type)) s.publicHint = contactPublicHint(text, s.start, s.end, s.type);
  const contactKey = (s: Span) => {
    const v = text.slice(s.start, s.end);
    return s.type === 'phone' ? `phone:${v.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')}` : `${s.type}:${v.toLowerCase()}`;
  };
  const publicContacts = new Map<string, string>();
  for (const s of merged) if (s.publicHint && CONTACT_TYPES.has(s.type)) publicContacts.set(contactKey(s), s.publicHint);
  for (const s of merged) {
    const hint = CONTACT_TYPES.has(s.type) && !s.publicHint ? publicContacts.get(contactKey(s)) : undefined;
    if (hint) s.publicHint = hint;
  }

  const out: UnitSpan[] = [];
  for (const s of merged) {
    // Binary search for the unit holding the span's start, then walk forward.
    let lo = 0;
    let hi = units.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= s.start) lo = mid;
      else hi = mid - 1;
    }
    for (let i = lo; i < units.length && starts[i] < s.end; i++) {
      const uStart = starts[i];
      const uEnd = uStart + units[i].text.length;
      const a = Math.max(s.start, uStart);
      const b = Math.min(s.end, uEnd);
      if (a >= b || !text.slice(a, b).trim()) continue;
      out.push({ ...s, unitId: units[i].id, start: a - uStart, end: b - uStart });
    }
  }
  return out;
}
