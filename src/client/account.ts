import { FREE_CREDITS, PRODUCTS, type Product } from '../shared/pricing.ts';
import { freePagesLeft } from './ai.ts';
import { h } from './dom.ts';

// The /account page: sign in, see balances, buy a plan or credits, manage a plan.

interface Activity {
  kind: string;
  credits: number;
  cents: number | null;
  at: number;
}

interface Me {
  user: {
    email: string | null;
    subscription: { pages: number; used: number; renews: number; ending: boolean } | null;
    packPages: number;
    canManage: boolean;
    activity?: Activity[];
  } | null;
  signIn?: { email: boolean; google: boolean };
  error?: string;
}

const root = document.getElementById('account')!;
const status = h('p', { className: 'status', role: 'status', hidden: true });
const say = (msg: string, kind: boolean | 'busy' | 'success' = false) => {
  status.hidden = !msg;
  status.textContent = msg;
  status.classList.toggle('error', kind === true);
  status.classList.toggle('busy', kind === 'busy');
  status.classList.toggle('success', kind === 'success');
};

async function post(path: string, body: unknown = {}): Promise<{ url?: string; error?: string; ok?: boolean }> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json().catch(() => ({ error: `Request failed (${res.status}).` }));
}

// A plan button on /pricing links here with ?buy=<product>. The choice is kept
// through sign-in (the emailed link may open in another tab) and checkout opens once signed in.
const BUY_KEY = 'anyredact-buy';
const BUY_TTL = 3_600_000;

function pendingBuy() {
  const id = new URLSearchParams(location.search).get('buy');
  try {
    if (id) localStorage.setItem(BUY_KEY, JSON.stringify({ id, at: Date.now() }));
    const saved = JSON.parse(localStorage.getItem(BUY_KEY) || 'null') as { id: string; at: number } | null;
    if (saved && Date.now() - saved.at < BUY_TTL) return PRODUCTS.find((p) => p.id === saved.id);
  } catch {
    // Storage blocked: the buy still works if the visitor is already signed in.
  }
  return PRODUCTS.find((p) => p.id === id);
}

function clearBuy() {
  try {
    localStorage.removeItem(BUY_KEY);
  } catch {}
  if (location.search.includes('buy=')) history.replaceState(null, '', '/account');
}

/** Paid credits left: the plan's and the bought ones. Rises once a payment lands. */
const paidLeft = (user: NonNullable<Me['user']>) => (user.subscription ? Math.max(0, user.subscription.pages - user.subscription.used) : 0) + user.packPages;

// The paid balance before checkout, so the page can tell when the payment has landed.
const PAID_BASE_KEY = 'anyredact-paid-base';
let currentPaid: number | null = null;

function rememberPaidBase(paid: number | null) {
  try {
    if (paid !== null) sessionStorage.setItem(PAID_BASE_KEY, String(paid));
  } catch {}
}

function paidBase(): number | null {
  try {
    const v = sessionStorage.getItem(PAID_BASE_KEY);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}

async function checkout(product: Product) {
  rememberPaidBase(currentPaid);
  say('Opening secure checkout…', 'busy');
  const r = await post('/api/checkout', { product: product.id });
  if (r.url) location.href = r.url;
  else say(r.error || 'Checkout failed.', true);
}

const GOOGLE_G =
  '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>';

/** The card that holds every state of the page, with the status line under its heading. */
const card = (title: string, ...children: Node[]) => h('div', { className: 'auth-card' }, h('h1', {}, title), status, ...children);

function signInForm(opts: { email: boolean; google: boolean }) {
  const email = h('input', { type: 'email', required: true, placeholder: 'you@example.com', autocomplete: 'email', 'aria-label': 'Email address' });
  const form = h(
    'form',
    { className: 'signin' },
    email,
    h('button', { type: 'submit', className: 'btn primary', textContent: 'Email me a sign-in link', disabled: !opts.email }),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    say('Sending…');
    const r = await post('/api/auth/email', { email: email.value });
    if (r.ok) say(`Check ${email.value} for a sign-in link. It expires in 15 minutes.`);
    else say(r.error || 'Could not send the link.', true);
  });
  const google = h(
    'a',
    {
      className: 'btn google',
      href: '/api/auth/google',
      'aria-disabled': String(!opts.google),
      // An onclick that returns false cancels the link, so this one returns nothing.
      onclick: (e: Event) => {
        if (!opts.google) e.preventDefault();
      },
    },
    'Continue with Google',
  );
  google.insertAdjacentHTML('afterbegin', GOOGLE_G);
  return card(
    'Sign in to AnyRedact',
    google,
    h('div', { className: 'or' }, 'or'),
    form,
    ...(!opts.email && !opts.google ? [h('p', { className: 'hint' }, 'Sign-in is being set up and will be available soon.')] : []),
  );
}

function meter(label: string, left: number | string, total: number | null, note?: string) {
  const bar = total ? h('div', { className: 'meter-bar' }, h('span', { style: `width: ${Math.min(100, (Number(left) / total) * 100)}%` } as Record<string, unknown>)) : null;
  return h(
    'div',
    { className: 'meter' },
    h('div', { className: 'meter-head' }, h('span', {}, label), h('strong', {}, total ? `${left.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}` : left.toLocaleString('en-US'))),
    ...(bar ? [bar] : []),
    ...(note ? [h('p', { className: 'meter-note' }, note)] : []),
  );
}

const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US')}`;

/** One product with its price and a button that opens checkout. */
function offer(p: Product, button: string) {
  return h(
    'div',
    { className: 'offer' },
    h('div', {}, h('strong', {}, p.monthly ? p.name : `${p.pages.toLocaleString('en-US')} credits`), h('span', {}, p.monthly ? `${p.pages.toLocaleString('en-US')} credits a month` : 'Paid once')),
    h('span', { className: 'offer-price' }, usd(p.cents), ...(p.monthly ? [h('small', {}, ' / month')] : [])),
    h('button', { type: 'button', className: 'btn', textContent: button, onclick: () => checkout(p) }),
  );
}

function manageButton() {
  return h('button', {
    type: 'button',
    className: 'btn',
    textContent: 'Manage plan and invoices',
    onclick: async () => {
      const r = await post('/api/portal');
      if (r.url) location.href = r.url;
      else say(r.error || 'Could not open billing.', true);
    },
  });
}

/** Delete account, with a second button to confirm in place. */
function deleteAccount() {
  const row = h('div', { className: 'delete-account' });
  const ask = () =>
    row.replaceChildren(
      h('button', {
        type: 'button',
        className: 'link-button',
        textContent: 'Delete account',
        onclick: () =>
          row.replaceChildren(
            h('p', {}, 'Your plan stops now and your credits are lost. This cannot be undone.'),
            h('button', {
              type: 'button',
              className: 'btn danger',
              textContent: 'Delete account',
              onclick: async () => {
                say('Deleting…', 'busy');
                const res = await fetch('/api/me', { method: 'DELETE' });
                const r = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
                if (r.ok) location.reload();
                else say(r.error || 'Could not delete the account.', true);
              },
            }),
            h('button', { type: 'button', className: 'btn', textContent: 'Keep account', onclick: ask }),
          ),
      }),
    );
  ask();
  return row;
}

const ICONS = {
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  audio: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5L5 20"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
};

const FORMAT_NAMES: Record<string, string> = { pdf: 'PDF', docx: 'Word', pptx: 'PowerPoint', sheet: 'Excel', text: 'Text', image: 'Image', audio: 'Audio' };

const plural = (n: number, one: string) => `${n.toLocaleString('en-US')} ${one}${n === 1 ? '' : 's'}`;

function when(at: number) {
  const d = new Date(at * 1000);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }) });
}

/** One activity row: what it was, when and how much, and its credits. */
function activityRow(a: Activity) {
  const used = -a.credits;
  const [icon, title, detail] = (() => {
    switch (a.kind) {
      case 'audio':
        return ['audio', 'Audio', plural(Math.round(used / 3), 'minute')];
      case 'image':
        return ['image', 'Image', ''];
      case 'check':
        return ['check', 'Check for anything left', ''];
      case 'pack':
        return ['plus', `Bought ${a.credits.toLocaleString('en-US')} credits`, a.cents ? usd(a.cents) : ''];
      case 'plan':
        return ['plus', `${PRODUCTS.find((p) => p.monthly && p.pages === a.credits)?.name ?? 'Monthly'} plan`, a.cents ? usd(a.cents) : ''];
      case 'refund':
        return ['minus', 'Refund', ''];
      case 'dispute':
        return ['minus', 'Disputed payment', ''];
      default:
        return ['doc', FORMAT_NAMES[a.kind] ?? 'File', plural(used, 'page')];
    }
  })();
  const svg = h('span', { className: 'activity-icon', 'aria-hidden': 'true' });
  svg.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon as keyof typeof ICONS]}</svg>`;
  return h(
    'li',
    {},
    svg,
    h('div', {}, h('strong', {}, title), h('span', {}, [when(a.at), detail].filter(Boolean).join(', '))),
    h('span', { className: a.credits > 0 ? 'activity-credits added' : 'activity-credits' }, `${a.credits > 0 ? '+' : '\u2212'}${Math.abs(a.credits).toLocaleString('en-US')}`),
  );
}

const SHOWN = 4;

/** Recent activity, the latest few with a button for the rest. Nothing while there is none. */
function activityList(items: Activity[]) {
  if (!items.length) return [];
  const list = h('ul', { className: 'activity' }, ...items.slice(0, SHOWN).map(activityRow));
  const more =
    items.length > SHOWN
      ? h('button', {
          type: 'button',
          className: 'link-button',
          textContent: 'View all',
          onclick: () => {
            list.replaceChildren(...items.map(activityRow));
            more?.remove();
          },
        })
      : null;
  return [h('div', { className: 'activity-head' }, h('h3', {}, 'Recent activity'), ...(more ? [more] : [])), list];
}

function balance(user: NonNullable<Me['user']>, free: number | null) {
  const sub = user.subscription;
  const plan = sub && PRODUCTS.find((p) => p.monthly && p.pages === sub.pages);
  const planLeft = sub ? Math.max(0, sub.pages - sub.used) : 0;
  const total = (free ?? 0) + planLeft + user.packPages;
  const name = user.email ?? 'Google account';
  const head = h(
    'div',
    { className: 'account-head' },
    h('h1', {}, 'Account'),
    h(
      'div',
      { className: 'who' },
      h('span', { className: 'avatar', 'aria-hidden': 'true' }, name[0].toUpperCase()),
      h('strong', {}, name),
      h('button', {
        type: 'button',
        className: 'link-button',
        textContent: 'Sign out',
        onclick: async () => {
          await post('/api/auth/logout');
          location.reload();
        },
      }),
    ),
  );
  const meters = [
    ...(free === null ? [] : [meter('Free today', free, FREE_CREDITS)]),
    sub
      ? meter(`${plan?.name ?? 'Monthly'} plan`, planLeft, sub.pages, sub.ending ? 'Lapse when the plan ends' : 'Reset each month')
      : meter('Monthly plan', 'None', null),
    meter('Credits', user.packPages, null, 'Never expire'),
  ];
  const balanceCard = h(
    'section',
    { className: 'panel-card balance-card' },
    h('h2', {}, 'Balance'),
    h('div', { className: 'total' }, h('span', { className: 'total-num' }, total.toLocaleString('en-US')), h('span', { className: 'total-label' }, 'credits left')),
    ...activityList(user.activity ?? []),
    h('div', { className: 'meters' }, ...meters),
  );
  const planCard = sub
    ? h(
        'section',
        { className: 'panel-card plan-card' },
        h('h2', {}, 'Plan'),
        h(
          'div',
          { className: 'plan-hero' },
          h(
            'div',
            {},
            h('div', { className: 'plan-name' }, h('strong', {}, plan?.name ?? 'Monthly'), h('span', { className: sub.ending ? 'pill ending' : 'pill' }, sub.ending ? 'Cancelled' : 'Active')),
            h('span', { className: 'plan-sub' }, `${sub.pages.toLocaleString('en-US')} credits a month`),
          ),
          ...(plan ? [h('span', { className: 'plan-price' }, usd(plan.cents), h('small', {}, ' / month'))] : []),
        ),
        h(
          'div',
          { className: 'plan-date' },
          h('span', {}, sub.ending ? 'Ends' : 'Renews'),
          h('strong', {}, new Date(sub.renews * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })),
        ),
        ...(user.canManage ? [manageButton()] : []),
      )
    : h(
        'section',
        { className: 'panel-card' },
        h('h2', {}, 'Plans'),
        h('div', { className: 'offers' }, ...PRODUCTS.filter((p) => p.monthly).map((p) => offer(p, 'Subscribe'))),
        ...(user.canManage ? [manageButton()] : []),
      );
  const creditCard = h('section', { className: 'panel-card' }, h('h2', {}, 'Buy credits'), h('div', { className: 'offers' }, ...PRODUCTS.filter((p) => !p.monthly).map((p) => offer(p, 'Buy'))));
  return h(
    'div',
    { className: 'account-view' },
    head,
    status,
    h('div', { className: 'account-grid' }, balanceCard, h('div', { className: 'account-side' }, planCard, creditCard)),
    deleteAccount(),
  );
}

/** The emailed link opens this page, and the token is spent here, so a plain fetch of the link spends nothing. */
async function signInWithLink(token: string) {
  history.replaceState(null, '', '/account' + location.search);
  root.replaceChildren(card('Signing in…'));
  const r = await post('/api/auth/email/verify', { token });
  if (!r.ok) say(r.error || 'Sign-in failed.', true);
  else document.querySelector('.signin-link')!.textContent = 'Account';
}

// After checkout, check the balance every few seconds until the payment lands.
let paidChecks = 0;
const PAID_CHECK_MS = 3000;
const PAID_CHECKS = 20;

function confirmPayment(user: Me['user']) {
  const base = paidBase();
  const added = user && base !== null ? paidLeft(user) - base : 0;
  // Without a stored balance (checkout opened in another tab) one refresh has to do.
  if (added > 0 || (base === null && paidChecks > 0)) {
    say(added > 0 ? `Payment confirmed. ${added.toLocaleString('en-US')} credits added.` : 'Payment confirmed.', 'success');
  } else if (paidChecks < PAID_CHECKS) {
    say('Confirming your payment…', 'busy');
    paidChecks++;
    setTimeout(render, PAID_CHECK_MS);
    return;
  } else {
    say('Payment received. Your credits will appear shortly.');
  }
  try {
    sessionStorage.removeItem(PAID_BASE_KEY);
  } catch {}
  history.replaceState(null, '', '/account');
}

async function render() {
  const token = new URLSearchParams(location.hash.slice(1)).get('signin');
  if (token) await signInWithLink(token);
  const params = new URLSearchParams(location.search);
  const paid = !!params.get('paid');
  if (params.get('error') === 'google') say('Google sign-in did not work. Please try again or use email.', true);
  const [me, free] = await Promise.all([fetch('/api/me').then((r) => r.json()).catch(() => ({ user: null })) as Promise<Me>, freePagesLeft()]);
  currentPaid = me.user ? paidLeft(me.user) : null;
  const buying = paid ? undefined : pendingBuy();
  root.parentElement!.classList.toggle('solo', !me.user);
  root.replaceChildren(me.user ? balance(me.user, free) : signInForm(me.signIn ?? { email: false, google: false }));
  if (paid) {
    clearBuy();
    confirmPayment(me.user);
  } else if (me.user && buying) {
    clearBuy();
    checkout(buying);
  }
}

render();
