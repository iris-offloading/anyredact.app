// Light/dark theme: follows the system until the visitor picks one with the
// header toggle. Loaded in <head> so the saved theme applies before first paint.
(() => {
  const root = document.documentElement;
  const read = () => {
    try {
      return localStorage.getItem('theme');
    } catch {
      return null;
    }
  };
  const saved = read();
  if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;

  const current = () => root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const label = (btn) => {
    const next = current() === 'dark' ? 'light' : 'dark';
    btn.textContent = next === 'dark' ? '☾ Dark' : '☀ Light';
    btn.setAttribute('aria-label', `Switch to ${next} mode`);
  };

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.querySelector('.theme-toggle');
    if (!btn) return;
    btn.hidden = false;
    label(btn);
    btn.addEventListener('click', () => {
      const next = current() === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try {
        localStorage.setItem('theme', next);
      } catch {
        /* storage unavailable: the choice lasts for this page only */
      }
      label(btn);
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => label(btn));
  });
})();
