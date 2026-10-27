// /pricing: a signed-in visitor goes straight to checkout. Otherwise the link
// leads to /account, which signs them in first and then opens checkout.
import { fetchMe, rememberPaidBase } from './me.ts';

for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href^="/account?buy="]')) {
  link.addEventListener('click', async (e) => {
    if (!/(?:^|;\s*)signed_in=1/.test(document.cookie)) return;
    e.preventDefault();
    link.setAttribute('aria-busy', 'true');
    const product = new URL(link.href).searchParams.get('buy');
    const [r, me] = await Promise.all([
      fetch('/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ product }) })
        .then((res) => res.json() as Promise<{ url?: string }>)
        .catch(() => ({}) as { url?: string }),
      fetchMe(),
    ]);
    // The account page compares against this to tell when the payment has landed.
    rememberPaidBase(me.user);
    // A stale sign-in or a failed request falls back to the account page, which says what went wrong.
    location.href = r.url ?? link.href;
  });
}
