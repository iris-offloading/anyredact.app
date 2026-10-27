import { FREE_CREDITS, PRODUCTS, type Product } from '../shared/pricing.ts';
import { freePagesLeft } from './ai.ts';
import { h } from './dom.ts';

// The /account page: sign in, see balances, buy a plan or credits, manage a plan.

interface Me {
  user: {
    email: string | null;
    subscription: { pages: number; used: number; renews: number } | null;
    packPages: number;
    canManage: boolean;
  } | null;
  signIn?: { email: boolean; google: boolean };
  error?: string;
}

const root = document.getElementById('account')!;
const status = h('p', { className: 'status', role: 'status', hidden: true });
const say = (msg: string, error = false) => {
  status.hidden = !msg;
  status.textContent = msg;
  status.classList.toggle('error', error);
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

async function checkout(product: Product) {
  say('Opening secure checkout…');
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
  const google = h('a', { className: 'btn google', href: '/api/auth/google', 'aria-disabled': String(!opts.google), onclick: (e: Event) => !opts.google && e.preventDefault() }, 'Continue with Google');
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
    h('div', { className: 'meter-head' }, h('span', {}, label), h('strong', {}, total ? `${left.toLocaleString()} of ${total.toLocaleString()}` : left.toLocaleString())),
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
    h('div', {}, h('strong', {}, p.monthly ? p.name : `${p.pages.toLocaleString()} credits`), h('span', {}, p.monthly ? `${p.pages.toLocaleString()} credits a month` : 'Paid once')),
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
      ? meter(`${plan?.name ?? 'Monthly'} plan`, planLeft, sub.pages, `Renews ${new Date(sub.renews * 1000).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`)
      : meter('Monthly plan', 'None', null),
    meter('Credits', user.packPages, null, 'Never expire'),
  ];
  const balanceCard = h(
    'section',
    { className: 'panel-card' },
    h('h2', {}, 'Balance'),
    h('div', { className: 'total' }, h('span', { className: 'total-num' }, total.toLocaleString()), h('span', { className: 'total-label' }, 'credits left')),
    h('div', { className: 'meters' }, ...meters),
  );
  const planCard = sub
    ? h('section', { className: 'panel-card' }, h('h2', {}, 'Plan'), h('p', { className: 'muted' }, plan ? `${plan.name}, ${sub.pages.toLocaleString()} credits a month for ${usd(plan.cents)}.` : `${sub.pages.toLocaleString()} credits a month.`), ...(user.canManage ? [manageButton()] : []))
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

// After checkout, refresh the balance a few times while the payment is confirmed.
let paidChecks = 5;

async function render() {
  const token = new URLSearchParams(location.hash.slice(1)).get('signin');
  if (token) await signInWithLink(token);
  const params = new URLSearchParams(location.search);
  if (params.get('paid')) say('Thanks! Your credits appear once the payment is confirmed, usually within seconds.');
  if (params.get('error') === 'google') say('Google sign-in did not work. Please try again or use email.', true);
  const [me, free] = await Promise.all([fetch('/api/me').then((r) => r.json()).catch(() => ({ user: null })) as Promise<Me>, freePagesLeft()]);
  const buying = params.get('paid') ? undefined : pendingBuy();
  root.parentElement!.classList.toggle('solo', !me.user);
  root.replaceChildren(me.user ? balance(me.user, free) : signInForm(me.signIn ?? { email: false, google: false }));
  if (params.get('paid')) {
    clearBuy();
    if (paidChecks-- > 0) setTimeout(render, 4000);
  } else if (me.user && buying) {
    clearBuy();
    checkout(buying);
  }
}

render();
