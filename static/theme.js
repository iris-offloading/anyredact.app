// Theme: system (default), light or dark, picked with the header switch and
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
  const apply = (theme) => {
    if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
    else delete root.dataset.theme;
  };
  apply(read());

  document.addEventListener('DOMContentLoaded', () => {
    const group = document.querySelector('.theme-switch');
    if (!group) return;
    const buttons = [...group.querySelectorAll('button')];
    const sync = () => {
      const current = root.dataset.theme || 'system';
      for (const b of buttons) {
        const on = b.dataset.themeValue === current;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      }
    };
    const choose = (b) => {
      const value = b.dataset.themeValue;
      apply(value);
      try {
        if (value === 'system') localStorage.removeItem('theme');
        else localStorage.setItem('theme', value);
      } catch {
        /* storage unavailable: the choice lasts for this page only */
      }
      sync();
    };
    for (const b of buttons) b.addEventListener('click', () => choose(b));
    // Arrow keys move between options, as in any radio group.
    group.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const i = buttons.indexOf(document.activeElement);
      const next = buttons[(i + step + buttons.length) % buttons.length];
      choose(next);
      next.focus();
    });
    sync();
    group.hidden = false;
  });
})();
