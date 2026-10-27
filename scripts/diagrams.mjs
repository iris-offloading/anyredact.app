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
const path = (d) => `<path class="dg-arrow" d="${d}"/>`;

// Swimlane flow: steps alternate between the browser and the server.
// Each step is [lane, title, detail], with lane 0 for the browser and 1 for the server.
const LANES = ['In your browser', 'On our server'];
const TITLE = 15;
const DETAIL = 13;

function node(x, y, w, h, n, step) {
  const [lane, title, detail] = step;
  const sub = wrap(detail, w - 28, DETAIL);
  return (
    `<rect class="dg-node${lane ? ' dg-ai' : ''}" x="${x}" y="${y}" width="${w}" height="${h}" rx="12"/>` +
    `<circle class="dg-badge${lane ? ' dg-badge-ai' : ''}" cx="${x + 24}" cy="${y + 25}" r="11"/>` +
    text(x + 24, y + 29.5, String(n), 'dg-num', 'middle') +
    text(x + 42, y + 30, title, 'dg-title') +
    lines(x + 14, y + 54, sub, 'dg-sub', 17)
  );
}

function flowWide(steps) {
  const W = 1100, labelH = 34, pad = 16, gap = 28;
  const colW = (W - pad * 2 - 120) / steps.length;
  const w = colW - gap;
  const maxLines = Math.max(...steps.map((s) => wrap(s[2], w - 28, DETAIL).length));
  const h = 44 + maxLines * 17;
  const laneH = h + pad * 2;
  const laneY = (l) => l * (laneH + 10);
  let body = LANES.map((name, l) => `<rect class="dg-lane" x="0" y="${laneY(l)}" width="${W}" height="${laneH}" rx="14"/>` + text(20, laneY(l) + laneH / 2 + 5, name, 'dg-lane-label')).join('');
  const x0 = 120 + pad + gap / 2;
  const pos = steps.map((s, i) => ({ x: x0 + i * colW, y: laneY(s[0]) + pad }));
  steps.forEach((s, i) => {
    if (!i) return;
    const a = pos[i - 1], b = pos[i];
    const ax = a.x + w, ay = a.y + h / 2, bx = b.x, by = b.y + h / 2;
    const mx = (ax + bx) / 2;
    body += path(ay === by ? `M${ax} ${ay}H${bx - 2}` : `M${ax} ${ay}H${mx}V${by}H${bx - 2}`) + arrowHead(bx, by, 'right');
  });
  body += steps.map((s, i) => node(pos[i].x, pos[i].y, w, h, i + 1, s)).join('');
  return { w: W, h: laneH * 2 + 10, body };
}

function flowNarrow(steps) {
  const W = 360, head = 34, colW = W / 2, w = colW - 20, rowGap = 26;
  const heights = steps.map((s) => 44 + wrap(s[2], w - 28, DETAIL).length * 17);
  let y = head + 8;
  const pos = steps.map((s, i) => {
    const p = { x: s[0] * colW + 10, y };
    y += heights[i] + rowGap;
    return p;
  });
  const H = y - rowGap + 12;
  let body = LANES.map((name, l) => `<rect class="dg-lane" x="${l * colW + (l ? 3 : 0)}" y="0" width="${colW - 3}" height="${H}" rx="14"/>` + text(l * colW + colW / 2, 23, name, 'dg-lane-label', 'middle')).join('');
  steps.forEach((s, i) => {
    if (!i) return;
    const a = pos[i - 1], b = pos[i];
    const ax = a.x + w / 2, ay = a.y + heights[i - 1], bx = b.x + w / 2, by = b.y;
    const my = (ay + by) / 2;
    body += path(ax === bx ? `M${ax} ${ay}V${by - 2}` : `M${ax} ${ay}V${my}H${bx}V${by - 2}`) + arrowHead(bx, by, 'down');
  });
  body += steps.map((s, i) => node(pos[i].x, pos[i].y, w, heights[i], i + 1, s)).join('');
  return { w: W, h: H, body };
}

export const flowDiagram = (label, steps) => figure(label, flowWide(steps), flowNarrow(steps));

// Guide: a box drawn over PDF text compared with a page rebuilt as an image.
function layer(x, y, cls) {
  return `<path class="${cls}" d="M${x + 34} ${y}h160l-34 40h-160z"/>`;
}
// Grey lines of body text on a page layer.
const pageLines = (x, y) => `<path class="dg-arrow" d="M${x + 52} ${y + 10}h40M${x + 104} ${y + 10}h50M${x + 30} ${y + 30}h60M${x + 146} ${y + 30}h20"/>`;
function pdfPanel(x, y, flat, compact = false) {
  let b = text(x, y + 16, flat ? 'Rebuilt as one image' : 'Box drawn on top', 'dg-title');
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
  b += text(x, cy, 'Copied out:', 'dg-sub');
  b += flat
    ? text(x + 82, cy, 'nothing', 'dg-sub dg-strong')
    : `<rect class="dg-leak-box" x="${x + 78}" y="${y + 205}" width="92" height="25" rx="6"/>` + text(x + 124, y + 222, 'Jane Smith', 'dg-leak', 'middle');
  return b;
}
export const pdfLayersDiagram = () =>
  figure(
    'A black box drawn on a PDF sits above a text layer that still says Jane Smith. A page rebuilt as one image has no text to copy.',
    { w: 640, h: 240, body: pdfPanel(10, 0, false) + pdfPanel(350, 0, true) },
    { w: 300, h: 390, body: pdfPanel(10, 0, false) + pdfPanel(10, 264, true, true) },
  );

// Guide: a photo file before and after re-encoding.
function photoFile(x, y, clean) {
  let b = `<rect class="dg-node" x="${x}" y="${y}" width="270" height="236" rx="12"/>` + text(x + 16, y + 28, clean ? 'Downloaded copy' : 'Original photo', 'dg-title');
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
    'The original photo carries its location, device and time. The downloaded copy keeps the picture and drops those fields.',
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
  ['deleted', 'Deletion', 'Whole file gone'],
  ['redacted', 'Redaction', 'Chosen parts removed'],
  ['anonymised', 'Anonymisation', 'Nobody can be singled out'],
];
export const redactionKindsDiagram = () =>
  figure(
    'Deletion removes the whole file. Redaction removes chosen parts and leaves visible marks. Anonymisation generalises the data until no one can be singled out.',
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
    b += text(170, 48, 'One month', 'dg-title', 'middle') + text(470, 48, 'Up to two more months', 'dg-sub', 'middle');
    b += [[20, 'Request in'], [320, 'Reply due'], [620, 'Latest with extension']].map(([x, t], i) => `<circle class="${i < 2 ? 'dg-badge' : 'dg-dot'}" cx="${x}" cy="65" r="8"/>` + text(x, 100, t, i < 2 ? 'dg-title' : 'dg-sub', i ? (i === 2 ? 'end' : 'middle') : 'start')).join('');
    b += text(320, 124, 'Extending? Tell the requester before this date.', 'dg-sub', 'middle');
    return { w: 640, h: 140, body: b };
  })();
  const narrow = (() => {
    let b = `<rect class="dg-span" x="15" y="20" width="10" height="100" rx="5"/><path class="dg-arrow dg-dash" d="M20 126V300"/>`;
    b += [[20, 'Request in', ''], [120, 'Reply due', 'One month later. Extending? Tell the requester before this date.'], [304, 'Latest with extension', 'Up to two more months']]
      .map(([y, t, d], i) => `<circle class="${i < 2 ? 'dg-badge' : 'dg-dot'}" cx="20" cy="${y}" r="8"/>` + text(44, y + 5, t, i < 2 ? 'dg-title' : 'dg-sub') + lines(44, y + 27, d ? wrap(d, 240, DETAIL) : [], 'dg-sub', 17))
      .join('');
    return { w: 300, h: 320, body: b };
  })();
  return figure('A reply is due one month after the request. It can be extended by up to two more months if the requester is told within the first month.', wide, narrow);
};
