import { PRODUCTS, price } from '../shared/pricing.ts';

// The /account page: sign in, see balances, buy the monthly plan or packs.

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

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & Record<string, unknown> = {}, ...children: (Node | string)[]) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('data-') || k.startsWith('aria-') || k === 'for') el.setAttribute(k, String(v));
    else (el as unknown as Record<string, unknown>)[k] = v;
  }
  el.append(...children);
  return el;
};

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

function pricing(signedIn: boolean) {
  return h(
    'div',
    { className: 'cards plans' },
    ...PRODUCTS.map((p) =>
      h(
        'div',
        { className: 'card plan' },
        h('strong', {}, p.name),
        h('span', { className: 'plan-price' }, `${price(p.cents)}${p.monthly ? ' / month' : ''}`),
        h('span', {}, `${p.pages.toLocaleString()} credits${p.monthly ? ' every month' : ' that never expire'}`),
        h('button', {
          type: 'button',
          className: 'btn primary',
          textContent: signedIn ? (p.monthly ? 'Subscribe' : 'Buy') : 'Sign in to buy',
          disabled: !signedIn,
          onclick: async () => {
            say('Opening secure checkout…');
            const r = await post('/api/checkout', { product: p.id });
            if (r.url) location.href = r.url;
            else say(r.error || 'Checkout failed.', true);
          },
        }),
      ),
    ),
  );
}

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
    const r = await post('/auth/email', { email: email.value });
    if (r.ok) say(`Check ${email.value} for a sign-in link. It expires in 15 minutes.`);
    else say(r.error || 'Could not send the link.', true);
  });
  return h(
    'section',
    {},
    h('h2', {}, 'Sign in'),
    h('p', {}, 'Sign in to buy credits.'),
    form,
    h('a', { className: 'btn google', href: '/auth/google', 'aria-disabled': String(!opts.google), onclick: (e: Event) => !opts.google && e.preventDefault() }, 'Sign in with Google'),
    ...(!opts.email && !opts.google ? [h('p', { className: 'hint' }, 'Sign-in is being set up and will be available soon.')] : []),
  );
}

function balance(user: NonNullable<Me['user']>) {
  const sub = user.subscription;
  const rows = [
    h('p', {}, 'Signed in as ', h('strong', {}, user.email ?? 'Google account')),
    sub
      ? h('p', {}, `Monthly plan: ${(sub.pages - sub.used).toLocaleString()} of ${sub.pages.toLocaleString()} credits left, renews ${new Date(sub.renews * 1000).toLocaleDateString()}.`)
      : h('p', {}, 'No monthly plan.'),
    h('p', {}, `Packs: ${user.packPages.toLocaleString()} credits left.`),
      ];
  const actions = h('div', { className: 'row' });
  if (user.canManage) {
    actions.append(
      h('button', {
        type: 'button',
        className: 'btn',
        textContent: 'Manage plan and invoices',
        onclick: async () => {
          const r = await post('/api/portal');
          if (r.url) location.href = r.url;
          else say(r.error || 'Could not open billing.', true);
        },
      }),
    );
  }
  actions.append(
    h('button', {
      type: 'button',
      className: 'btn ghost',
      textContent: 'Sign out',
      onclick: async () => {
        await post('/auth/logout');
        location.reload();
      },
    }),
  );
  return h('section', {}, h('h2', {}, 'Your credits'), ...rows, actions);
}

async function render() {
  const params = new URLSearchParams(location.search);
  if (params.get('paid')) say('Thanks! Your credits appear once the payment is confirmed, usually within seconds.');
  if (params.get('error') === 'link') say('That sign-in link has expired or was already used. Ask for a new one.', true);
  if (params.get('error') === 'google') say('Google sign-in did not work. Please try again or use email.', true);
  const me = (await fetch('/api/me').then((r) => r.json()).catch(() => ({ user: null }))) as Me;
  root.replaceChildren(
    status,
    me.user ? balance(me.user) : signInForm(me.signIn ?? { email: false, google: false }),
    h('h2', {}, 'Plans and packs'),
    h('p', {}, 'Free every day: about 30 credits. One credit covers about one page of text or one picture. The daily credits are used first, then the monthly plan, then packs.'),
    pricing(!!me.user),
  );
  if (params.get('paid')) setTimeout(render, 4000);
}

render();
