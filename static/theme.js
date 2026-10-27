// Header behaviour. Theme: system (default), light or dark, picked with the header button and
// kept in localStorage. Loaded in <head> so a saved theme applies before first paint.
(() => {
  const root = document.documentElement;
  const read = () => {
    try {
      return localStorage.getItem('theme');
    } catch {
      return null;
    }
  };
  // Hover fades would otherwise make a few elements lag behind the rest of the page.
  const still = () => {
    root.classList.add('theme-changing');
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-changing')));
  };
  const apply = (theme) => {
    if (document.body) still();
    if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
    else delete root.dataset.theme;
  };
  apply(read());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!root.dataset.theme) still();
  });

  document.addEventListener('DOMContentLoaded', () => {
    // The sign-in link becomes "Account" once a session exists (cookie set by the Worker).
    const account = document.querySelector('.signin-link');
    if (account && /(?:^|;\s*)signed_in=1/.test(document.cookie)) account.textContent = 'Account';

    const button = document.querySelector('.theme-button');
    if (!button) return;
    const ORDER = ['system', 'light', 'dark'];
    const sync = () => {
      const current = root.dataset.theme || 'system';
      button.setAttribute('aria-label', `Theme: ${current}`);
      button.title = `Theme: ${current}`;
      for (const icon of button.querySelectorAll('[data-theme-icon]')) icon.style.display = icon.dataset.themeIcon === current ? '' : 'none';
    };
    button.addEventListener('click', () => {
      const value = ORDER[(ORDER.indexOf(root.dataset.theme || 'system') + 1) % ORDER.length];
      apply(value);
      try {
        if (value === 'system') localStorage.removeItem('theme');
        else localStorage.setItem('theme', value);
      } catch {
        /* storage unavailable: the choice lasts for this page only */
      }
      sync();
    });
    sync();
    button.hidden = false;
  });
})();
