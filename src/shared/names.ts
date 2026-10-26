// Offline person-name detection. Without a model we rely on context that
// strongly signals a name: titles (Dr. …), form labels (Name: …), letter
// greetings and sign-offs, and a list of common first names followed by a
// capitalised surname. Found names are then matched everywhere else in the
// document, including surname-only and first-name-only mentions.
import { dedupe, type Span } from './detect.ts';

// A capitalised name part: "ANNE", "Anne", "McDonald", "O'Neil", "Smith-Jones" or "J.".
const PART = String.raw`(?:\p{Lu}['’]\p{Lu}[\p{Ll}\p{M}]+|\p{Lu}{2,}(?:['’\-]\p{Lu}+)*(?![\p{Ll}\p{M}])|\p{Lu}[\p{Ll}\p{M}]+(?:\p{Lu}[\p{Ll}\p{M}]+)*(?:['’\-]\p{Lu}?[\p{Ll}\p{M}]+)*|\p{Lu}\.)`;
// Between parts: spaces/tabs only, never a line break.
const NAME = String.raw`${PART}(?:[ \t]+(?:(?:van|von|de|del|der|den|da|di|du|la|le|bin|ibn|al)[ \t]+){0,2}${PART}){0,3}`;

const TITLES = String.raw`(?:Mr|Mrs|Ms|Mx|Miss|Dr|Prof|Professor|Sir|Dame|Madam|Mme|Mlle|Herr|Frau|Sr|Sra|Srta|Rev|Fr|Hon|Judge|Officer|Det|Sgt|Capt|Lt|Col|Gen)`;

const LABELS = [
  'name', 'full name', 'first name', 'last name', 'surname', 'given name', 'family name', 'maiden name',
  'patient', 'patient name', 'client', 'client name', 'customer', 'customer name', 'employee', 'employee name',
  'applicant', 'tenant', 'landlord', 'contact', 'contact person', 'attn', 'attention', 'from', 'to', 'cc',
  'signed', 'signed by', 'signature', 'prepared by', 'reviewed by', 'approved by', 'submitted by', 'author',
  'witness', 'beneficiary', 'insured', 'policyholder', 'account holder', 'account name', 'cardholder',
  'card holder', 'recipient', 'sender', 'payee', 'payer', 'doctor', 'physician', 'nurse', 'parent',
  'guardian', 'spouse', 'student', 'teacher', 'manager', 'supervisor', 'owner', 'buyer', 'seller',
  'borrower', 'lender', 'claimant', 'defendant', 'plaintiff', 'victim', 'suspect', 'emergency contact',
  'next of kin', 'nombre', 'nom', 'prénom', 'vorname', 'nachname',
]
  // Spell each label case-insensitively by hand: an `i` flag would also make the name pattern match lowercase words.
  .map((l) => l.replace(/\p{L}/gu, (c) => (c.toLowerCase() === c.toUpperCase() ? c : `[${c.toLowerCase()}${c.toUpperCase()}]`)))
  .join('|');

// Words that mark the capitalised phrase as an organisation or place, not a person.
const ORG = new Set(
  `Inc Ltd LLC Llc Corp Co Company Corporation Group Team Department Dept Office Services Service Bank Hospital Clinic
  University College School Street St Avenue Ave Road Rd Lane Drive Boulevard Blvd Suite Floor Building City County State
  Accounts Support Sales Billing Admin Administration HR Finance Legal Committee Board`
    .split(/\s+/)
    .filter(Boolean),
);

// Words that start with a capital but end a name rather than belong to it.
const STOP = new Set(
  `The A An And Or Of For In On At By To From With Re Fwd Subject Date Dear Hi Hello Thanks Thank Regards Best Sincerely
  Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April June July August September
  October November December Jan Feb Mar Apr Jun Jul Aug Sep Sept Oct Nov Dec Phone Tel Email Mobile Fax Address
  Account Number No ID DOB Policy Invoice Total Amount Page Yes No N/A NA Male Female Unknown`
    .split(/\s+/)
    .filter(Boolean),
);

// Ordinary words that often start a line or heading ("Next steps", "Your
// account"). A candidate name starting with one is rejected; later in a name
// they end it. Names that are also words, like Will or May, are left out.
// Compared in lower case.
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

// Common given names that are rarely ordinary words, from many languages.
const FIRST_NAMES = new Set(
  `aaron abdul abigail adam adrian ahmed aisha alan albert alejandro alex alexander alexandra alexis ali alice alicia
  alison allison amanda amber amelia amir amy ana andre andrea andreas andrew andy angela angelo anita ann anna anne
  annie anthony antonio arjun arthur ashley aurora barbara ben benjamin bernard beth betty beverly bianca brandon
  brenda brian brittany bruce bryan camila carl carla carlos carmen carol caroline catherine cecilia charles charlotte
  chen cheryl chloe chris christian christina christine christopher cindy claire clara claudia colin connor craig
  cynthia daniel daniela danielle david deborah debra denise dennis derek diana diane diego dmitri dominic donald donna
  dorothy douglas dylan edward elena elijah elizabeth ella ellen emily emma eric erica erik ethan eva evelyn fatima
  felix fernando fiona francesca francesco francisco gabriel gabriela gary george georgia gerald giovanni giulia
  gloria gregory hannah harold harry heather helen henry hiroshi hugo ian irene isaac isabel isabella ivan jack jacob
  jacqueline james jamie jane janet janice jason javier jean jeffrey jennifer jeremy jessica joan joanna joe john
  johnny jonathan jorge jose joseph joshua juan judith julia julian julie justin karen katherine kathleen kathryn
  katie kayla keith kelly kenneth kevin kimberly kyle laura lauren lawrence leah leo leonardo liam linda lisa lucas
  lucia luis luke lydia madison maria mariana marie marilyn mario martha martin mary matthew megan melissa mia
  michael michelle miguel mohammed muhammad nancy natalie nathan nicholas nicole noah olga olivia oscar pablo pamela
  patricia patrick paul paula pedro peter philip priya rachel rafael rahul raj ralph ramon raymond rebecca richard
  ricardo robert roberto rachel rajesh ruth ryan samantha samuel sandra sara sarah scott sean sebastian sergei sharon
  shirley simon sofia sophia sophie stephanie stephen steven susan sylvia teresa theresa thomas timothy tina tyler
  valentina valerie vanessa victor victoria vincent virginia walter wei william yuki zachary zoe`
    .split(/\s+/)
    .filter(Boolean),
);

function trimName(raw: string): string {
  const words = raw.split(/[ \t]+/);
  const kept: string[] = [];
  if (COMMON.has(words[0]?.replace(/[.,]$/, '').toLowerCase())) return '';
  for (const w of words) {
    const bare = w.replace(/[.,]$/, '');
    if (ORG.has(bare)) return '';
    if (STOP.has(bare) || COMMON.has(bare.toLowerCase())) break;
    kept.push(w);
  }
  return kept.join(' ').replace(/[.,]$/, '');
}

function push(spans: Span[], text: string, start: number, raw: string) {
  const name = trimName(raw);
  if (name.replace(/[^\p{L}]/gu, '').length < 2) return;
  const offset = text.indexOf(name, start);
  if (offset < 0) return;
  spans.push({ start: offset, end: offset + name.length, type: 'name', source: 'pattern' });
}

/** Finds person names from context clues in a block of text. */
export function detectNames(text: string): Span[] {
  const spans: Span[] = [];
  const rules: RegExp[] = [
    // Dr. Jane Doe, Mrs Smith
    new RegExp(String.raw`\b${TITLES}\.?[ \t]+(${NAME})`, 'gu'),
    // Name: Jane Doe   /   PATIENT NAME - DOE, JANE
    new RegExp(String.raw`(?:^|[\n\r\t|;]|\s{2,})[ \t]*(?:${LABELS})[ \t]*[:\-–][ \t]*(${NAME}(?:,[ \t]*${NAME})?)`, 'gu'),
    // Dear Jane, / Hi Jane Doe,
    new RegExp(String.raw`\b(?:Dear|Hi|Hello|Hey|Attn\.?)[ \t]+(?:${TITLES}\.?[ \t]+)?(${NAME})\s*[,:!\n]`, 'gu'),
    // Sincerely,\nJane Doe
    new RegExp(String.raw`\b(?:Sincerely|Regards|Best regards|Kind regards|Warm regards|Best wishes|Best|Thanks|Thank you|Cheers|Yours truly|Yours faithfully|Respectfully)[ \t]*,?[ \t]*\r?\n[ \t]*(${NAME})`, 'gu'),
  ];
  for (const re of rules) {
    for (const m of text.matchAll(re)) {
      const group = m[1];
      if (!group) continue;
      push(spans, text, m.index! + m[0].indexOf(group), group);
    }
  }
  // Known first name followed by a capitalised surname: "Maria Gonzalez".
  // The surname is a lookahead so a non-name word before it doesn't swallow the pair.
  const pair = new RegExp(String.raw`(?<![\p{L}\p{M}])(\p{Lu}[\p{Ll}\p{M}]+)(?=((?:[ \t]+${PART}){1,2}))`, 'gu');
  for (const m of text.matchAll(pair)) {
    if (!FIRST_NAMES.has(m[1].toLowerCase())) continue;
    push(spans, text, m.index!, m[1] + m[2]);
  }
  return dedupe(spans);
}

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
