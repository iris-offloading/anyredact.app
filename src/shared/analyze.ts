import { dedupe, detectPatterns, findTerms, type EntityType, type Span } from './detect.ts';
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
  if (opts.ai) {
    spans.push(...findTerms(text, opts.ai, 'ai'));
    names.push(...opts.ai.filter((e) => e.type === 'name').map((e) => e.text));
  }
  // Once a name is known, catch every other mention of it, including first or last name alone.
  const variants = nameVariants(names).map((t) => ({ text: t, type: 'name' as EntityType }));
  spans.push(...findTerms(text, variants, 'pattern', true));

  const out: UnitSpan[] = [];
  for (const s of dedupe(spans)) {
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
