import { h } from './dom.ts';

export interface Stretch {
  id: string;
  kind: 'finding' | 'manual';
  start: number;
  end: number;
  enabled: boolean;
}

interface Options {
  url: string;
  duration: number;
  stretches: () => Stretch[];
  onDraw(start: number, end: number): void;
  onClick(s: Stretch): void;
  /** Called as the playhead moves, while playing and on every seek. */
  onTime?(t: number): void;
}

export const clock = (t: number) => {
  const s = Math.floor(t);
  const hms = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60];
  return (hms[0] ? `${hms[0]}:${String(hms[1]).padStart(2, '0')}` : String(hms[1])) + `:${String(hms[2]).padStart(2, '0')}`;
};

/** A player over a bar of the recording; drag on the bar to bleep a stretch, click a stretch to toggle it. */
export class Timeline {
  readonly el: HTMLElement;
  readonly player: HTMLAudioElement;
  private bar: HTMLElement;
  private marks: HTMLElement;
  private head: HTMLElement;
  private ghost: HTMLElement;
  private pointer: HTMLElement;
  private drag: { from: number; to: number } | null = null;

  constructor(private opts: Options) {
    this.player = h('audio', { controls: true, preload: 'metadata', src: opts.url, className: 'player' });
    this.marks = h('div', { className: 'stretches' });
    this.head = h('div', { className: 'playhead' });
    this.ghost = h('div', { className: 'stretch ghost', hidden: true });
    this.pointer = h('div', { className: 'pointer', hidden: true });
    this.bar = h('div', { className: 'timeline', 'aria-label': 'Recording timeline. Drag to bleep a stretch.' }, this.marks, this.ghost, this.pointer, this.head);
    this.el = h('div', { className: 'audio-view' }, this.player, this.bar, h('div', { className: 'timeline-ends' }, h('span', {}, '0:00'), h('span', {}, clock(opts.duration))));
    // timeupdate fires only a few times a second, too slow to follow words, so follow frames while playing.
    let frame = 0;
    const follow = () => {
      this.moveHead();
      frame = requestAnimationFrame(follow);
    };
    this.player.addEventListener('play', () => (cancelAnimationFrame(frame), follow()));
    for (const ev of ['pause', 'ended']) this.player.addEventListener(ev, () => (cancelAnimationFrame(frame), this.moveHead()));
    this.player.addEventListener('seeked', () => this.moveHead());
    this.bar.addEventListener('pointerdown', (e) => this.down(e));
    this.bar.addEventListener('pointermove', (e) => this.move(e));
    this.bar.addEventListener('pointerup', (e) => this.up(e));
    this.bar.addEventListener('pointercancel', () => ((this.drag = null), (this.ghost.hidden = true)));
    this.draw();
  }

  private time(e: PointerEvent) {
    const r = this.bar.getBoundingClientRect();
    return Math.min(this.opts.duration, Math.max(0, ((e.clientX - r.left) / r.width) * this.opts.duration));
  }

  private place(el: HTMLElement, start: number, end: number) {
    el.style.left = `${(start / this.opts.duration) * 100}%`;
    el.style.width = `max(3px, ${((end - start) / this.opts.duration) * 100}%)`;
  }

  private down(e: PointerEvent) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.stretch:not(.ghost)')) return;
    this.bar.setPointerCapture(e.pointerId);
    const t = this.time(e);
    this.drag = { from: t, to: t };
    e.preventDefault();
  }

  private move(e: PointerEvent) {
    if (!this.drag) return;
    this.drag.to = this.time(e);
    const [a, b] = [this.drag.from, this.drag.to].sort((x, y) => x - y);
    this.place(this.ghost, a, b);
    this.ghost.hidden = false;
  }

  private up(e: PointerEvent) {
    if (!this.drag) return;
    const [a, b] = [this.drag.from, this.time(e)].sort((x, y) => x - y);
    this.drag = null;
    this.ghost.hidden = true;
    // A drag shorter than 4 px is a click: jump there.
    if (((b - a) / this.opts.duration) * this.bar.getBoundingClientRect().width > 4) this.opts.onDraw(a, b);
    else this.seek(a);
  }

  seek(t: number, play = false) {
    this.player.currentTime = t;
    this.moveHead();
    if (play) this.player.play().catch(() => {});
  }

  /** Marks a moment on the bar, or clears the mark. */
  point(t: number | null) {
    this.pointer.hidden = t === null;
    if (t !== null) this.pointer.style.left = `${(t / this.opts.duration) * 100}%`;
  }

  private moveHead() {
    this.head.style.left = `${(this.player.currentTime / this.opts.duration) * 100}%`;
    this.opts.onTime?.(this.player.currentTime);
  }

  draw() {
    this.marks.replaceChildren(
      ...this.opts.stretches().map((s) => {
        const el = h('button', {
          type: 'button',
          className: `stretch${s.kind === 'manual' ? ' manual' : ''}${s.enabled ? '' : ' off'}`,
          title: `${clock(s.start)} to ${clock(s.end)}`,
          'data-key': s.id,
        });
        this.place(el, s.start, s.end);
        el.addEventListener('click', () => this.opts.onClick(s));
        return el;
      }),
    );
  }
}
