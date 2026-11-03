// Inline SVG diagrams for the tool pages and guides. Colours come from the
// site's CSS variables (static/styles.css, .dg-*), so they follow the theme.
// Each diagram is drawn twice: a wide layout for desktop and a narrow one
// for phones, and CSS shows one of them.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Greedy word wrap by an estimated Geist character width.
function wrap(text, maxWidth, size) {
  const max = Math.max(1, Math.floor(maxWidth / (size * 0.5)));
  const lines = [];
  for (const word of text.split(' ')) {
    const last = lines.at(-1);
    if (last && (last + ' ' + word).length <= max) lines[lines.length - 1] = last + ' ' + word;
    else lines.push(word);
  }
  return lines;
}

const svg = (cls, w, h, label, body) =>
  `<svg class="${cls}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">${body}</svg>`;

const figure = (label, wide, narrow) =>
  `<figure class="diagram">${svg('dg-wide', wide.w, wide.h, label, wide.body)}${svg('dg-narrow', narrow.w, narrow.h, label, narrow.body)}</figure>`;

const text = (x, y, s, cls, anchor = 'start') => `<text x="${x}" y="${y}" class="${cls}"${anchor === 'start' ? '' : ` text-anchor="${anchor}"`}>${esc(s)}</text>`;
const lines = (x, y, list, cls, lh, anchor) => list.map((l, i) => text(x, y + i * lh, l, cls, anchor)).join('');
const arrowHead = (x, y, dir) => {
  const d = { right: [-7, -5, -7, 5], down: [-5, -7, 5, -7], left: [7, -5, 7, 5] }[dir];
  return `<path class="dg-head" d="M${x} ${y}l${d[0]} ${d[1]}L${x + d[2]} ${y + d[3]}z"/>`;
};
const DETAIL = 13;
const path = (d) => `<path class="dg-arrow" d="${d}"/>`;

// "How it works" pictures on the tool pages: the same file three times,
// plain, with findings marked, then redacted. Each art lists its fixed
// shapes and the spots that hold personal details.
const bar = (x, y, w, h = 12) => ({ x, y, w, h });
const ART = {
  doc: {
    base: [bar(40, 30, 92, 10), bar(150, 64, 120, 10), bar(40, 98, 170, 10)],
    spots: [bar(140, 30, 74, 10), bar(40, 64, 100, 10)],
  },
  pdf: {
    frame: { x: 96, y: 8, w: 128, h: 124 },
    base: [bar(112, 26, 46, 7), bar(112, 60, 96, 7), bar(150, 76, 58, 7), bar(112, 94, 96, 7), bar(112, 110, 60, 7)],
    spots: [bar(164, 26, 44, 7), bar(112, 76, 32, 7)],
  },
  image: {
    frame: { x: 70, y: 10, w: 180, h: 120 },
    hill: true,
    base: [bar(86, 94, 40, 8)],
    spots: [bar(132, 94, 64, 8), bar(86, 112, 92, 8)],
  },
  slide: {
    frame: { x: 56, y: 14, w: 208, h: 112 },
    base: [bar(74, 32, 110, 12), bar(74, 64, 40, 7), bar(74, 82, 100, 7), bar(74, 100, 60, 7)],
    spots: [bar(120, 64, 70, 7), bar(140, 100, 60, 7)],
  },
  sheet: {
    grid: { x: 46, y: 14, cols: [70, 90, 68], rows: 4, h: 28 },
    base: [bar(56, 25, 40, 6), bar(126, 25, 56, 6), bar(216, 25, 40, 6), bar(216, 53, 34, 6), bar(216, 81, 46, 6), bar(56, 109, 34, 6), bar(126, 109, 60, 6)],
    spots: [bar(56, 53, 50, 6), bar(126, 53, 70, 6), bar(56, 81, 44, 6), bar(126, 81, 52, 6)],
  },
  text: {
    mono: true,
    base: [bar(40, 24, 30, 8), bar(40, 46, 30, 8), bar(40, 68, 30, 8), bar(40, 90, 30, 8), bar(150, 46, 60, 8), bar(150, 90, 40, 8)],
    spots: [bar(80, 24, 120, 8), bar(80, 46, 62, 8), bar(80, 68, 90, 8), bar(80, 90, 62, 8)],
  },
  audio: {
    // Waveform on top, the transcript below it; the same words are found in both.
    wave: [bar(118, 18, 46, 52)],
    base: [bar(46, 92, 22, 8), bar(46, 114, 22, 8), bar(78, 92, 36, 8), bar(184, 92, 90, 8), bar(78, 114, 120, 8)],
    spots: [bar(120, 92, 58, 8)],
  },
};
const WAVE = [14, 30, 22, 46, 34, 18, 40, 56, 28, 44, 60, 38, 24, 48, 32, 20, 42, 26, 36, 16, 30, 50, 22, 12];

function art(kind, stage) {
  const a = ART[kind];
  let b = '';
  if (a.frame) b += `<rect class="dg-frame" x="${a.frame.x}" y="${a.frame.y}" width="${a.frame.w}" height="${a.frame.h}" rx="6"/>`;
  if (a.hill) b += `<path class="dg-line" d="M${a.frame.x} 72l40-34 30 22 30-14 80 30v8h-180z"/><circle class="dg-line" cx="216" cy="30" r="9"/>`;
  if (a.grid) {
    const g = a.grid;
    const W = g.cols.reduce((t, c) => t + c, 0);
    b += `<rect class="dg-frame" x="${g.x}" y="${g.y}" width="${W}" height="${g.rows * g.h}" rx="4"/>`;
    for (let r = 1; r < g.rows; r++) b += `<path class="dg-grid" d="M${g.x} ${g.y + r * g.h}h${W}"/>`;
    let x = g.x;
    for (const c of g.cols.slice(0, -1)) b += `<path class="dg-grid" d="M${(x += c)} ${g.y}v${g.rows * g.h}"/>`;
  }
  if (a.wave) {
    // Found: a marker behind the sound. Redacted: the stretch becomes one flat tone.
    if (stage === 1) for (const s of a.wave) b += `<rect class="dg-found" x="${s.x - 4}" y="${s.y - 4}" width="${s.w + 8}" height="${s.h + 8}" rx="4"/>`;
    if (stage === 2) for (const s of a.wave) b += `<rect class="dg-bar" x="${s.x - 2}" y="${s.y + s.h / 2 - 5}" width="${s.w + 2}" height="10" rx="5"/>`;
    WAVE.forEach((h, i) => {
      const x = 46 + i * 10;
      if (stage === 2 && a.wave.some((s) => x >= s.x && x < s.x + s.w)) return;
      b += `<rect class="dg-line" x="${x}" y="${44 - h * 0.4}" width="5" height="${h * 0.8}" rx="2.5"/>`;
    });
    b += `<path class="dg-grid" d="M40 80h240"/>`;
  }
  for (const r of a.base) b += `<rect class="dg-line" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${r.h / 2}"/>`;
  for (const r of a.spots) {
    if (stage === 0) b += `<rect class="dg-line" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${r.h / 2}"/>`;
    if (stage === 1) b += `<rect class="dg-found" x="${r.x - 2}" y="${r.y - 3}" width="${r.w + 4}" height="${r.h + 6}" rx="3"/>`;
    if (stage === 2) b += `<rect class="dg-bar" x="${r.x - 2}" y="${r.y - 2}" width="${r.w + 4}" height="${r.h + 4}" rx="2"/>`;
  }
  return b;
}

const SUBJECTS = { pdf: 'PDF page', image: 'photo', doc: 'Word document', slide: 'presentation slide', sheet: 'spreadsheet', text: 'text file', audio: 'audio recording' };
const stageLabel = (kind, i) => {
  const subject = SUBJECTS[kind];
  return [`Original ${subject}`, `${subject[0].toUpperCase() + subject.slice(1)} with detected items highlighted`, `Redacted ${subject}`][i];
};
export const howItWorks = (kind, steps) =>
  `<ol class="how">${steps
    .map(
      ([title, detail], i) =>
        `<li><span class="how-num">${String(i + 1).padStart(2, '0')}</span><div class="how-art"><svg viewBox="0 0 320 140" role="img" aria-label="${esc(stageLabel(kind, i))}">${art(kind, i)}</svg></div><h3>${esc(title)}</h3><p>${esc(detail)}</p></li>`,
    )
    .join('')}</ol>`;

// Guide: a box drawn over PDF text compared with a page rebuilt as an image.
function layer(x, y, cls) {
  return `<path class="${cls}" d="M${x + 34} ${y}h160l-34 40h-160z"/>`;
}
// Grey lines of body text on a page layer.
const pageLines = (x, y) => `<path class="dg-arrow" d="M${x + 52} ${y + 10}h40M${x + 104} ${y + 10}h50M${x + 30} ${y + 30}h60M${x + 146} ${y + 30}h20"/>`;
function pdfPanel(x, y, flat, compact = false) {
  let b = text(x, y + 16, flat ? 'Flattened to one image' : 'Black box drawn on top', 'dg-title');
  if (flat) {
    const ly = y + (compact ? 44 : 112);
    b += layer(x, ly, 'dg-page') + pageLines(x, ly) + `<path class="dg-bar" d="M${x + 74} ${ly + 12}h70l-10 14h-70z"/>`;
    b += text(x + 214, ly + 25, 'Image', 'dg-sub');
  } else {
    b += layer(x, y + 44, 'dg-ghost') + `<path class="dg-bar" d="M${x + 74} ${y + 56}h70l-10 14h-70z"/>` + text(x + 214, y + 69, 'Shape', 'dg-sub');
    b += layer(x, y + 96, 'dg-ghost') + text(x + 97, y + 121, 'Jane Smith', 'dg-leak', 'middle') + text(x + 214, y + 121, 'Text', 'dg-sub');
    b += layer(x, y + 148, 'dg-page') + pageLines(x, y + 148) + text(x + 214, y + 173, 'Page', 'dg-sub');
  }
  const cy = y + (compact ? 118 : 222);
  b += text(x, cy, 'Copied text:', 'dg-sub');
  b += flat
    ? text(x + 86, cy, 'nothing', 'dg-sub dg-strong')
    : `<rect class="dg-leak-box" x="${x + 82}" y="${y + 205}" width="92" height="25" rx="6"/>` + text(x + 128, y + 222, 'Jane Smith', 'dg-leak', 'middle');
  return b;
}
export const pdfLayersDiagram = () =>
  figure(
    'A black box drawn on a PDF sits above a live text layer that still contains Jane Smith. A page flattened into a single image leaves no hidden text to copy.',
    { w: 640, h: 240, body: pdfPanel(10, 0, false) + pdfPanel(350, 0, true) },
    { w: 300, h: 390, body: pdfPanel(10, 0, false) + pdfPanel(10, 264, true, true) },
  );

// Guide: a photo file before and after re-encoding.
function photoFile(x, y, clean) {
  let b = `<rect class="dg-node" x="${x}" y="${y}" width="270" height="236" rx="12"/>` + text(x + 16, y + 28, clean ? 'Cleaned download' : 'Original photo', 'dg-title');
  b += `<rect class="dg-lane" x="${x + 16}" y="${y + 42}" width="238" height="86" rx="8"/>`;
  b += `<path class="dg-hill" d="M${x + 16} ${y + 110}l60-40 40 26 34-18 104 42V${y + 120}a8 8 0 0 1-8 8H${x + 24}a8 8 0 0 1-8-8z"/><circle class="dg-hill" cx="${x + 216}" cy="${y + 66}" r="10"/>`;
  const rows = [['Location', '48.8584 N, 2.2945 E'], ['Device', 'Phone model, serial'], ['Taken', '2026-05-02 09:14']];
  rows.forEach(([k, v], i) => {
    const ry = y + 150 + i * 26;
    b += text(x + 16, ry, k, 'dg-sub');
    b += clean ? `<path class="dg-arrow dg-dash" d="M${x + 90} ${ry - 4}h164"/>` : text(x + 90, ry, v, 'dg-leak');
  });
  return b;
}
export const photoMetadataDiagram = () =>
  figure(
    'The original photo stores GPS coordinates, device info, and timestamp metadata. Re-encoding keeps the image pixels and strips all hidden metadata fields.',
    { w: 640, h: 240, body: photoFile(1, 2, false) + path('M282 120H356') + arrowHead(358, 120, 'right') + text(320, 108, 'Re-encoded', 'dg-sub', 'middle') + photoFile(368, 2, true) },
    { w: 280, h: 560, body: photoFile(5, 2, false) + path('M140 246V310') + arrowHead(140, 312, 'down') + text(150, 284, 'Re-encoded', 'dg-sub') + photoFile(5, 320, true) },
  );

// Guide: deletion, redaction and anonymisation side by side.
function sheet(x, y, kind) {
  let b = `<rect class="${kind === 'deleted' ? 'dg-ghost' : 'dg-node'}" x="${x}" y="${y}" width="84" height="104" rx="8"/>`;
  if (kind === 'deleted') return b + `<path class="dg-arrow" d="M${x + 28} ${y + 38}l28 28m0-28l-28 28"/>`;
  if (kind === 'redacted') {
    [[12, 60], [12, 30], [12, 46], [12, 58], [12, 40]].forEach(([dx, len], i) => {
      const ly = y + 20 + i * 16;
      b += `<rect class="${i === 1 || i === 3 ? 'dg-bar' : 'dg-line'}" x="${x + dx}" y="${ly}" width="${len}" height="${i === 1 || i === 3 ? 9 : 5}" rx="2"/>`;
    });
    return b;
  }
  const cells = ['30 to 39', 'London', '40 to 49', 'Leeds'];
  cells.forEach((c, i) => (b += text(x + 42, y + 30 + i * 20, c, 'dg-cell', 'middle')));
  return b;
}
const KINDS = [
  ['deleted', 'Deletion', 'Entire file removed'],
  ['redacted', 'Redaction', 'Sensitive parts removed'],
  ['anonymised', 'Anonymization', 'No one can be identified'],
];
export const redactionKindsDiagram = () =>
  figure(
    'Deletion removes the entire file. Redaction removes selected details while leaving visible marks. Anonymization generalizes data until no individual can be identified.',
    {
      w: 640,
      h: 176,
      body: KINDS.map(([k, t, d], i) => {
        const x = i * 220;
        return sheet(x + 63, 4, k) + text(x + 105, 140, t, 'dg-title', 'middle') + text(x + 105, 162, d, 'dg-sub', 'middle');
      }).join(''),
    },
    {
      w: 300,
      h: 360,
      body: KINDS.map(([k, t, d], i) => {
        const y = i * 122 + 4;
        return sheet(4, y, k) + text(108, y + 46, t, 'dg-title') + lines(108, y + 68, wrap(d, 180, DETAIL), 'dg-sub', 17);
      }).join(''),
    },
  );

// Guide: the access request clock.
export const sarTimelineDiagram = () => {
  const wide = (() => {
    let b = `<rect class="dg-span" x="20" y="60" width="300" height="10" rx="5"/><path class="dg-arrow dg-dash" d="M326 65H616"/>`;
    b += text(170, 48, '1 month', 'dg-title', 'middle') + text(470, 48, 'Up to 2 more months', 'dg-sub', 'middle');
    b += [[20, 'Request received'], [320, 'Response due'], [620, 'Extended deadline']].map(([x, t], i) => `<circle class="${i < 2 ? 'dg-badge' : 'dg-dot'}" cx="${x}" cy="65" r="8"/>` + text(x, 100, t, i < 2 ? 'dg-title' : 'dg-sub', i ? (i === 2 ? 'end' : 'middle') : 'start')).join('');
    b += text(320, 124, 'Need an extension? Notify the requester before this date.', 'dg-sub', 'middle');
    return { w: 640, h: 140, body: b };
  })();
  const narrow = (() => {
    let b = `<rect class="dg-span" x="15" y="20" width="10" height="100" rx="5"/><path class="dg-arrow dg-dash" d="M20 126V300"/>`;
    b += [[20, 'Request received', ''], [120, 'Response due', '1 month later. Need an extension? Notify the requester before this date.'], [304, 'Extended deadline', 'Up to 2 additional months for complex requests']]
      .map(([y, t, d], i) => `<circle class="${i < 2 ? 'dg-badge' : 'dg-dot'}" cx="20" cy="${y}" r="8"/>` + text(44, y + 5, t, i < 2 ? 'dg-title' : 'dg-sub') + lines(44, y + 27, d ? wrap(d, 240, DETAIL) : [], 'dg-sub', 17))
      .join('');
    return { w: 300, h: 320, body: b };
  })();
  return figure('A GDPR subject access request response is due within one month, and may be extended by up to two additional months if you notify the requester within the first month.', wide, narrow);
};
