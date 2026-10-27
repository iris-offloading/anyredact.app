// Name variants: once the AI reports a person's name, every other mention of
// it is redacted too, including surname-only and first-name-only mentions.

// Parts of organisation and place names, never matched as a name on their own.
const ORG = new Set(
  `Inc Ltd LLC Llc Corp Co Company Corporation Group Team Department Dept Office Services Service Bank Hospital Clinic
  University College School Street St Avenue Ave Road Rd Lane Drive Boulevard Blvd Suite Floor Building City County State
  Accounts Support Sales Billing Admin Administration HR Finance Legal Committee Board`
    .split(/\s+/)
    .filter(Boolean),
);

// Capitalised words that are not names.
const STOP = new Set(
  `The A An And Or Of For In On At By To From With Re Fwd Subject Date Dear Hi Hello Thanks Thank Regards Best Sincerely
  Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April June July August September
  October November December Jan Feb Mar Apr Jun Jul Aug Sep Sept Oct Nov Dec Phone Tel Email Mobile Fax Address
  Account Number No ID DOB Policy Invoice Total Amount Page Yes No N/A NA Male Female Unknown`
    .split(/\s+/)
    .filter(Boolean),
);

// Ordinary words, so a name part like "Next" or "Your" is not matched alone.
// Names that are also words, like Will or May, are left out. Compared in lower case.
const COMMON = new Set(
  `about above account action actions additional address advice after again agenda all also amount an and answer
  answers any appeal application apply are as ask at attached attendees available back background balance be
  before below benefit benefits bill both but by call can cannot case change changes check claim click close
  complete confirm contact continue copy could current customer date day days deadline details do does done
  download due each email end enter even every example extra fee fees fill find first follow following for form
  forms free from full further general get go guide have help her here his how however if important in income
  information instructions introduction is it its just keep last later learn letter line list location log make
  many minutes more most must my name need new next no not note notes notice now number of office on once
  online only open or order other our out over overview page paid part pay payment payments people period
  personal phone please post previous print process read reason record reference register remember renew
  report request required review same save section see send service services should sign since so some start
  statement status step steps still submit summary support take tax terms than that the their them then there
  these they this those through time to today total under until update upload use using visit was we website
  what when where which while who why with within without write year years yes you your yours`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * Given full names found anywhere in a document, returns the strings worth
 * matching everywhere: the full name plus each part long enough to be
 * identifying ("Jane Doe" → "Jane Doe", "Jane", "JANE", "Doe", "DOE").
 * Match these case-sensitively so "Will" doesn't catch "will".
 */
export function nameVariants(names: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const name of names) {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (clean.length < 2) continue;
    out.add(clean);
    // "DOE, JANE" → also "JANE DOE" parts.
    for (const part of clean.split(/[\s,]+/)) {
      const bare = part.replace(/\.$/, '');
      if (bare.length >= 3 && /^\p{Lu}/u.test(bare) && !STOP.has(bare) && !ORG.has(bare) && !COMMON.has(bare.toLowerCase())) {
        out.add(bare);
        out.add(bare.toUpperCase());
      }
    }
  }
  return [...out];
}
