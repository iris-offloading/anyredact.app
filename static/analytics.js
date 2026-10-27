// Google Analytics (GA4). Each hit carries the page path only: no query string, no hash
// (the sign-in token lives there) and the page's fixed title, so file names, text and
// findings never reach Google. Cookies wait for consent in the EU, EEA, UK and Switzerland,
// where the bar asks once; elsewhere they are on until declined (footer "Cookies" button).
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
  gtag('consent', 'default', { ...noAds, analytics_storage: 'denied', region: ASK });
  gtag('consent', 'default', { ...noAds, analytics_storage: 'granted' });
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
      '<p>Google Analytics cookies help us see which pages people use. <a href="/privacy">Privacy</a></p>' +
      '<div class="consent-actions"><button type="button" class="btn" data-choice="no">Decline</button>' +
      '<button type="button" class="btn dark" data-choice="yes">Accept</button></div>';
    bar.addEventListener('click', (e) => {
      const button = e.target.closest('[data-choice]');
      if (button) choose(button.dataset.choice === 'yes');
    });
    document.body.append(bar);
  };

  document.addEventListener('DOMContentLoaded', () => {
    for (const button of document.querySelectorAll('[data-consent]')) button.addEventListener('click', ask);
    if (saved) return;
    fetch('/api/country')
      .then((r) => r.json())
      .then(({ country }) => (!country || ASK.includes(country)) && ask())
      .catch(() => {});
  });
})();
