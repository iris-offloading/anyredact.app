// The AnyRedact mark: a redaction bar between square brackets on a rounded
// square, drawn on a 28 x 28 grid. One source for the header, the favicon and
// the PNG icons (scripts/icons.mjs).
const shapes = (bg, fg, accent, radius = 7) =>
  `<rect ${bg} width="28" height="28" rx="${radius}"/>` +
  `<path ${fg} d="M6.5 7h5v2.5H9v9h2.5V21h-5zM21.5 7h-5v2.5H19v9h-2.5V21h5z"/>` +
  `<rect ${accent} x="10.5" y="11.5" width="7" height="5" rx="1"/>`;

export const COLORS = {
  light: { bg: '#15161a', fg: '#ffffff', accent: '#c2255c' },
  dark: { bg: '#ecedf0', fg: '#111216', accent: '#f06595' },
};

// Site header and footer: colours come from CSS so the mark follows the theme.
export const logoMark = (size) =>
  `<svg class="logo-mark" width="${size}" height="${size}" viewBox="0 0 28 28" aria-hidden="true">${shapes('class="lm-bg"', 'class="lm-fg"', 'class="lm-accent"')}</svg>`;

// Browser tab icon: flips to the light square when the system is dark.
export const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><style>.b{fill:${COLORS.light.bg}}.f{fill:${COLORS.light.fg}}.a{fill:${COLORS.light.accent}}@media (prefers-color-scheme:dark){.b{fill:${COLORS.dark.bg}}.f{fill:${COLORS.dark.fg}}.a{fill:${COLORS.dark.accent}}}</style>${shapes('class="b"', 'class="f"', 'class="a"')}</svg>\n`;

// Fixed colours for PNGs. Home screen icons fill the square, the device rounds them.
export const iconSvg = (size, { radius = 7, theme = 'light' } = {}) => {
  const c = COLORS[theme];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 28 28">${shapes(`fill="${c.bg}"`, `fill="${c.fg}"`, `fill="${c.accent}"`, radius)}</svg>`;
};
