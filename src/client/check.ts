import { MAX_CHARS } from '../shared/pricing.ts';
import { postApi } from './ai.ts';
import type { Finding, ManualBox, Rect, Unit } from './types.ts';

// Final check before download: what would still be readable in the output is
// sent to a decision model, which estimates per category whether anything
// sensitive is left.

export const CHECK_LABELS: Record<string, string> = {
  name: 'names',
  contact: 'addresses, emails or phone numbers',
  number: 'ID, account or card numbers',
  date: 'birth dates or other personal dates',
  secret: 'passwords, tokens, usernames or IP addresses',
  health: 'health, financial or other sensitive details',
};

// Below this a category is not mentioned. On the benchmark documents, fully
// redacted text scored under 0.3 for names and contacts, and an unredacted
// name usually scored over 0.9; lower values trade more false alarms for fewer misses.
export const RISK_THRESHOLD = 0.4;

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The document text as it will read after redaction, with removed characters as █. */
export function remainingText(units: Unit[], findings: Finding[], boxes: ManualBox[]): string {
  return units
    .map((u) => {
      // Work in UTF-16 offsets like the findings do.
      const masked = u.text.split('');
      for (const f of findings) {
        if (!f.enabled || f.unitId !== u.id) continue;
        for (let i = f.start; i < f.end; i++) masked[i] = '█';
      }
      const pageBoxes = boxes.filter((b) => b.page === u.page);
      if (pageBoxes.length && u.rectsFor) {
        for (let i = 0; i < masked.length; i++) {
          if (masked[i] === '█' || !masked[i].trim()) continue;
          if (u.rectsFor(i, i + 1).some((r) => pageBoxes.some((b) => overlaps(r, b)))) masked[i] = '█';
        }
      }
      return masked.join('');
    })
    .join('\n\n');
}

/** Returns the categories that are likely still readable, most likely first. */
export async function checkRemaining(text: string): Promise<string[]> {
  if (!text.replace(/[█\s]/g, '')) return [];
  // Longer documents are checked from the start.
  const data = await postApi<{ risks?: Record<string, number> }>('/api/check', { text: text.slice(0, MAX_CHARS) }, 'The final check failed');
  return Object.entries(data.risks ?? {})
    .filter(([k, p]) => p >= RISK_THRESHOLD && k in CHECK_LABELS)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
}
