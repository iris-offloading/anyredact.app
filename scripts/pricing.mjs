// The public /pricing page. Plans and packs come from src/shared/pricing.ts at
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
  title: 'Pricing | AnyRedact',
  description: 'AnyRedact pricing: 10 free AI redaction credits a day, monthly plans from $9 and credit packs from $5 that never expire. One credit covers about a page of text.',
  h1: 'Pricing',

  jsonLd({ PRODUCTS, FREE_CREDITS }, url) {
    const graph = [
      {
        '@type': 'WebApplication',
        name: 'AnyRedact',
        url: url(''),
        applicationCategory: 'UtilitiesApplication',
        operatingSystem: 'Any (web browser)',
        offers: [offer(`Free, ${FREE_CREDITS} credits a day`, 0), ...PRODUCTS.map((p) => offer(p.name, p.cents, p.monthly))],
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'AnyRedact', item: url('') },
          { '@type': 'ListItem', position: 2, name: 'Pricing', item: url('pricing') },
        ],
      },
    ];
    return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
  },

  body({ PRODUCTS, FREE_CREDITS, AUDIO_CREDITS_PER_MINUTE, CHECK_CREDITS, PAGE_CHARS, price }, esc) {
    const n = (v) => v.toLocaleString('en-US');
    // Credits mean nothing on their own, so each amount is shown as pages and audio minutes.
    const covers = (credits) => `${n(credits)} pages or ${n(Math.floor(credits / AUDIO_CREDITS_PER_MINUTE))} audio minutes`;
    const tick = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    const plan = ({ name, amount, per, detail, points, button, href, main }) =>
      `<div class="card plan${main ? ' main' : ''}">${main ? '<span class="plan-badge">Recommended</span>' : ''}<strong>${esc(name)}</strong><span class="plan-price">${esc(amount)}${per ? `<small> / ${per}</small>` : ''}</span><span class="plan-covers">${esc(detail)}</span><a class="btn${main ? ' primary' : ''}" href="${href}">${esc(button)}</a><ul class="plan-points">${points.map((p) => `<li>${tick}${esc(p)}</li>`).join('')}</ul></div>`;
    const monthly = PRODUCTS.filter((p) => p.monthly);
    const plans = [
      plan({ name: 'Free', amount: '$0', detail: `Up to ${FREE_CREDITS} pages or ${Math.floor(FREE_CREDITS / AUDIO_CREDITS_PER_MINUTE)} audio minutes a day`, points: ['No sign-in needed', 'Every format', 'Resets daily'], button: 'Redact a file', href: '/' }),
      ...monthly.map((p, i) =>
        plan({ name: p.name, amount: price(p.cents), per: 'month', detail: covers(p.pages), points: ['Every format', 'Resets monthly', 'Cancel any time'], button: 'Subscribe', href: `/account?buy=${p.id}`, main: i === 0 }),
      ),
    ].join('');
    const packs = PRODUCTS.filter((p) => !p.monthly)
      .map((p) => `<div class="pack"><strong>${esc(p.name)}</strong><span>${esc(covers(p.pages))}</span><span class="pack-price">${esc(price(p.cents))}</span><a class="btn" href="/account?buy=${p.id}">Buy</a></div>`)
      .join('');
    const rows = [
      ['Documents, images and scans', `1 per ${n(PAGE_CHARS)} characters of text, about one page`],
      ['Faces, screens, road signs and number plates', '1 per picture or page, only when ticked'],
      ['Audio', `${AUDIO_CREDITS_PER_MINUTE} per started minute`],
      ['Check for anything left', `Free once per file, then ${CHECK_CREDITS}`],
    ]
      .map(([what, credits]) => `<tr><th scope="row">${esc(what)}</th><td>${esc(credits)}</td></tr>`)
      .join('');
    return `<article class="wrap pricing">
<h1>Pricing</h1>
<div class="cards plans">${plans}</div>
<h2>Credit packs</h2>
<p>Pack credits never expire. No subscription.</p>
<div class="packs">${packs}</div>
<h2>Credits per format</h2>
<table class="credit-table"><tbody>${rows}</tbody></table>
</article>`;
  },
};
