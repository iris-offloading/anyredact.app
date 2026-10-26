// Compares Workers AI models on a fixed set of documents with known answers.
// Runs against a preview deployment, where MODEL_TRIALS lets a request pick the model.
//
//   node scripts/bench-models.mjs https://<preview>.workers.dev @cf/meta/llama-3.3-70b-instruct-fp8-fast @cf/openai/gpt-oss-120b
//
// For each model it reports recall (expected values found), false positives
// (values that must not be redacted), speed and token usage.

// A model may carry extra run options as JSON: '@cf/x/y{"reasoning_effort":"low"}'.
const [base, ...models] = process.argv.slice(2);
if (!base || !models.length) {
  console.error('usage: node scripts/bench-models.mjs <preview-url> <model> [model...]');
  process.exit(1);
}

// `find`: every value that should be redacted. `keep`: things that must not be.
export const CASES = [
  {
    name: 'IRS notice',
    text: `Department of the Treasury
Internal Revenue Service
Notice CP01A
Date: March 14, 2025

JOHN Q TAXPAYER
1234 ELM STREET APT 5B
SPRINGFIELD, IL 62704

Taxpayer ID number (ITIN): 912-71-4567
SSN: 123-45-6789

Dear John Q Taxpayer,
We received your request for an Identity Protection PIN. Your IP PIN is 482913.
If you have questions, call us toll-free at 800-908-4490.
For TTY/TDD help, call 800-829-4059.
Callers outside the U.S. can call 1-267-941-1000.

Next steps
Keep this notice for your records.`,
    find: ['JOHN Q TAXPAYER', 'John Q Taxpayer', '1234 ELM STREET APT 5B', '912-71-4567', '123-45-6789', '482913'],
    keep: ['SSN', 'ITIN', 'Next steps', 'Internal Revenue Service', 'Notice CP01A', 'Department of the Treasury'],
  },
  {
    name: 'Clinic letter',
    text: `Riverside Family Clinic
22 Harbour Road, Bristol BS1 4DJ

Patient: Siobhán O'Neill
DOB: 04/09/1987
NHS number: 485 777 3456

Dear Dr. Okonkwo,

I saw Ms O'Neill on 2 June for follow-up of her type 2 diabetes and depression. Her HbA1c was 58 mmol/mol.
She lives with her partner, Tomás Ferreira, who can be reached on 07700 900461 or tomas.ferreira@gmail.com.
Please continue metformin 500mg twice daily.

Kind regards,
Dr. Amelia Chen-Whitfield
Consultant, Riverside Family Clinic`,
    find: ["Siobhán O'Neill", '04/09/1987', '485 777 3456', 'Okonkwo', 'Tomás Ferreira', '07700 900461', 'tomas.ferreira@gmail.com', 'Amelia Chen-Whitfield'],
    keep: ['Patient', 'NHS number', 'Kind regards', 'metformin'],
  },
  {
    name: 'Email thread',
    text: `From: Priya Raghunathan <priya.r@northwind-logistics.com>
To: Wei Zhang; Kwame Mensah-Bonsu
Subject: Re: Visa paperwork for Lukas

Hi Wei,

Lukas Schäfer's passport number is C01X00T47 and he arrives on 12 May. His home address is
Bergmannstraße 17, 10961 Berlin. Please book him into the Hilton near the office.

Kwame, can you send the offer letter to his personal email lukas.schaefer87@web.de?
His mobile is +49 151 2345 6789.

Thanks,
Priya

-----Original Message-----
From: Wei Zhang
Sent: Monday
Lukas asked whether his wife, Anja, can join him in July.`,
    find: ['Priya Raghunathan', 'priya.r@northwind-logistics.com', 'Wei Zhang', 'Kwame Mensah-Bonsu', 'Lukas', 'Lukas Schäfer', 'C01X00T47', 'Bergmannstraße 17, 10961 Berlin', 'lukas.schaefer87@web.de', '+49 151 2345 6789', 'Anja'],
    keep: ['Subject', 'Original Message', 'Hilton', 'Monday', 'Thanks'],
  },
  {
    name: 'HR form',
    text: `EMPLOYEE CHANGE FORM

Employee name: GARCÍA LÓPEZ, MARÍA JOSÉ
Employee ID: E-204518
Department: Finance
Manager: Robert Kim

New bank details
Account holder: Maria Jose Garcia Lopez
IBAN: GB82 WEST 1234 5698 7654 32
Card on file: 4111 1111 1111 1111

Emergency contact: Daniel García (brother), +34 612 345 678
Reason for change: Moving to 48 Calle de Alcalá, 28014 Madrid.

Approved by: Hannah Okafor, HR Business Partner
For questions about this form, call HR Support on 0800 123 4567.`,
    find: ['GARCÍA LÓPEZ, MARÍA JOSÉ', 'E-204518', 'Robert Kim', 'Maria Jose Garcia Lopez', 'GB82 WEST 1234 5698 7654 32', '4111 1111 1111 1111', 'Daniel García', '+34 612 345 678', '48 Calle de Alcalá, 28014 Madrid', 'Hannah Okafor'],
    keep: ['EMPLOYEE CHANGE FORM', 'Employee name', 'Finance', 'Account holder', 'IBAN', 'HR Business Partner', '0800 123 4567'],
  },
  {
    name: 'Support log',
    text: `2025-03-02 10:14:07 INFO  login ok user=jsmith92 ip=203.0.113.45
2025-03-02 10:15:22 WARN  password reset requested for jennifer.smith@outlook.com
2025-03-02 10:15:40 INFO  ticket #88213 opened by Jennifer Smith: "my card ending 4242 was charged twice"
2025-03-02 10:16:03 DEBUG session token=eyJhbGciOiJIUzI1NiJ9.abc123 for jsmith92
2025-03-02 10:20:11 INFO  agent Marcus replied: "Hi Jennifer, refund issued to your Visa."
2025-03-02 10:21:45 ERROR  payment gateway timeout (retry 2/3)`,
    find: ['jsmith92', '203.0.113.45', 'jennifer.smith@outlook.com', 'Jennifer Smith', 'eyJhbGciOiJIUzI1NiJ9.abc123', 'Jennifer', 'Marcus'],
    keep: ['INFO', 'WARN', 'ERROR', 'DEBUG', 'payment gateway timeout', 'Visa'],
  },
];

async function run(spec, c) {
  const brace = spec.indexOf('{');
  const model = brace < 0 ? spec : spec.slice(0, brace);
  const options = brace < 0 ? undefined : JSON.parse(spec.slice(brace));
  const started = Date.now();
  const res = await fetch(new URL('/api/detect', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: new URL(base).origin },
    body: JSON.stringify({ text: c.text, model, options }),
  });
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  return { ...body, status: res.status, wall: Date.now() - started };
}

function score(c, entities) {
  const found = entities.map((e) => e.text);
  // A value counts as found when a returned string covers it, e.g. "Lukas Schäfer's" or the full address line.
  const missed = c.find.filter((v) => !found.some((f) => f.includes(v)));
  const wrong = c.keep.filter((v) => found.some((f) => f === v || (f.includes(v) && v.length > 3 && !c.find.some((x) => f.includes(x)))));
  const extra = found.filter((f) => !c.find.some((v) => f.includes(v) || v.includes(f)) && !c.keep.includes(f));
  return { missed, wrong, extra };
}

const report = [];
for (const model of models) {
  const row = { model, found: 0, total: 0, wrong: 0, ms: 0, prompt: 0, completion: 0, errors: 0, details: [] };
  for (const c of CASES) {
    const r = await run(model, c);
    if (r.error) {
      row.errors++;
      row.details.push({ case: c.name, error: r.error });
      continue;
    }
    const s = score(c, r.entities ?? []);
    row.total += c.find.length;
    row.found += c.find.length - s.missed.length;
    row.wrong += s.wrong.length;
    row.ms += r.ms ?? r.wall;
    row.prompt += r.usage?.prompt_tokens ?? 0;
    row.completion += r.usage?.completion_tokens ?? 0;
    row.details.push({ case: c.name, ms: r.ms, ...s });
  }
  report.push(row);
  console.error(`done ${model}`);
}
console.log(JSON.stringify(report, null, 2));
