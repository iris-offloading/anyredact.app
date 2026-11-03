// The public /pricing page. Plans and credits come from src/shared/pricing.ts at
// build time; plan buttons go to /account?buy=<id>, which signs the visitor in
// and then opens checkout.

const offer = (name, cents, monthly) => {
  const price = (cents / 100).toFixed(2);
  return {
    '@type': 'Offer',
    name,
    price,
    priceCurrency: 'USD',
    ...(monthly && { priceSpecification: { '@type': 'UnitPriceSpecification', price, priceCurrency: 'USD', billingDuration: 'P1M' } }),
  };
};

export const PRICING = {
  slug: 'pricing',
  nav: 'Pricing',
  title: 'Pricing: Free Daily Credits and Plans | AnyRedact',
  description: 'Get 10 free AI redaction credits every day, monthly plans starting at $9, or pay-as-you-go credit packs from $5 that never expire.',
  h1: 'Pricing',

  // The WebApplication node for the page's JSON-LD; build.mjs adds the rest of the graph.
  app({ PRODUCTS, FREE_CREDITS }, node) {
    return {
      '@type': 'WebApplication',
      ...node,
      name: 'AnyRedact',
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Any (web browser)',
      offers: [offer(`Free (${FREE_CREDITS} credits per day)`, 0), ...PRODUCTS.map((p) => offer(p.name, p.cents, p.monthly))],
    };
  },

  body({ PRODUCTS, FREE_CREDITS, AUDIO_CREDITS_PER_MINUTE, CHECK_CREDITS, CREDIT_CHARS, price }, esc) {
    const n = (v) => v.toLocaleString('en-US');
    // Credits mean nothing on their own, so each amount is shown as pages and audio minutes.
    const covers = (credits) => `${n(credits)} pages or ${n(Math.floor(credits / AUDIO_CREDITS_PER_MINUTE))} minutes of audio`;
    const tick = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    const plan = ({ name, amount, per, detail, points, button, href, main }) =>
      `<div class="card plan${main ? ' main' : ''}">${main ? '<span class="plan-badge">Recommended</span>' : ''}<strong>${esc(name)}</strong><span class="plan-price">${esc(amount)}${per ? `<small> / ${per}</small>` : ''}</span><span class="plan-covers">${esc(detail)}</span><a class="btn${main ? ' primary' : ''}" href="${href}">${esc(button)}</a><ul class="plan-points">${points.map((p) => `<li>${tick}${esc(p)}</li>`).join('')}</ul></div>`;
    const monthly = PRODUCTS.filter((p) => p.monthly);
    const plans = [
      plan({ name: 'Free', amount: '$0', detail: `Up to ${FREE_CREDITS} pages or ${Math.floor(FREE_CREDITS / AUDIO_CREDITS_PER_MINUTE)} minutes of audio per day`, points: ['No sign-in required', 'All file formats included', 'Refills every day'], button: 'Redact a file', href: '/' }),
      ...monthly.map((p, i) =>
        plan({ name: p.name, amount: price(p.cents), per: 'month', detail: covers(p.credits), points: ['All file formats included', 'Refills every month', 'Cancel anytime'], button: 'Subscribe', href: `/account?buy=${p.id}`, main: i === 0 }),
      ),
    ].join('');
    const oneOff = PRODUCTS.filter((p) => !p.monthly)
      .map((p) => `<div class="credit-offer"><strong>${esc(p.name)}</strong><span>${esc(covers(p.credits))}</span><span class="credit-price">${esc(price(p.cents))}</span><a class="btn" href="/account?buy=${p.id}">Buy</a></div>`)
      .join('');
    const rows = [
      ['Documents, images, and scans', `1 credit per ${n(CREDIT_CHARS)} characters of text (about one page)`],
      ['Faces and screens', 'Free — detected locally on your device'],
      ['Road signs and number plates', '1 credit per image or page (only when enabled)'],
      ['Audio recordings', `${AUDIO_CREDITS_PER_MINUTE} credits per started minute`],
      ['Final check for missed details', `First check per file is free, then ${CHECK_CREDITS} credit`],
    ]
      .map(([what, credits]) => `<tr><th scope="row">${esc(what)}</th><td>${esc(credits)}</td></tr>`)
      .join('');
    return `<article class="wrap pricing">
<h1>Pricing</h1>
<div class="cards plans">${plans}</div>
<h2>Pay-as-you-go credits</h2>
<p>One-time purchase. Credits never expire.</p>
<div class="credit-offers">${oneOff}</div>
<h2>How credits are used</h2>
<table class="credit-table"><tbody>${rows}</tbody></table>
</article>`;
  },
};
