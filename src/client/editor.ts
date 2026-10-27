import type { Page, Rect } from './types.ts';

export interface Overlay {
  id: string;
  kind: 'finding' | 'manual';
  rect: Rect;
  enabled: boolean;
}

interface Options {
  page: Page;
  overlays: () => Overlay[];
  onDraw(rect: Rect): void;
  onClick(o: Overlay): void;
}

/** Shows a page bitmap with redaction boxes; drag to add a box, click a box to toggle it. */
export class PageEditor {
  readonly el: HTMLElement;
  private overlay: HTMLCanvasElement;
  private drag: { x: number; y: number; cur: Rect | null } | null = null;

  constructor(private opts: Options) {
    const { canvas } = opts.page;
    this.el = document.createElement('div');
    this.el.className = 'page';
    this.el.dataset.page = String(opts.page.index);
    const img = document.createElement('canvas');
    img.width = canvas.width;
    img.height = canvas.height;
    img.getContext('2d')!.drawImage(canvas, 0, 0);
    img.className = 'page-img';
    this.overlay = document.createElement('canvas');
    this.overlay.width = canvas.width;
    this.overlay.height = canvas.height;
    this.overlay.className = 'page-overlay';
    this.overlay.setAttribute('aria-label', `${opts.page.label ?? `Page ${opts.page.index + 1}`}. Drag to draw a redaction box.`);
    this.el.append(img, this.overlay);
    this.overlay.addEventListener('pointerdown', (e) => this.down(e));
    this.overlay.addEventListener('pointermove', (e) => this.move(e));
    this.overlay.addEventListener('pointerup', (e) => this.up(e));
    this.overlay.addEventListener('pointercancel', () => ((this.drag = null), this.draw()));
    this.draw();
  }

  private point(e: PointerEvent) {
    // A picture in a Word file can be stretched, so each axis has its own scale.
    const r = this.overlay.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * this.overlay.width) / r.width, y: ((e.clientY - r.top) * this.overlay.height) / r.height };
  }

  private down(e: PointerEvent) {
    if (e.button !== 0) return;
    this.overlay.setPointerCapture(e.pointerId);
    const p = this.point(e);
    this.drag = { ...p, cur: null };
    e.preventDefault();
  }

  private move(e: PointerEvent) {
    if (!this.drag) return;
    const p = this.point(e);
    this.drag.cur = {
      x: Math.min(p.x, this.drag.x),
      y: Math.min(p.y, this.drag.y),
      w: Math.abs(p.x - this.drag.x),
      h: Math.abs(p.y - this.drag.y),
    };
    this.draw();
  }

  private up(e: PointerEvent) {
    if (!this.drag) return;
    const { cur } = this.drag;
    const minSize = this.overlay.width / this.overlay.getBoundingClientRect().width * 4;
    this.drag = null;
    if (cur && cur.w > minSize && cur.h > minSize) {
      this.opts.onDraw(cur);
      return;
    }
    const p = this.point(e);
    // Topmost first: manual boxes are drawn last.
    const hit = [...this.opts.overlays()]
      .reverse()
      .find((o) => p.x >= o.rect.x && p.x <= o.rect.x + o.rect.w && p.y >= o.rect.y && p.y <= o.rect.y + o.rect.h);
    if (hit) this.opts.onClick(hit);
    else this.draw();
  }

  draw() {
    const ctx = this.overlay.getContext('2d')!;
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    const lw = Math.max(2, this.overlay.width / 600);
    for (const o of this.opts.overlays()) {
      const { x, y, w, h } = o.rect;
      if (o.enabled) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(x, y, w, h);
      } else {
        ctx.setLineDash([lw * 3, lw * 2]);
        ctx.strokeStyle = '#e8590c';
        ctx.lineWidth = lw;
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
      }
    }
    const cur = this.drag?.cur;
    if (cur) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(cur.x, cur.y, cur.w, cur.h);
    }
  }
}
