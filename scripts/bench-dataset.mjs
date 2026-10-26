// Scores AI detection on public, labelled PII datasets, using the preview's batch mode.
//
//   node scripts/bench-dataset.mjs fetch <outdir>
//   node --experimental-strip-types scripts/bench-dataset.mjs run <preview-url> <model[{options}]> <data.json> [limit]
//
// `fetch` samples 1,000 rows of ai4privacy/open-pii-masking-500k (short
// multilingual sentences) and 600 of gretelai/synthetic_pii_finance_multilingual
// (full finance documents) from the Hugging Face dataset viewer.
// `run` reports, per label, how many labelled values the AI alone and the app
// as a whole (AI plus rules, default "Look for" types) would redact.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [mode, ...args] = process.argv.slice(2);

// Labels a redaction tool must catch. Everything else (cities, times, ages,
// companies, ordinary dates) is reported separately as optional.
const CORE = new Set(
  `GIVENNAME SURNAME TELEPHONENUM EMAIL STREET BUILDINGNUM ZIPCODE IDCARDNUM PASSPORTNUM TAXNUM DRIVERLICENSENUM SOCIALNUM
  CREDITCARDNUMBER name first_name last_name street_address email phone_number date_of_birth account_pin credit_card_number
  employee_id iban passport_number bban credit_card_security_code ipv4 ipv6 customer_id ssn driver_license_number password
  api_key user_name`.split(/\s+/).filter(Boolean),
);
// The app's default "Look for" types (DEFAULT_TYPES in src/client/main.ts).
const APP_TYPES = ['name', 'address', 'email', 'phone', 'id', 'ssn', 'date', 'card', 'iban', 'ip', 'other'];
// Workers AI prices in USD per million tokens [input, output], as quoted on the dashboard.
const PRICES = {
  '@cf/deepseek-ai/deepseek-v4.1-flash-1017': [0.3, 1.2],
  '@cf/openai/gpt-oss-120b': [0.35, 0.75],
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': [0.293, 2.253],
};

async function rows(dataset, split, offset, length = 100) {
  const url = `https://datasets-server.huggingface.co/rows?dataset=${dataset}&config=default&split=${split}&offset=${offset}&length=${length}`;
  for (let t = 0; t < 4; t++) {
    const res = await fetch(url).catch(() => null);
    if (res?.ok) return (await res.json()).rows.map((r) => r.row);
    await new Promise((r) => setTimeout(r, 2000 * 2 ** t));
  }
  return [];
}

// Deterministic spread of page offsets.
const offsets = (max, n) => Array.from({ length: n }, (_, i) => Math.floor(((i * 7919) % n) * (max / n) / 100) * 100);

async function fetchData(outdir) {
  const a = [];
  for (const off of offsets(116_000, 10)) a.push(...(await rows('ai4privacy/open-pii-masking-500k-ai4privacy', 'validation', off)));
  writeFileSync(
    path.join(outdir, 'ai4privacy.json'),
    JSON.stringify(a.map((r) => ({ text: r.source_text, lang: r.language, spans: r.privacy_mask.map(({ start, end, label }) => ({ start, end, label })) }))),
  );
  const g = [];
  for (const off of offsets(5_500, 6)) g.push(...(await rows('gretelai/synthetic_pii_finance_multilingual', 'test', off)));
  writeFileSync(
    path.join(outdir, 'gretel.json'),
    JSON.stringify(g.map((r) => ({ text: r.generated_text, lang: r.language, kind: r.expanded_type, spans: JSON.parse(r.pii_spans) }))),
  );
  console.log(`wrote ${a.length} + ${g.length} rows to ${outdir}`);
}

function occurrences(text, needle) {
  const out = [];
  for (let i = text.indexOf(needle); needle && i >= 0; i = text.indexOf(needle, i + 1)) out.push([i, i + needle.length]);
  return out;
}

// A labelled value counts as caught when at least half of its characters are covered.
function covered(gold, ranges) {
  let n = 0;
  for (let i = gold.start; i < gold.end; i++) if (ranges.some(([s, e]) => i >= s && i < e)) n++;
  return n * 2 >= gold.end - gold.start;
}

async function run(base, spec, file, limit) {
  const { analyzeUnits, startsTicked } = await import('../src/shared/analyze.ts');
  const brace = spec.indexOf('{');
  const model = brace < 0 ? spec : spec.slice(0, brace);
  const options = brace < 0 ? undefined : JSON.parse(spec.slice(brace));
  const data = JSON.parse(readFileSync(file, 'utf8')).slice(0, limit);
  const [pin, pout] = PRICES[model] ?? [0, 0];

  const stats = {};
  const bump = (label, key) => ((stats[label] ??= { total: 0, ai: 0, app: 0 })[key]++);
  let tokensIn = 0;
  let tokensOut = 0;
  let errors = 0;
  let extras = 0;
  let predicted = 0;
  const extraSamples = [];
  const misses = [];
  let ms = 0;

  for (let i = 0; i < data.length; i += 10) {
    const batch = data.slice(i, i + 10);
    let body;
    for (let t = 0; t < 5; t++) {
      const res = await fetch(new URL('/api/detect', base), {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: new URL(base).origin },
        body: JSON.stringify({ texts: batch.map((d) => d.text), model, options }),
      });
      if (res.status !== 429) {
        body = await res.json();
        break;
      }
      await new Promise((r) => setTimeout(r, 15_000));
    }
    batch.forEach((doc, j) => {
      const r = body?.results?.[j];
      if (!r || r.error) {
        errors++;
        return;
      }
      tokensIn += r.usage?.prompt_tokens ?? 0;
      tokensOut += r.usage?.completion_tokens ?? 0;
      ms += r.ms ?? 0;
      const aiRanges = r.entities.flatMap((e) => occurrences(doc.text, e.text));
      const appSpans = analyzeUnits([{ id: 'u', text: doc.text }], { types: APP_TYPES, ai: r.entities })
        .filter((s) => APP_TYPES.includes(s.type) && startsTicked(s));
      const appRanges = appSpans.map((s) => [s.start, s.end]);
      for (const g of doc.spans) {
        const label = CORE.has(g.label) ? g.label : `(optional) ${g.label}`;
        bump(label, 'total');
        if (covered(g, aiRanges)) bump(label, 'ai');
        const hit = covered(g, appRanges);
        if (hit) bump(label, 'app');
        else if (CORE.has(g.label) && misses.length < 40) misses.push(`${g.label}: ${JSON.stringify(doc.text.slice(g.start, g.end))}`);
      }
      // Redactions that touch no labelled value at all.
      for (const s of appSpans) {
        predicted++;
        if (!doc.spans.some((g) => s.start < g.end && g.start < s.end)) {
          extras++;
          if (extraSamples.length < 40) extraSamples.push(`${s.type}: ${JSON.stringify(doc.text.slice(s.start, s.end))}`);
        }
      }
    });
    const cost = (tokensIn * pin + tokensOut * pout) / 1e6;
    console.error(`${Math.min(i + 10, data.length)}/${data.length} docs, ${errors} errors, $${cost.toFixed(3)}`);
  }

  const sum = (pred) => Object.entries(stats).filter(([l]) => pred(l)).reduce((a, [, s]) => ({ total: a.total + s.total, ai: a.ai + s.ai, app: a.app + s.app }), { total: 0, ai: 0, app: 0 });
  const core = sum((l) => !l.startsWith('('));
  const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-');
  return {
    model,
    file: path.basename(file),
    docs: data.length,
    errors,
    cost: +((tokensIn * pin + tokensOut * pout) / 1e6).toFixed(4),
    tokensIn,
    tokensOut,
    avgMs: Math.round(ms / Math.max(1, data.length - errors)),
    coreRecall: { ai: pct(core.ai, core.total), app: pct(core.app, core.total), values: core.total },
    unlabeledRedactions: `${extras} of ${predicted}`,
    perLabel: Object.fromEntries(
      Object.entries(stats)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([l, s]) => [l, `${s.app}/${s.total} app, ${s.ai}/${s.total} ai`]),
    ),
    misses,
    extraSamples,
  };
}

if (mode === 'fetch') await fetchData(args[0] || '.');
else if (mode === 'run') console.log(JSON.stringify(await run(args[0], args[1], args[2], Number(args[3]) || Infinity), null, 2));
else console.error('usage: see the top of scripts/bench-dataset.mjs');
