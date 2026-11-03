// Random-input checks of the text code shared by every format (src/shared).
// Usage: node --experimental-strip-types --no-warnings test/fuzz/shared.ts [runs] [seed]
import { analyzeUnits } from '../../src/shared/analyze.ts';
import { chunkText, findPrivateKeys, findTerms, labelText, maskText } from '../../src/shared/detect.ts';
import { nameVariants } from '../../src/shared/names.ts';
import { rewriteSegments } from '../../src/shared/segments.ts';
import { redactStructured, syntaxOf, type Syntax } from '../../src/shared/structured.ts';

const RUNS = Number(process.argv[2] || 3000);
let seed = Number(process.argv[3] || 1);
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const int = (n: number) => Math.floor(rand() * n);
const pick = <T,>(a: T[]): T => a[int(a.length)];

const SECRETS = ['Jane Doe', 'jane@example.com', '415-555-0132', 'José Núñez', 'O\'Brien', '王小明', 'Zoë 😀 Smith', '123-45-6789', 'a&b', '"quoted"', 'C:\\Users\\jane', '<b>Jane</b>', 'line\nbreak'];
const NOISE = [' ', '\n', '\r\n', '\t', '\u00a0', '\u200b', '\uFEFF', 'é', 'e\u0301', '😀', '👩‍👩‍👧', '\u202e', 'אב', '\\', '"', "'", '<', '>', '&amp;', '&#x41;', '{', '}', '[', ']', ',', ':', '0', '-1.5e3', 'null', 'true', 'word', 'The', 'Will', '\u0000'];
// Secrets stand apart from their neighbours, as words do, so whole-word matching can find them.
const text = (n: number) => Array.from({ length: n }, () => (rand() < 0.2 ? ` ${pick(SECRETS)} ` : pick(NOISE))).join('');

function jsonValue(depth: number): unknown {
  const r = int(depth > 3 ? 4 : 7);
  if (r === 0) return pick(SECRETS);
  if (r === 1) return text(int(6));
  if (r === 2) return pick([4155550132, -1.5, 0, 1e21, true, false, null]);
  if (r === 3) return `${pick(SECRETS)} ${text(2)}`;
  if (r === 4) return Array.from({ length: int(4) }, () => jsonValue(depth + 1));
  return Object.fromEntries(Array.from({ length: int(4) }, () => [`${pick([...SECRETS, 'name', 'k'])} ${int(9)}`, jsonValue(depth + 1)]));
}

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function xmlDoc(): string {
  const el = (d: number): string => {
    const kids = d > 3 ? [] : Array.from({ length: int(3) }, () => (rand() < 0.5 ? el(d + 1) : rand() < 0.2 ? `<![CDATA[${pick(SECRETS).replace(/]]>/g, '')}]]>` : rand() < 0.2 ? `<!-- ${xmlEsc(pick(SECRETS)).replace(/--/g, '')} -->` : xmlEsc(text(3))));
    return `<n${d} a="${xmlEsc(pick(SECRETS))}" b='${xmlEsc(` ${pick(SECRETS)} `).replace(/'/g, '&apos;')}'>${kids.join('')}</n${d}>`;
  };
  return `<?xml version="1.0"?>\n${el(0)}\n`;
}

function subtitles(crlf: boolean): string {
  const nl = crlf ? '\r\n' : '\n';
  const cues = Array.from({ length: 1 + int(4) }, (_, i) => `${i + 1}${nl}00:00:0${i},000 --> 00:00:0${i + 1},000${nl}${pick(SECRETS).replace(/\n/g, ' ')} ${text(3).replace(/[\r\n]/g, ' ')}${nl}`);
  return (rand() < 0.5 ? `WEBVTT${nl}${nl}` : '') + cues.join(nl);
}

/** Every span covering one whole secret mention, as the AI would return. */
function secretSpans(t: string) {
  return findTerms(t, SECRETS.map((s) => ({ text: s, type: 'name' as const })), 'ai').filter((s) => !/\s/.test(t[s.start]));
}

let failures = 0;
const seen = new Map<string, string>();
function fail(kind: string, detail: string) {
  failures++;
  if (!seen.has(kind)) seen.set(kind, detail.slice(0, 600));
}

const lone = (s: string) => /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);

for (let run = 0; run < RUNS; run++) {
  // structured: JSON, JSONL, XML and subtitles stay valid and lose their secrets
  const kind = pick(['json', 'jsonl', 'xml', 'subtitle', 'plain', 'txtjson', 'bomjson', 'crlfjsonl'] as const);
  let src = '';
  let syntax: Syntax = 'plain';
  if (kind === 'json' || kind === 'txtjson' || kind === 'bomjson') {
    src = JSON.stringify(jsonValue(0), null, rand() < 0.5 ? 2 : undefined) ?? 'null';
    if (kind === 'bomjson') src = '\uFEFF' + src;
    syntax = syntaxOf(kind === 'txtjson' ? 'x.txt' : 'x.json', src);
  } else if (kind === 'jsonl' || kind === 'crlfjsonl') {
    src = Array.from({ length: 1 + int(4) }, () => JSON.stringify(jsonValue(1))).join(kind === 'crlfjsonl' ? '\r\n' : '\n');
    syntax = syntaxOf('x.jsonl', src);
  } else if (kind === 'xml') {
    src = xmlDoc();
    syntax = syntaxOf('x.xml', src);
  } else if (kind === 'subtitle') {
    src = subtitles(rand() < 0.5);
    syntax = syntaxOf('x.srt', src);
  } else src = text(20);

  const spans = secretSpans(src);
  for (const style of ['block', 'label'] as const) {
    let out = '';
    try {
      out = redactStructured(src, spans, style, syntax);
    } catch (e) {
      fail(`structured ${kind} ${style} throws`, `${(e as Error).stack}\n${JSON.stringify(src)}`);
      continue;
    }
    if (lone(out)) fail(`structured ${kind} ${style} leaves a lone surrogate`, JSON.stringify(src));
    if (kind.includes('json')) {
      const lines = kind.includes('jsonl') ? out.split(/\r?\n/) : [out.replace(/^\uFEFF/, '')];
      for (const l of lines) {
        try {
          JSON.parse(l);
        } catch {
          fail(`structured ${kind} ${style} breaks JSON`, `${JSON.stringify(src)}\n=> ${JSON.stringify(out)}`);
          break;
        }
      }
      // Decoded strings must not hold a secret any more.
      // Secrets that JSON escapes are written differently in the file, so the model would not return them as is.
      const left = SECRETS.filter((s) => s.length > 3 && JSON.stringify(s) === `"${s}"` && out.includes(s));
      if (left.length) fail(`structured ${kind} ${style} leaves a secret`, `${left}\n${JSON.stringify(src)}\n=> ${JSON.stringify(out)}`);
    }
    if (kind === 'subtitle' && (out.match(/-->/g)?.length ?? 0) !== (src.match(/-->/g)?.length ?? 0)) fail(`subtitle ${style} loses timings`, JSON.stringify(src));
    if (kind === 'xml') {
      if ((out.match(/</g)?.length ?? 0) !== (src.match(/</g)?.length ?? 0) - 0 && style === 'block') fail(`xml ${style} changes markup`, `${JSON.stringify(src)}\n=> ${JSON.stringify(out)}`);
      for (const s of ['Jane Doe', 'jane@example.com', '415-555-0132']) if (src.includes(s) && out.includes(s)) fail(`xml ${style} leaves a secret`, `${s}\n${JSON.stringify(src)}\n=> ${JSON.stringify(out)}`);
    }
  }

  // maskText and labelText on random spans
  const t = text(15);
  const rs = Array.from({ length: int(4) }, () => {
    const a = int(t.length + 1);
    return { start: a, end: Math.min(t.length, a + int(12)), type: pick(['name', 'email', 'phone'] as const) };
  });
  const masked = maskText(t, rs);
  if (lone(masked) && !lone(t)) fail('maskText leaves a lone surrogate', JSON.stringify({ t, rs }));
  const labelled = labelText(t, rs);
  if (lone(labelled) && !lone(t)) fail('labelText leaves a lone surrogate', JSON.stringify({ t, rs }));
  // rewriteSegments keeps text outside spans byte for byte
  const cuts = [...new Set(Array.from({ length: int(5) }, () => int(t.length)))].sort((a, b) => a - b);
  const pieces = [0, ...cuts, t.length].slice(0, -1).map((c, i, arr) => t.slice(c, [...cuts, t.length][i]));
  try {
    const re = rewriteSegments(pieces, rs, pick(['block', 'label']));
    if (re.length !== pieces.length) fail('rewriteSegments piece count', JSON.stringify({ pieces, rs }));
    if (lone(re.join('')) && !lone(t)) fail('rewriteSegments leaves a lone surrogate', JSON.stringify({ pieces, rs }));
  } catch (e) {
    fail('rewriteSegments throws', `${(e as Error).message} ${JSON.stringify({ pieces, rs })}`);
  }

  // analyzeUnits: spans lie inside their unit and cover the matched text
  const units = Array.from({ length: 1 + int(5) }, (_, i) => ({ id: `u${i}`, text: text(int(10)) }));
  const ai = Array.from({ length: int(4) }, () => ({ text: rand() < 0.8 ? pick(SECRETS) : text(2), type: pick(['name', 'email', 'phone', 'address', 'id'] as const), owner: pick<'person' | 'organization' | undefined>(['person', 'organization', undefined]) }));
  const terms = Array.from({ length: int(3) }, () => ({ text: rand() < 0.5 ? pick(SECRETS) : text(1), type: 'custom' as const }));
  try {
    const out = analyzeUnits(units, { ai, terms });
    const byId = new Map(units.map((u) => [u.id, u]));
    for (const s of out) {
      const u = byId.get(s.unitId)!;
      if (!(s.start >= 0 && s.end <= u.text.length && s.start < s.end)) fail('analyzeUnits span out of range', JSON.stringify({ units, ai, terms, s }));
    }
    // Every mention of each AI secret is covered
    const joined = units.map((u) => u.text).join('\n');
    for (const e of ai) {
      if (!SECRETS.includes(e.text) || !joined.includes(e.text)) continue;
      if (/^\S+$/.test(e.text) && e.type === 'name') continue;
      if (!['name', 'email', 'address'].includes(e.type) && !/\d/.test(e.text)) continue;
      for (const u of units) {
        let at = u.text.indexOf(e.text);
        while (at >= 0) {
          const covered = new Uint8Array(e.text.length);
          for (const s of out) if (s.unitId === u.id) for (let p = Math.max(s.start, at); p < Math.min(s.end, at + e.text.length); p++) covered[p - at] = 1;
          const miss = [...e.text].length && [...covered].some((c, i) => !c && !/\s/.test(e.text[i]));
          if (miss) fail(`analyzeUnits misses an AI value (${e.type})`, JSON.stringify({ unit: u.text, value: e.text, ai }));
          at = u.text.indexOf(e.text, at + 1);
        }
      }
    }
  } catch (e) {
    fail('analyzeUnits throws', `${(e as Error).stack} ${JSON.stringify({ units, ai, terms })}`);
  }
  try {
    nameVariants([text(3), pick(SECRETS)]);
    chunkText(text(30), 1 + int(20));
    findPrivateKeys(rand() < 0.5 ? `-----BEGIN PRIVATE KEY-----\n${text(5)}` : text(10) + '-----END RSA PRIVATE KEY-----');
  } catch (e) {
    fail('helpers throw', (e as Error).stack!);
  }
  // chunkText rejoins to the input
  const ct = text(40);
  if (chunkText(ct, 1 + int(30)).join('') !== ct) fail('chunkText loses text', JSON.stringify(ct));
}

for (const [k, v] of seen) console.log(`FAIL ${k}\n  ${v.replace(/\n/g, '\n  ')}\n`);
console.log(`${RUNS} runs, ${failures} failures, ${seen.size} kinds`);
process.exitCode = seen.size ? 1 : 0;
