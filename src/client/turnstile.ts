// Cloudflare Turnstile (src/worker/turnstile.ts), placed next to the button it guards. The widget
// takes no room and only shows when Cloudflare wants the visitor to click.

interface Turnstile {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}

export interface HumanCheck {
  /** A one-time token; the widget then fetches the next one, or goes when made with `once`. */
  token(): Promise<string>;
  remove(): void;
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<Turnstile> | undefined;

function load(): Promise<Turnstile> {
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => resolve((window as unknown as { turnstile: Turnstile }).turnstile);
    script.onerror = () => {
      loading = undefined;
      reject(new Error('Could not load the security check. Please check your connection and try again.'));
    };
    document.head.append(script);
  });
  return loading;
}

const theme = () => document.documentElement.dataset.theme ?? 'auto';
const failed = (code?: string) => new Error(`Verification failed${code ? ` (code ${code})` : ''}. Please try again.`);

/**
 * Runs Turnstile in `slot` right away, so a token is usually ready by the time the button is pressed.
 * With `once`, the widget goes after its token is taken.
 */
export function humanCheck(slot: HTMLElement, siteKey: string, once = false): HumanCheck {
  let resolve!: (token: string) => void;
  let reject!: (err: Error) => void;
  let ready!: Promise<string>;
  const next = () => {
    ready = new Promise<string>((a, b) => ((resolve = a), (reject = b)));
    ready.catch(() => {});
  };
  next();
  const restart = () => {
    next();
    widget.then(({ turnstile, id }) => turnstile.reset(id)).catch(() => {});
  };
  const widget: Promise<{ turnstile: Turnstile; id: string }> = load().then((turnstile) => ({
    turnstile,
    id: turnstile.render(slot, {
      sitekey: siteKey,
      theme: theme(),
      appearance: 'interaction-only',
      size: 'flexible',
      // Out of the layout until then (static/styles.css).
      'before-interactive-callback': () => slot.classList.add('shown'),
      'after-interactive-callback': () => slot.classList.remove('shown'),
      callback: (token: string) => resolve(token),
      // Tokens last 5 minutes; Turnstile fetches a fresh one, which arrives through callback.
      'expired-callback': next,
      // Turnstile retries by itself after an error, so a later token still counts. The widget shows
      // what went wrong.
      'error-callback': (code: string) => {
        console.warn('turnstile error', code);
        slot.classList.add('shown');
        reject(failed(code));
        next();
      },
      'timeout-callback': () => {
        reject(failed());
        restart();
      },
      'unsupported-callback': () => reject(failed()),
    }),
  }));
  widget.catch((err) => reject(err));
  const remove = () => void widget.then(({ turnstile, id }) => turnstile.remove(id)).catch(() => {});
  return {
    async token() {
      try {
        return await ready;
      } finally {
        if (once) remove();
        else restart();
      }
    },
    remove,
  };
}
