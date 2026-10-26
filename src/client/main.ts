import { analyzeUnits } from '../shared/analyze.ts';
import { ENTITY_LABELS, type EntityType } from '../shared/detect.ts';
import { detectWithAi, type AiEntity } from './ai.ts';
import { CHECK_LABELS, checkRemaining, remainingText } from './check.ts';
import { PageEditor, type Overlay } from './editor.ts';
import type { Finding, LoadedDoc, ManualBox, RedactStyle } from './types.ts';

type Kind = LoadedDoc['kind'];

const ACCEPT: Record<Kind | 'all', string> = {
  pdf: '.pdf,application/pdf',
  image: 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp',
  docx: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  text: '.txt,.md,.csv,.tsv,.json,.log,.xml,.html,.yaml,.yml,text/*',
  all: '',
};
ACCEPT.all = [ACCEPT.pdf, ACCEPT.image, ACCEPT.docx, ACCEPT.text].join(',');

// What the "Look for" chips offer. AI and pattern findings are both filtered by these.
const CHIP_TYPES: EntityType[] = ['name', 'address', 'email', 'phone', 'id', 'ssn', 'card', 'iban', 'ip', 'url', 'date', 'org', 'other'];
const DEFAULT_TYPES: EntityType[] = ['name', 'address', 'email', 'phone', 'id', 'ssn', 'card', 'iban', 'ip', 'other'];

function kindOf(file: File): Kind | null {
  const n = file.name.toLowerCase();
  if (file.type === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (/^image\/(png|jpeg|webp)$/.test(file.type) || /\.(png|jpe?g|webp)$/.test(n)) return 'image';
  if (n.endsWith('.docx')) return 'docx';
  if (n.endsWith('.doc')) return null;
  if (file.type.startsWith('text/') || /\.(txt|md|csv|tsv|json|log|xml|html?|ya?ml)$/.test(n) || !file.type) return 'text';
  return null;
}

async function load(file: File, progress: (m: string) => void): Promise<LoadedDoc> {
  switch (kindOf(file)) {
    case 'pdf':
      return (await import('./formats/pdf.ts')).loadPdf(file, progress);
    case 'image':
      return (await import('./formats/image.ts')).loadImage(file, progress);
    case 'docx':
      return (await import('./formats/docx.ts')).loadDocx(file, progress);
    case 'text':
      return (await import('./formats/text.ts')).loadText(file);
    default:
      throw new Error('This file type is not supported yet. Try PDF, PNG, JPG, WebP, DOCX or a text file. Old .doc files need to be saved as .docx first.');
  }
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & Record<string, unknown> = {}, ...children: (Node | string)[]) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('data-') || k.startsWith('aria-') || k === 'for') el.setAttribute(k, String(v));
    else (el as unknown as Record<string, unknown>)[k] = v;
  }
  el.append(...children);
  return el;
};

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
  },
};

class App {
  private doc: LoadedDoc | null = null;
  private findings: Finding[] = [];
  private boxes: ManualBox[] = [];
  private aiEntities: AiEntity[] | null = null;
  private overrides = new Map<string, boolean>();
  private editors: PageEditor[] = [];
  private aiError: string | null = null;
  private types = new Set<EntityType>(DEFAULT_TYPES);
  private terms = '';
  private style: RedactStyle = 'block';
  private busy = false;

  private intake: HTMLElement;
  private status: HTMLElement;
  private workspace: HTMLElement;
  private list: HTMLElement;
  private preview: HTMLElement;
  private notes: HTMLElement;
  private docName: HTMLElement;
  private download: HTMLButtonElement;
  private warn: HTMLElement;
  private styleRow: HTMLElement;
  private fileInput: HTMLInputElement;

  constructor(private root: HTMLElement) {
    const format = (root.dataset.format as Kind | 'all') || 'all';
    root.textContent = '';

    this.fileInput = h('input', { type: 'file', accept: ACCEPT[format], className: 'visually-hidden', id: 'file-input' });
    this.fileInput.addEventListener('change', () => this.fileInput.files?.[0] && this.open(this.fileInput.files[0]));

    const drop = h(
      'label',
      { className: 'drop', for: 'file-input' },
      this.fileInput,
      h('span', { className: 'drop-icon', 'aria-hidden': 'true' }, '⬆'),
      h('span', { className: 'drop-title' }, 'Drop a file here or ', h('u', {}, 'choose one')),
      h('span', { className: 'drop-sub' }, root.dataset.hint || 'PDF, Word (DOCX), PNG, JPG, WebP or text'),
    );
    for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => (e.preventDefault(), drop.classList.add('over')));
    for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = (e as DragEvent).dataTransfer?.files[0];
      if (f) this.open(f);
    });

    const pasteArea = h('textarea', { rows: 6, placeholder: 'Paste text that contains emails, phone numbers, names…', 'aria-label': 'Text to redact' });
    const paste = h(
      'details',
      { className: 'paste', open: format === 'text' },
      h('summary', {}, 'Or paste text'),
      pasteArea,
      h('button', {
        type: 'button',
        className: 'btn',
        textContent: 'Find sensitive info',
        onclick: () => pasteArea.value.trim() && this.open(new File([pasteArea.value], 'pasted-text.txt', { type: 'text/plain' })),
      }),
    );

    this.intake = h('div', { className: 'intake' }, drop, paste);
    this.status = h('div', { className: 'status', role: 'status', 'aria-live': 'polite', hidden: true });

    // Workspace: side panel + preview.
    this.docName = h('strong', { className: 'doc-name' });
    const reset = h('button', { type: 'button', className: 'btn ghost', textContent: 'New file', onclick: () => this.reset() });

    const typeBoxes = h('div', { className: 'types' });
    for (const t of CHIP_TYPES) {
      const cb = h('input', { type: 'checkbox', checked: this.types.has(t) });
      cb.addEventListener('change', () => {
        cb.checked ? this.types.add(t) : this.types.delete(t);
        this.analyze();
      });
      typeBoxes.append(h('label', { className: 'chip' }, cb, ENTITY_LABELS[t]));
    }

    const termsArea = h('textarea', { rows: 3, placeholder: 'One per line, e.g. a name or project', 'aria-label': 'Words to always redact' });
    let termTimer = 0;
    termsArea.addEventListener('input', () => {
      clearTimeout(termTimer);
      termTimer = window.setTimeout(() => {
        this.terms = termsArea.value;
        this.analyze();
      }, 400);
    });
    this.addTerm = (t: string) => {
      termsArea.value = (termsArea.value.trim() ? termsArea.value.trim() + '\n' : '') + t;
      this.terms = termsArea.value;
      this.analyze();
    };

    const styleSel = h('select', { 'aria-label': 'Redaction style' });
    styleSel.append(h('option', { value: 'block', textContent: 'Black out (█████)' }), h('option', { value: 'label', textContent: 'Replace with label ([EMAIL])' }));
    styleSel.addEventListener('change', () => (this.style = styleSel.value as RedactStyle));
    this.styleRow = h('label', { className: 'row' }, 'Style ', styleSel);

    this.download = h('button', { type: 'button', className: 'btn primary', textContent: 'Download redacted file', onclick: () => this.export() });
    this.warn = h('div', { className: 'status error warn', role: 'alert', hidden: true });
    this.list = h('div', { className: 'findings' });
    this.notes = h('ul', { className: 'notes' });

    const panel = h(
      'aside',
      { className: 'panel' },
      h('div', { className: 'panel-head' }, this.docName, reset),
      h('h3', {}, 'Look for'),
      typeBoxes,
      h('h3', {}, 'Always redact'),
      termsArea,
      h('h3', {}, 'Found'),
      this.list,
      this.styleRow,
      this.download,
      this.warn,
      this.notes,
    );
    this.preview = h('div', { className: 'preview' });
    this.workspace = h('div', { className: 'workspace', hidden: true }, panel, this.preview);

    root.append(this.intake, this.status, this.workspace);
    document.addEventListener('paste', (e) => {
      if (this.doc || (e.target as HTMLElement)?.closest?.('textarea,input')) return;
      const f = e.clipboardData?.files[0];
      if (f) this.open(f);
    });
  }

  private addTerm: (t: string) => void = () => {};

  private say(msg: string, error = false) {
    this.status.hidden = !msg;
    this.status.textContent = msg;
    this.status.classList.toggle('error', error);
  }

  async open(file: File) {
    if (this.busy) return;
    if (file.size > 100 * 1024 * 1024) return this.say('That file is over 100 MB, which is too large to process in the browser.', true);
    this.busy = true;
    this.reset(false);
    this.say(`Opening ${file.name}…`);
    try {
      this.doc = await load(file, (m) => this.say(m));
      this.docName.textContent = file.name;
      this.styleRow.hidden = this.doc.kind === 'pdf' || this.doc.kind === 'image';
      this.notes.replaceChildren(...this.doc.notes.map((n) => h('li', {}, n)));
      this.intake.hidden = true;
      this.workspace.hidden = false;
      this.renderPreview();
      await this.analyze();
    } catch (err) {
      console.error(err);
      this.doc = null;
      this.say(err instanceof Error ? err.message : 'Could not open that file.', true);
    } finally {
      this.busy = false;
      this.fileInput.value = '';
    }
  }

  reset(clearStatus = true) {
    this.doc = null;
    this.findings = [];
    this.boxes = [];
    this.aiEntities = null;
    this.aiError = null;
    this.overrides.clear();
    this.editors = [];
    this.preview.replaceChildren();
    this.list.replaceChildren();
    this.workspace.hidden = true;
    this.intake.hidden = false;
    if (clearStatus) this.say('');
  }

  private async analyze() {
    const doc = this.doc;
    if (!doc) return;
    const terms = this.terms
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean)
      .map((text) => ({ text, type: 'custom' as EntityType }));

    // Ask the model once per document; pattern rules run alongside it as a safety net.
    if (!this.aiEntities && !this.aiError) {
      const text = doc.units.map((u) => u.text).join('\n\n');
      if (text.trim()) {
        this.say('Finding names, addresses and other personal details…');
        try {
          this.aiEntities = await detectWithAi(text);
        } catch (err) {
          this.aiError = err instanceof Error ? err.message : 'AI detection failed.';
        }
      }
      if (this.doc !== doc) return;
    }

    const byId = new Map(doc.units.map((u) => [u.id, u]));
    const spans = analyzeUnits(doc.units, {
      types: this.types,
      terms,
      ai: this.aiEntities,
    }).filter((s) => s.type === 'custom' || this.types.has(s.type));
    const findings: Finding[] = spans.map((s) => {
      const unit = byId.get(s.unitId)!;
      const key = `${unit.id}:${s.start}:${s.end}`;
      return {
        key,
        unitId: unit.id,
        start: s.start,
        end: s.end,
        type: s.type,
        source: s.source,
        text: unit.text.slice(s.start, s.end),
        enabled: this.overrides.get(key) ?? !s.publicHint,
        publicHint: s.publicHint,
        page: unit.page,
        rects: unit.rectsFor?.(s.start, s.end) ?? [],
      };
    });
    this.findings = findings;
    this.warn.hidden = true;
    if (this.aiError) this.say(`${this.aiError} Showing results from the built-in rules only, which can miss names and addresses. Review carefully.`, true);
    else this.say('');
    this.renderList();
    this.refreshPreview();
  }

  private toggle(keys: string[], on: boolean) {
    for (const k of keys) {
      this.overrides.set(k, on);
      const f = this.findings.find((x) => x.key === k);
      if (f) f.enabled = on;
    }
    this.renderList();
    this.refreshPreview();
  }

  private renderList() {
    const groups = new Map<EntityType, Finding[]>();
    for (const f of this.findings) (groups.get(f.type) ?? groups.set(f.type, []).get(f.type)!).push(f);
    const manual = this.boxes.length;
    if (!groups.size && !manual) {
      const visual = this.doc?.pages.length;
      this.list.replaceChildren(h('p', { className: 'empty' }, visual ? 'Nothing detected yet. Drag on the preview to draw boxes, or add words above.' : 'Nothing detected. Add words above, or select text in the preview to redact it.'));
      return;
    }
    const out: HTMLElement[] = [];
    for (const [type, items] of groups) {
      const on = items.filter((f) => f.enabled).length;
      const all = h('input', { type: 'checkbox', checked: on === items.length, indeterminate: on > 0 && on < items.length });
      all.addEventListener('change', () => this.toggle(items.map((f) => f.key), all.checked));
      const rows = items.map((f) => {
        const cb = h('input', { type: 'checkbox', checked: f.enabled });
        cb.addEventListener('change', () => this.toggle([f.key], cb.checked));
        const label = f.text.length > 48 ? f.text.slice(0, 46) + '…' : f.text;
        const where = f.page !== undefined && (this.doc?.pages.length ?? 0) > 1 ? ` · p${f.page + 1}` : '';
        const row = h('label', { className: 'finding' + (f.enabled ? '' : ' off') }, cb, h('span', { className: 'ftext' }, label), h('small', { title: f.publicHint ?? '' }, (f.publicHint ? 'public? ' : '') + (f.source === 'ai' ? 'AI' : '') + where));
        row.addEventListener('mouseenter', () => this.focus(f));
        return row;
      });
      out.push(h('details', { className: 'group', open: items.length <= 12 }, h('summary', {}, all, ` ${ENTITY_LABELS[type]} `, h('span', { className: 'count' }, `${on}/${items.length}`)), ...rows));
    }
    if (manual) {
      out.push(h('p', { className: 'manual-count' }, `${manual} hand-drawn box${manual > 1 ? 'es' : ''}. Click a box on the preview to remove it.`));
    }
    this.list.replaceChildren(...out);
  }

  private focus(f: Finding) {
    const el = this.preview.querySelector<HTMLElement>(`[data-key="${CSS.escape(f.key)}"]`) ?? (f.page !== undefined ? this.editors[f.page]?.el : null);
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  private renderPreview() {
    const doc = this.doc!;
    if (doc.pages.length) {
      this.editors = doc.pages.map(
        (page) =>
          new PageEditor({
            page,
            overlays: () => this.overlaysFor(page.index),
            onDraw: (rect) => {
              this.boxes.push({ ...rect, page: page.index, id: crypto.randomUUID() });
              this.renderList();
              this.refreshPreview();
            },
            onClick: (o) => {
              if (o.kind === 'manual') this.boxes = this.boxes.filter((b) => b.id !== o.id);
              else {
                const f = this.findings.find((x) => x.key === o.id);
                if (f) return this.toggle([f.key], !f.enabled);
              }
              this.renderList();
              this.refreshPreview();
            },
          }),
      );
      this.preview.replaceChildren(
        h('p', { className: 'hint' }, 'Drag on a page to add a box. Click a box to turn it off or remove it.'),
        ...this.editors.map((e) => e.el),
      );
    } else {
      this.preview.replaceChildren();
      this.preview.addEventListener('mouseup', this.onSelect);
    }
  }

  private onSelect = () => {
    const sel = getSelection()?.toString().trim();
    if (!sel || sel.length < 2 || sel.length > 200 || !this.doc || this.doc.pages.length) return;
    this.preview.querySelector('.sel-add')?.remove();
    const btn = h('button', { type: 'button', className: 'btn sel-add', textContent: `Redact “${sel.length > 30 ? sel.slice(0, 28) + '…' : sel}” everywhere` });
    btn.addEventListener('click', () => {
      getSelection()?.removeAllRanges();
      this.addTerm(sel);
    });
    this.preview.prepend(btn);
  };

  private overlaysFor(page: number): Overlay[] {
    const out: Overlay[] = [];
    for (const f of this.findings) if (f.page === page) for (const rect of f.rects) out.push({ id: f.key, kind: 'finding', rect, enabled: f.enabled });
    for (const b of this.boxes) if (b.page === page) out.push({ id: b.id, kind: 'manual', rect: b, enabled: true });
    return out;
  }

  private refreshPreview() {
    const doc = this.doc;
    if (!doc) return;
    if (doc.pages.length) {
      for (const e of this.editors) e.draw();
      return;
    }
    // Text preview: one block per unit with highlighted findings.
    const byUnit = new Map<string, Finding[]>();
    for (const f of this.findings) (byUnit.get(f.unitId) ?? byUnit.set(f.unitId, []).get(f.unitId)!).push(f);
    const blocks = doc.units.map((u) => {
      const el = h('div', { className: 'unit' });
      let pos = 0;
      for (const f of (byUnit.get(u.id) ?? []).sort((a, b) => a.start - b.start)) {
        if (f.start < pos) continue;
        el.append(u.text.slice(pos, f.start));
        const mark = h('mark', { className: f.enabled ? 'on' : 'off', title: `${ENTITY_LABELS[f.type]} · click to ${f.enabled ? 'keep' : 'redact'}`, 'data-key': f.key }, u.text.slice(f.start, f.end));
        mark.addEventListener('click', () => this.toggle([f.key], !f.enabled));
        el.append(mark);
        pos = f.end;
      }
      el.append(u.text.slice(pos));
      return el;
    });
    const MAX = 2000;
    this.preview.replaceChildren(
      h('p', { className: 'hint' }, 'Click a highlight to keep it. Select any text to redact it everywhere.'),
      h('div', { className: 'text-preview' + (doc.kind === 'docx' ? ' docx' : '') }, ...blocks.slice(0, MAX)),
      ...(blocks.length > MAX ? [h('p', { className: 'hint' }, `Preview shows the first ${MAX} paragraphs; the download covers the whole file.`)] : []),
    );
  }

  private async export(skipCheck = false) {
    const doc = this.doc;
    if (!doc || this.busy) return;
    this.busy = true;
    this.download.disabled = true;
    this.warn.hidden = true;
    let checkNote = '';
    try {
      // Ask a second model whether anything sensitive is still readable before handing over the file.
      if (!skipCheck) {
        this.say('Checking the redacted file for anything left…');
        try {
          const left = await checkRemaining(remainingText(doc.units, this.findings, this.boxes));
          if (this.doc !== doc) return;
          if (left.length) return this.warnLeft(left);
        } catch (err) {
          console.warn(err);
          checkNote = ' The final check could not run, so review the file carefully.';
        }
      }
      this.say('Preparing your redacted file…');
      const { blob, filename } = await doc.exportFile(this.findings, this.boxes, this.style);
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: filename });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      const n = this.findings.filter((f) => f.enabled).length + this.boxes.length;
      this.say(`Done. ${n} item${n === 1 ? '' : 's'} redacted in ${filename}.${checkNote || ' Open it and check before sharing.'}`);
    } catch (err) {
      console.error(err);
      this.say(err instanceof Error ? err.message : 'Export failed.', true);
    } finally {
      this.busy = false;
      this.download.disabled = false;
    }
  }

  private warnLeft(left: string[]) {
    const list = left.map((k) => CHECK_LABELS[k]);
    const what = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0];
    this.say('');
    this.warn.replaceChildren(
      h('p', { className: 'warn-text' }, `The final check thinks some ${what} may still be readable. Look through the preview, tick anything that was missed, or select the text and redact it.`),
      h(
        'div',
        { className: 'warn-actions' },
        h('button', { type: 'button', className: 'btn', textContent: 'Keep reviewing', onclick: () => (this.warn.hidden = true) }),
        h('button', { type: 'button', className: 'btn ghost', textContent: 'Download anyway', onclick: () => this.export(true) }),
      ),
    );
    this.warn.hidden = false;
    this.warn.scrollIntoView({ block: 'nearest' });
  }
}

const root = document.getElementById('tool');
if (root) new App(root);
