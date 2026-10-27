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
    const card = (name, amount, detail, button, href, primary) =>
      `<div class="card plan"><strong>${esc(name)}</strong><span class="plan-price">${esc(amount)}</span>${detail ? `<span>${esc(detail)}</span>` : ''}<a class="btn${primary ? ' primary' : ''}" href="${href}">${esc(button)}</a></div>`;
    const plans = [
      card('Free', '$0', `${FREE_CREDITS} credits every day`, 'Redact a file', '/'),
      ...PRODUCTS.filter((p) => p.monthly).map((p) =>
        card(p.name, `${price(p.cents)} / month`, `${p.pages.toLocaleString('en-US')} credits every month`, 'Subscribe', `/account?buy=${p.id}`, true),
      ),
    ].join('');
    const packs = PRODUCTS.filter((p) => !p.monthly)
      .map((p) => card(p.name, price(p.cents), '', 'Buy', `/account?buy=${p.id}`, true))
      .join('');
    const rows = [
      ['PDF, Word, PowerPoint, Excel and text', `1 per ${PAGE_CHARS.toLocaleString('en-US')} characters, about one page`],
      ['Images and scanned pages', 'Same as text, for the text read from them'],
      ['Picture redaction', '1 per picture or page'],
      ['Audio', `${AUDIO_CREDITS_PER_MINUTE} per started minute`],
      ['Final check', `Free once per scan, then ${CHECK_CREDITS}`],
    ]
      .map(([what, credits]) => `<tr><th scope="row">${esc(what)}</th><td>${esc(credits)}</td></tr>`)
      .join('');
    return `<article class="wrap pricing">
<h1>Pricing</h1>
<h2>Plans</h2>
<div class="cards plans">${plans}</div>
<h2>Credit packs</h2>
<p>Pack credits never expire.</p>
<div class="cards plans">${packs}</div>
<h2>Credits per format</h2>
<table class="credit-table"><tbody>${rows}</tbody></table>
</article>`;
  },
};
