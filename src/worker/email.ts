// The sign-in email. Mail clients ignore most CSS, so the layout is tables with
// inline styles in the site's colours (static/styles.css). The <style> block only
// adds dark mode for clients that support it; Gmail and Outlook recolour on their own.

const LIGHT = { bg: '#f6f5f1', surface: '#ffffff', text: '#15161a', muted: '#5a5e68', line: '#e4e2dc', accent: '#c2255c', accentInk: '#ffffff' };
const DARK = { bg: '#111216', surface: '#1a1b20', text: '#ecedf0', muted: '#a3a7b1', line: '#2c2e35', accent: '#f06595', accentInk: '#111216' };
const FONT = "Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function loginEmail(origin: string, link: string, minutes: number): { subject: string; text: string; html: string } {
  const expiry = `The link works once and expires in ${minutes} minutes. If you didn't ask for it, ignore this email.`;
  const href = escape(link);
  const c = LIGHT;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>Sign in to AnyRedact</title>
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  .logo-dark { display: none; }
  @media (prefers-color-scheme: dark) {
    .bg { background: ${DARK.bg} !important; }
    .card { background: ${DARK.surface} !important; border-color: ${DARK.line} !important; }
    .text { color: ${DARK.text} !important; }
    .muted, .muted a { color: ${DARK.muted} !important; }
    .button { background: ${DARK.accent} !important; }
    .button a { color: ${DARK.accentInk} !important; }
    .logo-light { display: none !important; }
    .logo-dark { display: block !important; }
  }
  @media (max-width: 520px) { .card td.pad { padding: 28px 22px !important; } }
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${c.bg};">
<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${c.bg};">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
  <tr><td style="padding:0 4px 20px;">
    <a href="${escape(origin)}" style="text-decoration:none;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding-right:10px;vertical-align:middle;">
        <img class="logo-light" src="${escape(origin)}/email-logo.png" width="32" height="32" alt="" style="display:block;border:0;border-radius:8px;">
        <!--[if !mso]><!--><img class="logo-dark" src="${escape(origin)}/email-logo-dark.png" width="32" height="32" alt="" style="display:none;border:0;border-radius:8px;"><!--<![endif]-->
      </td>
      <td class="text" style="vertical-align:middle;font-family:${FONT};font-size:19px;font-weight:700;letter-spacing:-0.01em;color:${c.text};">AnyRedact</td>
    </tr></table>
    </a>
  </td></tr>
  <tr><td>
    <table role="presentation" class="card" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${c.surface};border:1px solid ${c.line};border-radius:14px;">
    <tr><td class="pad" style="padding:36px 36px 32px;font-family:${FONT};">
      <h1 class="text" style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;color:${c.text};">Sign in to AnyRedact</h1>
      <p class="muted" style="margin:0 0 26px;font-size:15px;line-height:1.55;color:${c.muted};">${expiry}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td class="button" bgcolor="${c.accent}" style="border-radius:10px;background:${c.accent};">
          <a href="${href}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1;color:${c.accentInk};text-decoration:none;border-radius:10px;">Sign in</a>
        </td>
      </tr></table>
      <p class="muted" style="margin:28px 0 0;font-size:13px;line-height:1.5;color:${c.muted};word-break:break-all;">Or open this link:<br><a href="${href}" style="color:${c.muted};text-decoration:underline;">${href}</a></p>
    </td></tr>
    </table>
  </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
  return {
    subject: 'Your AnyRedact sign-in link',
    text: `Sign in to AnyRedact:\n\n${link}\n\n${expiry}`,
    html,
  };
}
