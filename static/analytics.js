// Google Analytics (GA4). Each hit carries the page path only: no query string, no hash
// (the sign-in token lives there) and the page's fixed title, so file names, text and
// findings never reach Google. Cookies wait for consent in the EU, EEA, UK and Switzerland
// (by Cloudflare's country, /api/country), where the bar asks once; elsewhere they are on
// until declined (footer "Cookies" button).
(() => {
  const ID = 'G-VB0F93DF69';
  const KEY = 'analytics-consent';
  // prettier-ignore
  const ASK = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH'];
  const read = () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  };
  const write = (value) => {
    try {
      localStorage.setItem(KEY, value);
    } catch {
      /* storage unavailable: the choice lasts for this page only */
    }
  };

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  const noAds = { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' };
  // Denied until the visitor's choice or country is known; tags wait up to 500 ms for it.
  // (Google's own region defaults left analytics denied everywhere in testing.)
  gtag('consent', 'default', { ...noAds, analytics_storage: 'denied', wait_for_update: 500 });
  const saved = read();
  if (saved) gtag('consent', 'update', { analytics_storage: saved === 'yes' ? 'granted' : 'denied' });
  gtag('set', {
    page_location: location.origin + location.pathname,
    page_referrer: document.referrer.split(/[?#]/)[0],
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  gtag('js', new Date());
  gtag('config', ID);
  const tag = document.createElement('script');
  tag.async = true;
  tag.src = `https://www.googletagmanager.com/gtag/js?id=${ID}`;
  document.head.append(tag);

  const forget = () => {
    for (const c of document.cookie.split(';')) {
      const name = c.split('=')[0].trim();
      if (!name.startsWith('_ga')) continue;
      for (const domain of ['', `; domain=${location.hostname}`, `; domain=.${location.hostname.replace(/^www\./, '')}`]) {
        document.cookie = `${name}=; max-age=0; path=/${domain}`;
      }
    }
  };
  const choose = (yes) => {
    write(yes ? 'yes' : 'no');
    gtag('consent', 'update', { analytics_storage: yes ? 'granted' : 'denied' });
    if (!yes) forget();
    document.querySelector('.consent-bar')?.remove();
  };
  const ask = () => {
    if (document.querySelector('.consent-bar')) return;
    const bar = document.createElement('div');
    bar.className = 'consent-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Cookies');
    bar.innerHTML =
      '<p>We use Google Analytics cookies to understand which pages are most helpful. <a href="/privacy">Privacy policy</a></p>' +
      '<div class="consent-actions"><button type="button" class="btn" data-choice="no">Decline</button>' +
      '<button type="button" class="btn dark" data-choice="yes">Accept</button></div>';
    bar.addEventListener('click', (e) => {
      const button = e.target.closest('[data-choice]');
      if (button) choose(button.dataset.choice === 'yes');
    });
    document.body.append(bar);
  };

  const ready = new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve));
  ready.then(() => {
    for (const button of document.querySelectorAll('[data-consent]')) button.addEventListener('click', ask);
  });
  if (saved) return;
  let cached = null;
  try {
    cached = sessionStorage.getItem('country');
  } catch {
    /* no session storage: ask the server on every page */
  }
  (cached ? Promise.resolve(cached) : fetch('/api/country').then((r) => r.json()).then(({ country }) => country || ''))
    .then((country) => {
      try {
        sessionStorage.setItem('country', country);
      } catch {
        /* see above */
      }
      if (country && !ASK.includes(country)) gtag('consent', 'update', { analytics_storage: 'granted' });
      else ready.then(ask);
    })
    .catch(() => ready.then(ask));
})();
