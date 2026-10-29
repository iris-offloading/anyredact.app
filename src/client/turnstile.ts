// Cloudflare Turnstile (src/worker/turnstile.ts). The widget runs out of sight and only
// shows, in a box over the page, when Cloudflare wants the visitor to click.
import { h } from './dom.ts';

interface Turnstile {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  remove(id: string): void;
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<Turnstile> | undefined;

function load(): Promise<Turnstile> {
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = h('script', { src: SCRIPT, async: true });
    script.onload = () => resolve((window as unknown as { turnstile: Turnstile }).turnstile);
    script.onerror = () => {
      loading = undefined;
      reject(new Error('Could not load the human check. Check your connection and try again.'));
    };
    document.head.append(script);
  });
  return loading;
}

const theme = () => document.documentElement.dataset.theme ?? 'auto';

/** A one-time Turnstile token for this site key. */
export async function humanToken(siteKey: string): Promise<string> {
  const turnstile = await load();
  const box = h('div', { className: 'human-check' });
  document.body.append(box);
  return new Promise<string>((resolve, reject) => {
    let id = '';
    const done = (fn: () => void) => {
      turnstile.remove(id);
      box.remove();
      fn();
    };
    const fail = () => done(() => reject(new Error("Couldn't confirm you're human. Please try again.")));
    id = turnstile.render(box, {
      sitekey: siteKey,
      theme: theme(),
      appearance: 'interaction-only',
      'before-interactive-callback': () => box.classList.add('shown'),
      callback: (token: string) => done(() => resolve(token)),
      'error-callback': fail,
      'timeout-callback': fail,
      'unsupported-callback': fail,
    });
  });
}
