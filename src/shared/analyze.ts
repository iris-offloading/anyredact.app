import { dedupe, detectPatterns, findTerms, phonePublicHint, plausibleEntity, type EntityType, type Span } from './detect.ts';
import { detectNames, nameVariants } from './names.ts';

export interface Term {
  text: string;
  type: EntityType;
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
    for (let s of findTerms(text, ai, 'ai')) {
      // Models sometimes call an SSN/ITIN-shaped number a phone number.
      if (s.type === 'phone' && /^\d{3}[- ]\d{2}[- ]\d{4}$/.test(text.slice(s.start, s.end))) s = { ...s, type: 'ssn' };
      const hint = s.type === 'phone' ? phonePublicHint(text, s.start, text.slice(s.start, s.end)) : undefined;
      spans.push(hint ? { ...s, publicHint: hint } : s);
    }
    names.push(...ai.filter((e) => e.type === 'name').map((e) => e.text));
  }
  // Once a name is known, catch every other mention of it, including first or last name alone.
  const variants = nameVariants(names).map((t) => ({ text: t, type: 'name' as EntityType }));
  spans.push(...findTerms(text, variants, 'pattern', true));

  // The same number should be treated the same everywhere: if any mention looks
  // like a public line (e.g. next to "Helpline"), flag every mention of it.
  const merged = dedupe(spans);
  const phoneKey = (s: Span) => text.slice(s.start, s.end).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  const publicPhones = new Map<string, string>();
  for (const s of merged) if (s.type === 'phone' && s.publicHint) publicPhones.set(phoneKey(s), s.publicHint);
  for (const s of merged) {
    const hint = s.type === 'phone' && !s.publicHint ? publicPhones.get(phoneKey(s)) : undefined;
    if (hint) s.publicHint = hint;
  }

  const out: UnitSpan[] = [];
  for (const s of merged) {
    for (let i = 0; i < units.length; i++) {
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
