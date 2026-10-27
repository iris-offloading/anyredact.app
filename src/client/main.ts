import { analyzeUnits, startsTicked } from '../shared/analyze.ts';
import { h } from './dom.ts';
import { ENTITY_LABELS, type EntityType } from '../shared/detect.ts';
import { detectWithAi, freePagesLeft, QuotaError, type AiEntity } from './ai.ts';
import { CHECK_LABELS, checkRemaining, remainingText } from './check.ts';
import { PageEditor, type Overlay } from './editor.ts';
import { audioCredits, CHECK_CREDITS, pagesFor } from '../shared/pricing.ts';
import { highlight, pieces, unitRange } from './highlight.ts';
import { clock, Timeline } from './timeline.ts';
import { isBox, type DocView, type Finding, type Layout, type LoadedDoc, type ManualMark, type MetaField, type Page, type RedactStyle, type SpokenWord, type Unit, type ViewHandlers } from './types.ts';
import { detectVisual, detectVisualAi, mergeHits, VISUAL_LABELS, type VisualHit, type VisualKind } from './visual.ts';

type Kind = LoadedDoc['kind'];

const ACCEPT: Record<Kind | 'all', string> = {
  pdf: '.pdf,application/pdf',
  image: 'image/png,image/jpeg,image/webp,image/heic,image/heif,.png,.jpg,.jpeg,.webp,.heic,.heif',
  docx: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation',
  sheet: '.xlsx,.ods,.csv,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet,text/csv',
  text: '.txt,.md,.csv,.tsv,.json,.jsonl,.ndjson,.log,.xml,.html,.yaml,.yml,.toml,.ini,.cfg,.conf,.properties,.env,text/*,application/json,application/xml',
  audio: 'audio/*,.mp3,.m4a,.wav,.flac,.ogg,.opus,.aac,.weba',
  all: '',
};
ACCEPT.all = [ACCEPT.pdf, ACCEPT.image, ACCEPT.docx, ACCEPT.pptx, ACCEPT.sheet, ACCEPT.text, ACCEPT.audio].join(',');

// What the "Look for" chips offer. AI findings are filtered by these.
const CHIP_TYPES: EntityType[] = ['name', 'address', 'email', 'phone', 'id', 'ssn', 'card', 'iban', 'ip', 'url', 'date', 'org', 'other'];
const DEFAULT_TYPES: EntityType[] = ['name', 'address', 'email', 'phone', 'id', 'ssn', 'date', 'card', 'iban', 'ip', 'other'];
// Picture regions are opt-in: plenty of people want faces left visible.
const VISUAL_KINDS = Object.keys(VISUAL_LABELS) as VisualKind[];
// Each page is one AI request, so very long PDFs only get the local pass after this.
const MAX_AI_PICTURE_PAGES = 30;

const PLUS_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12M6 10l6 6 6-6M4 20h16"/></svg>';
const DOWNLOAD_NAMES: Record<LoadedDoc['kind'], string> = { pdf: 'PDF', image: 'image', docx: 'document', pptx: 'presentation', sheet: 'spreadsheet', text: 'file', audio: 'audio' };

/** Whether the preview shows text: everything except PDF pages and images. */
function hasText(doc: LoadedDoc) {
  return doc.kind === 'text' || isOffice(doc) || doc.kind === 'sheet' || doc.kind === 'audio';
}

/** Word and PowerPoint: pictures inside a laid-out document rather than pages. */
function isOffice(doc: LoadedDoc | null) {
  return doc?.kind === 'docx' || doc?.kind === 'pptx';
}

// Config files are named .env, .env.local or prod.env.
const TEXT_NAME = /\.(txt|md|csv|tsv|jsonl?|ndjson|log|xml|html?|ya?ml|toml|ini|cfg|conf|properties)$|(^|\.)env(\.[\w-]+)?$/;

function kindOf(file: File): Kind | null {
  const n = file.name.toLowerCase();
  if (file.type === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (/^image\/(png|jpeg|webp|heic|heif)$/.test(file.type) || /\.(png|jpe?g|webp|heic|heif)$/.test(n)) return 'image';
  if (n.endsWith('.docx')) return 'docx';
  if (n.endsWith('.pptx')) return 'pptx';
  if (/\.(xlsx|ods)$/.test(n)) return 'sheet';
  if (file.type.startsWith('audio/') || /\.(mp3|m4a|wav|flac|ogg|opus|aac|weba)$/.test(n)) return 'audio';
  if (/\.(doc|xls|ppt)$/.test(n)) return null;
  if (file.type.startsWith('text/') || /^application\/(json|xml)$/.test(file.type) || TEXT_NAME.test(n) || !file.type) return 'text';
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
    case 'pptx':
      return (await import('./formats/pptx.ts')).loadPptx(file, progress);
    case 'sheet':
      return (await import('./formats/sheet.ts')).loadSheet(file, progress);
    case 'text':
      return (await import('./formats/text.ts')).loadText(file);
    case 'audio':
      return (await import('./formats/audio.ts')).loadAudio(file, progress);
    default:
      throw new Error('This file type is not supported yet. Try PDF, PNG, JPG, WebP, HEIC, DOCX, PPTX, XLSX, ODS, a text file or audio. Old .doc, .ppt and .xls files need to be saved as .docx, .pptx or .xlsx first.');
  }
}

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
  private boxes: ManualMark[] = [];
  // Text the user selected and redacted in that one spot only.
  private picks: { unitId: string; start: number; end: number }[] = [];
  private aiEntities: AiEntity[] | null = null;
  private overrides = new Map<string, boolean>();
  private editors: PageEditor[] = [];
  private focused: string | null = null;
  // Word pages or PowerPoint slides as laid out, when the layout worked.
  private sheet: HTMLElement | null = null;
  private layout: Layout | null = null;
  private view: DocView | null = null;
  // Text units the custom view has no place for, such as spreadsheet comments.
  private extras = h('div');
  private timeline: Timeline | null = null;
  // Where the text preview or transcript is drawn, below the timeline for audio.
  private textHost = h('div');
  /** The spreadsheet's cell bar and the cell it shows. */
  private cellBar: HTMLElement | null = null;
  private cell: Parameters<ViewHandlers['cell']>[0] | null = null;
  // Transcript words in the order they are said, with the spans that show each one.
  private spoken: { word: SpokenWord; els: HTMLElement[] }[] = [];
  private speaking: HTMLElement[] = [];
  // The redaction bar around the word being said, outlined.
  private saying: HTMLElement | null = null;
  // The word last clicked, by its place in `spoken`.
  private pinned: number | null = null;
  private transcribing: Promise<void> | null = null;
  private detecting: ReturnType<typeof detectWithAi> | null = null;
  private aiError: string | null = null;
  // Nothing leaves the browser until the user presses Upload for this file.
  private consent: 'ask' | 'yes' = 'ask';
  private consentBox: HTMLElement;
  private types = new Set<EntityType>(DEFAULT_TYPES);
  // Business and public-service contacts start ticked too.
  private redactPublic = store.get('redact-public') === '1';
  private terms = '';
  private visualKinds = new Set<VisualKind>();
  // Per page, and the kinds they were computed for.
  // Hits found so far per page, and the kinds already looked for, so ticking
  // another kind only looks for that one and unticking needs no new pass.
  private visualLocal = pictureCache();
  private visualAi = pictureCache();
  // Picture passes run one at a time, so a second analyze() sees the first one's results.
  private pictureQueue: Promise<unknown> = Promise.resolve();
  private visualError: string | null = null;
  private pictureBox: HTMLElement;
  private style: RedactStyle = 'block';
  private busy = false;

  private intake: HTMLElement;
  private status: HTMLElement;
  private docBar: HTMLElement;
  private docType: HTMLElement;
  private panelBody: HTMLElement;
  private workspace: HTMLElement;
  private list: HTMLElement;
  private preview: HTMLElement;
  private notes: HTMLElement;
  private metaBox: HTMLElement;
  private docName: HTMLElement;
  private download: HTMLButtonElement;
  private transcriptBtn: HTMLButtonElement;
  private warn: HTMLElement;
  private checkBox: HTMLInputElement;
  /** The current scan's free final check, until it is used. */
  private checkToken: string | undefined;
  private checkRow: HTMLElement;
  private styleRow: HTMLElement;
  private styleSel: HTMLSelectElement;
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
      h('span', {
        className: 'drop-icon',
        'aria-hidden': 'true',
        innerHTML: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M6 10l6-6 6 6M4 20h16"/></svg>',
      }),
      h('span', { className: 'drop-title' }, h('u', {}, 'Choose a file'), h('span', { className: 'drop-here' }, ' or drop it here')),
      h('span', { className: 'drop-or' }, 'or paste with ', h('kbd', {}, /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'), ' ', h('kbd', {}, 'V')),
      h('span', { className: 'drop-sub' }, root.dataset.hint || 'PDF, Word (DOCX), PowerPoint (PPTX), Excel (XLSX), ODS, PNG, JPG, WebP, HEIC, text or audio'),
    );
    for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => (e.preventDefault(), drop.classList.add('over')));
    for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = (e as DragEvent).dataTransfer?.files[0];
      if (f) this.open(f);
    });

    // Phones have no paste shortcut, so they get a box to paste into; so does the text page.
    const pasteArea = h('textarea', { rows: 3, id: 'paste-text' });
    const pasteText = (text: string) => text.trim() && this.open(new File([text], 'pasted-text.txt', { type: 'text/plain' }));
    const paste = h(
      'div',
      { className: 'paste' + (format === 'text' ? ' always' : '') },
      h('label', { for: 'paste-text' }, 'Or paste text'),
      pasteArea,
      h('button', { type: 'button', className: 'btn', textContent: 'Find personal info', onclick: () => pasteText(pasteArea.value) }),
    );

    this.intake = h('div', { className: 'intake' }, drop, ...(format === 'text' || format === 'all' ? [paste] : []));
    this.status = h('div', { className: 'status', role: 'status', 'aria-live': 'polite', hidden: true });

    // Workspace: side panel + preview. The file's name and the New file button go in the site header.
    this.docName = h('strong', { className: 'doc-name' });
    this.docType = h('span', { className: 'doc-type' });
    const reset = h('button', { type: 'button', className: 'btn ghost', innerHTML: `${PLUS_ICON}New file`, onclick: () => this.reset() });
    this.docBar = h('div', { className: 'doc-bar' }, this.docType, this.docName, reset);
    document.querySelector('.site-header .logo')?.after(this.docBar);

    const typeBoxes = h('div', { className: 'types' });
    for (const t of CHIP_TYPES) {
      const cb = h('input', { type: 'checkbox', checked: this.types.has(t) });
      cb.addEventListener('change', () => {
        cb.checked ? this.types.add(t) : this.types.delete(t);
        this.analyze();
      });
      typeBoxes.append(h('label', { className: 'chip' }, cb, ENTITY_LABELS[t]));
    }

    const saved = (store.get('picture-kinds') || '').split(',');
    for (const k of VISUAL_KINDS) if (saved.includes(k)) this.visualKinds.add(k);
    const pictureChips = h('div', { className: 'types' });
    for (const k of VISUAL_KINDS) {
      const cb = h('input', { type: 'checkbox', checked: this.visualKinds.has(k) });
      cb.addEventListener('change', () => {
        cb.checked ? this.visualKinds.add(k) : this.visualKinds.delete(k);
        store.set('picture-kinds', [...this.visualKinds].join(','));
        this.analyze();
      });
      pictureChips.append(h('label', { className: 'chip' }, cb, VISUAL_LABELS[k]));
    }
    this.pictureBox = h(
      'div',
      { hidden: true },
      h('h3', {}, 'In pictures'),
      pictureChips,
    );

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

    this.styleSel = h('select', { 'aria-label': 'Redaction style' });
    this.styleSel.addEventListener('change', () => (this.style = this.styleSel.value as RedactStyle));
    this.styleRow = h('label', { className: 'row style-row' }, 'Style ', this.styleSel);

    this.download = h('button', { type: 'button', className: 'btn primary', onclick: () => this.export() });
    this.setDownloadLabel('file');
    this.transcriptBtn = h('button', { type: 'button', className: 'btn transcript', textContent: 'Download redacted transcript', hidden: true, onclick: () => this.export(false, true) });
    this.warn = h('div', { className: 'status error warn', role: 'alert', hidden: true });
    // Each scan's first final check is free and starts ticked; later ones cost credits and start unticked.
    this.checkBox = h('input', { type: 'checkbox', checked: true });
    this.checkRow = h('label', { className: 'row check-row', hidden: true });
    this.setFreeCheck(undefined);
    this.list = h('div', { className: 'findings' });
    this.notes = h('ul', { className: 'notes' });
    this.metaBox = h('div', { className: 'meta', hidden: true });
    this.consentBox = h('div', { className: 'consent', hidden: true });

    // The body scrolls on its own so the download button stays in view at the foot of the panel.
    this.panelBody = h(
      'div',
      { className: 'panel-body' },
      this.consentBox,
        h('h3', {}, 'Found'),
        this.list,
        h('h3', {}, 'Look for'),
        typeBoxes,
        this.pictureBox,
        h('h3', {}, 'Always redact'),
        termsArea,
      this.metaBox,
      this.notes,
    );
    const panel = h(
      'aside',
      { className: 'panel', id: 'review-panel', 'aria-label': 'Review' },
      this.panelBody,
      h('div', { className: 'panel-foot' }, this.styleRow, this.checkRow, this.download, this.transcriptBtn, this.warn),
    );
    this.preview = h('div', { className: 'preview' });
    const legend = h(
      'div',
      { className: 'preview-bar' },
      h('span', { className: 'key' }, h('span', { className: 'swatch on' }), 'Redacted'),
      h('span', { className: 'key' }, h('span', { className: 'swatch off' }), 'Kept'),
    );
    const stage = h('div', { className: 'stage', id: 'preview-stage' }, legend, this.preview);
    // Phones show the preview or the findings, one at a time.
    const tab = (label: string, view: 'preview' | 'found', controls: string) => {
      const b = h('button', { type: 'button', role: 'tab', textContent: label, 'aria-controls': controls, onclick: () => this.showTab(view) });
      b.dataset.view = view;
      return b;
    };
    this.tabs = h('div', { className: 'tabs', role: 'tablist', 'aria-label': 'Editor view' }, tab('Preview', 'preview', 'preview-stage'), tab('Found', 'found', 'review-panel'));
    this.workspace = h('div', { className: 'workspace', hidden: true }, this.tabs, panel, stage);
    this.showTab('preview');

    root.append(this.intake, this.status, this.workspace);
    document.addEventListener('paste', (e) => {
      if (this.doc || (e.target as HTMLElement)?.closest?.('textarea,input')) return;
      const f = e.clipboardData?.files[0];
      if (f) this.open(f);
      else if (format === 'text' || format === 'all') pasteText(e.clipboardData?.getData('text/plain') ?? '');
    });
  }

  private addTerm: (t: string) => void = () => {};
  private tabs: HTMLElement;

  private showTab(view: 'preview' | 'found') {
    this.workspace.dataset.view = view;
    for (const b of this.tabs.children) b.setAttribute('aria-selected', String((b as HTMLElement).dataset.view === view));
  }

  private setDownloadLabel(what: string) {
    this.download.replaceChildren(h('span', { className: 'btn-icon', 'aria-hidden': 'true', innerHTML: DOWNLOAD_ICON }), `Download redacted ${what}`);
  }

  /** Shows the status at the top of the panel while a file is open, or above the download button while exporting. */
  private say(msg: string, error = false, nearDownload = false) {
    if (this.workspace.hidden) this.intake.after(this.status);
    else if (nearDownload) this.download.before(this.status);
    else this.panelBody.prepend(this.status);
    // Progress messages carry an ellipsis and get a spinner.
    this.status.classList.toggle('busy', !error && msg.includes('…'));
    this.status.hidden = !msg;
    this.status.textContent = msg;
    this.status.classList.toggle('error', error);
  }

  async open(file: File) {
    if (this.busy) return;
    // Audio is read in pieces, so only its length is capped (in formats/audio.ts).
    if (kindOf(file) !== 'audio' && file.size > 100 * 1024 * 1024) return this.say('That file is over 100 MB, which is too large to process in the browser.', true);
    this.busy = true;
    this.reset(false);
    this.say(`Opening ${file.name}…`);
    try {
      this.doc = await load(file, (m) => this.say(m));
      this.docName.textContent = file.name;
      const styles = this.doc.styles ?? [];
      this.styleRow.hidden = !styles.length;
      this.transcriptBtn.hidden = !this.doc.exportTranscript;
      this.setDownloadLabel(DOWNLOAD_NAMES[this.doc.kind]);
      this.docType.textContent = (file.name.match(/\.(\w{1,5})$/)?.[1] ?? this.doc.kind).toUpperCase();
      this.styleSel.replaceChildren(...styles.map(([value, textContent]) => h('option', { value, textContent })));
      this.style = styles[0]?.[0] ?? 'block';
      this.pictureBox.hidden = !this.doc.pages.length;
      this.notes.replaceChildren(...this.doc.notes.map((n) => h('li', {}, n)));
      this.renderMetadata(this.doc.metadata);
      if (this.doc.render) await this.layOut(this.doc);
      this.intake.hidden = true;
      this.workspace.hidden = false;
      this.showTab('preview');
      document.body.classList.add('editing');
      await this.renderPreview();
      if (this.doc !== null) await this.analyze();
    } catch (err) {
      console.error(err);
      this.reset(false);
      this.say(err instanceof Error ? err.message : 'Could not open that file.', true);
    } finally {
      this.busy = false;
      this.fileInput.value = '';
    }
  }

  reset(clearStatus = true) {
    this.doc?.dispose?.();
    this.doc = null;
    this.timeline = null;
    this.transcribing = null;
    this.detecting = null;
    this.findings = [];
    this.boxes = [];
    this.picks = [];
    this.aiEntities = null;
    this.aiError = null;
    this.visualLocal = pictureCache();
    this.visualAi = pictureCache();
    this.visualError = null;
    this.consent = 'ask';
    this.consentBox.hidden = true;
    this.checkRow.hidden = true;
    this.setFreeCheck(undefined);
    this.overrides.clear();
    this.editors = [];
    this.sheet = null;
    this.layout = null;
    this.view?.dispose();
    this.view = null;
    this.preview.replaceChildren();
    this.list.replaceChildren();
    this.metaBox.hidden = true;
    this.workspace.hidden = true;
    this.intake.hidden = false;
    document.body.classList.remove('editing');
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

    // Ask the model once per document, and only after the user agreed to send the text.
    if (this.consent === 'ask') this.askConsent(doc);
    if (this.consent === 'yes' && doc.transcribe && !this.aiError) {
      // Chips and terms re-run analyze() while a long transcription is in flight: share it, don't start another.
      try {
        await (this.transcribing ??= doc.transcribe((m) => this.say(m)));
      } catch (err) {
        if (this.doc === doc) this.aiError = aiFailure(err, 'Transcription failed.');
      }
      if (this.doc !== doc) return;
    }
    if (this.consent === 'yes' && !this.aiEntities && !this.aiError) {
      const text = doc.units.map((u) => u.text).join('\n\n');
      if (text.trim()) {
        this.say('Finding names, addresses and other personal details…');
        try {
          const { entities, checkToken } = await (this.detecting ??= detectWithAi(text));
          if (this.doc === doc) {
            this.aiEntities = entities;
            this.setFreeCheck(checkToken);
          }
        } catch (err) {
          if (this.doc === doc) this.aiError = aiFailure(err, 'AI detection failed.');
        }
      }
      if (this.doc !== doc) return;
    }

    const byId = new Map(doc.units.map((u) => [u.id, u]));
    const spans = analyzeUnits(doc.units, { terms, ai: this.aiEntities }).filter((s) => s.type === 'custom' || this.types.has(s.type));
    const finding = (unit: Unit, key: string, start: number, end: number, type: EntityType, defaultOn: boolean, publicHint?: string): Finding => ({
      key,
      unitId: unit.id,
      start,
      end,
      type,
      text: unit.text.slice(start, end),
      enabled: this.overrides.get(key) ?? defaultOn,
      publicHint,
      page: unit.page,
      rects: unit.rectsFor?.(start, end) ?? [],
      times: unit.timesFor?.(start, end) ?? undefined,
    });
    const findings = spans.map((s) => finding(byId.get(s.unitId)!, `${s.unitId}:${s.start}:${s.end}`, s.start, s.end, s.type, startsTicked(s, this.redactPublic), s.publicHint));
    for (const p of this.picks) findings.push(finding(byId.get(p.unitId)!, `pick:${p.unitId}:${p.start}:${p.end}`, p.start, p.end, 'custom', true));
    const pictures = await this.pictureFindings(doc);
    if (this.doc !== doc) return;
    this.findings = [...findings, ...pictures];
    this.warn.hidden = true;
    // Without the AI the list is empty and says how to redact by hand.
    if (this.aiError) this.say(this.aiError, true);
    else if (this.visualError) this.say(this.visualError, true);
    else this.say('');
    this.renderList();
    this.refreshPreview();
  }

  /** Faces, screens, signs and plates on page bitmaps, when the visitor ticked any. */
  private pictureFindings(doc: LoadedDoc): Promise<Finding[]> {
    const run = this.pictureQueue.then(() => this.findPictures(doc));
    this.pictureQueue = run.catch(() => {});
    return run;
  }

  private async findPictures(doc: LoadedDoc): Promise<Finding[]> {
    const kinds = new Set(this.visualKinds);
    // A queued pass for a file that has since been replaced must not fill the new file's caches.
    if (this.doc !== doc) return [];
    this.visualError = null;
    if (!kinds.size || !doc.pages.length) return [];
    const local = missingKinds(this.visualLocal, kinds);
    if (local.size) {
      this.say('Looking for faces and screens on this device…');
      try {
        const found: VisualHit[][] = [];
        for (const p of doc.pages) found[p.index] = await detectVisual(p.canvas, local);
        if (this.doc !== doc) return [];
        addHits(this.visualLocal, local, found);
      } catch (err) {
        console.warn(err);
        this.visualError = 'The on-device picture detector could not start in this browser.';
      }
    }
    const ai = this.consent === 'yes' ? missingKinds(this.visualAi, kinds) : new Set<VisualKind>();
    if (ai.size) {
      const pages = doc.pages.slice(0, MAX_AI_PICTURE_PAGES);
      try {
        const found: VisualHit[][] = [];
        for (const p of pages) {
          this.say(pages.length > 1 ? `Checking pictures with AI… page ${p.index + 1} of ${pages.length}` : 'Checking the picture with AI…');
          found[p.index] = await detectVisualAi(p.canvas, ai);
          if (this.doc !== doc) return [];
        }
        addHits(this.visualAi, ai, found);
      } catch (err) {
        console.warn(err);
        this.visualError = `${err instanceof Error ? err.message : 'Picture detection failed.'} Showing what this device found; review the pictures carefully.`;
      }
    }
    const out: Finding[] = [];
    const counts = new Map<VisualKind, number>();
    for (const p of doc.pages) {
      const merged = mergeHits([...(this.visualLocal.hits[p.index] ?? []), ...(this.consent === 'yes' ? (this.visualAi.hits[p.index] ?? []) : [])]);
      for (const hit of merged.filter((x) => kinds.has(x.kind)).sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)) {
        const n = (counts.get(hit.kind) ?? 0) + 1;
        counts.set(hit.kind, n);
        const key = `picture:${p.index}:${hit.kind}:${Math.round(hit.rect.x)}:${Math.round(hit.rect.y)}`;
        out.push({
          key,
          unitId: 'pictures',
          start: 0,
          end: 0,
          type: hit.kind,
          text: `${ENTITY_LABELS[hit.kind]} ${n}`,
          enabled: this.overrides.get(key) ?? true,
          page: p.index,
          rects: [hit.rect],
        });
      }
    }
    return out;
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
      this.list.replaceChildren(
        h('p', { className: 'empty' }, visual ? 'Nothing detected yet. Drag on the preview to draw boxes, or add words below.' : this.doc?.audio ? 'Nothing detected. Drag on the timeline to bleep a stretch.' : 'Nothing detected. Add words below, or select text in the preview to redact it.'),
      );
      return;
    }
    const out: HTMLElement[] = [];
    const publicKeys = this.findings.filter((f) => f.publicHint).map((f) => f.key);
    if (publicKeys.length) {
      const cb = h('input', { type: 'checkbox', checked: this.redactPublic });
      cb.addEventListener('change', () => {
        this.redactPublic = cb.checked;
        store.set('redact-public', cb.checked ? '1' : '0');
        this.toggle(publicKeys, cb.checked);
      });
      out.push(h('label', { className: 'public-pref' }, cb, 'Redact company and public contacts'));
    }
    for (const [type, items] of groups) {
      const on = items.filter((f) => f.enabled).length;
      const all = h('input', { type: 'checkbox', checked: on === items.length, indeterminate: on > 0 && on < items.length });
      all.addEventListener('change', () => this.toggle(items.map((f) => f.key), all.checked));
      const rows = items.map((f) => {
        const cb = h('input', { type: 'checkbox', checked: f.enabled });
        cb.addEventListener('change', () => this.toggle([f.key], cb.checked));
        const label = f.text.length > 48 ? f.text.slice(0, 46) + '…' : f.text;
        const where = f.times ? clock(f.times[0]) : f.page !== undefined && (this.doc?.pages.length ?? 0) > 1 ? (isOffice(this.doc) ? `picture ${f.page + 1}` : `p${f.page + 1}`) : '';
        const tag = [f.publicHint ? 'public?' : '', where].filter(Boolean).join(', ');
        const row = h('label', { className: 'finding' + (f.enabled ? '' : ' off') }, cb, h('span', { className: 'ftext' }, label), h('small', { title: f.publicHint ?? '' }, tag));
        // Only a moving mouse: mouseenter also fires when the list scrolls under a still pointer, and a tap fires it too, so the page jumped.
        row.addEventListener('pointermove', (e) => e.pointerType === 'mouse' && this.focus(f));
        row.addEventListener('pointerleave', () => (this.focused = null));
        return row;
      });
      out.push(h('details', { className: 'group', open: items.length <= 12 }, h('summary', {}, all, ` ${ENTITY_LABELS[type]} `, h('span', { className: 'count' }, `${on}/${items.length}`)), ...rows));
    }
    if (manual && this.timeline) {
      out.push(h('p', { className: 'manual-count' }, `${manual} stretch${manual > 1 ? 'es' : ''} picked on the timeline. Click one to remove it.`));
    } else if (manual) {
      out.push(h('p', { className: 'manual-count' }, `${manual} hand-drawn box${manual > 1 ? 'es' : ''}. Click a box on the preview to remove it.`));
    }
    this.list.replaceChildren(...out);
  }

  private renderMetadata(fields: MetaField[] | undefined) {
    this.metaBox.hidden = !fields;
    if (!fields) return;
    const dl = (rows: MetaField[]) => h('dl', {}, ...rows.flatMap((f) => [h('dt', {}, f.label), h('dd', {}, f.value)]));
    const key = fields.filter((f) => f.key);
    const rest = fields.filter((f) => !f.key);
    const body: HTMLElement[] = [];
    if (!fields.length) body.push(h('p', { className: 'empty' }, 'None found.'));
    else {
      body.push(dl(key.length ? key : rest));
      if (key.length && rest.length) body.push(h('details', {}, h('summary', {}, 'More fields'), dl(rest)));
    }
    this.metaBox.replaceChildren(h('h3', {}, 'Metadata'), ...body);
  }

  private focus(f: Finding) {
    if (this.focused === f.key) return;
    this.focused = f.key;
    if (this.view?.reveal(f)) return;
    const el = this.preview.querySelector<HTMLElement>(`[data-key="${CSS.escape(f.key)}"]`) ?? (f.page !== undefined ? this.editors[f.page]?.el : null);
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  private async layOut(doc: LoadedDoc) {
    this.say('Laying out pages…');
    const sheet = h('div', { className: 'sheet' });
    try {
      this.layout = await doc.render!(sheet);
    } catch (err) {
      // The plain text view still covers every paragraph.
      console.warn(err);
      return;
    }
    this.sheet = sheet;
    // Highlights sit inside links; clicking one toggles it rather than leaving the page.
    sheet.addEventListener('click', (e) => (e.target as Element).closest('a') && e.preventDefault());
    this.sheetResize ??= new ResizeObserver(() => this.fitSheet());
    this.sheetResize.observe(this.preview);
  }

  private sheetResize?: ResizeObserver;

  /** Scales the pages down to the preview width, as on a phone. */
  private fitSheet() {
    const sheet = this.sheet;
    if (!sheet?.isConnected) return;
    sheet.style.zoom = '';
    // Pages wider than the column overflow on both sides, so measure the pages rather than the scroll width.
    const widest = Math.max(sheet.scrollWidth, ...Array.from(sheet.querySelectorAll<HTMLElement>('section.docx, .slide'), (s) => s.offsetWidth));
    const ratio = this.preview.clientWidth / widest;
    if (ratio < 1) sheet.style.zoom = String(ratio);
  }

  private async renderPreview() {
    const doc = this.doc!;
    if (doc.mountView) {
      const host = h('div', { className: 'sheet-view' });
      this.extras = h('div');
      // Like Excel's formula bar: the selected cell's whole text, which the grid can cut off.
      this.cellBar = h('div', { className: 'cell-bar' });
      this.cell = null;
      this.textHost = h('div', {}, this.cellBar);
      this.preview.replaceChildren(h('p', { className: 'hint' }, 'Click a highlight to redact or keep it. Select a cell or its text to add more.'), this.textHost, host, this.extras);
      // The grid reports its own selection; text selection applies to the cell bar and the list under the grid.
      for (const el of [this.textHost, this.extras]) {
        el.addEventListener('mouseup', this.onSelect);
        el.addEventListener('touchend', (e) => setTimeout(() => this.onSelect(e), 300));
      }
      this.drawCellBar();
      const view = await doc.mountView(host, {
        toggle: (keys, on) => this.toggle(keys, on),
        cell: (c) => {
          this.cell = c;
          this.drawCellBar();
          // Selecting a cell without highlights offers to redact its text.
          const s = c.spot;
          const pick = s && !this.findings.some((f) => f.unitId === s.unitId && f.start < s.end && f.end > s.start) ? s : null;
          this.offerPicks(pick ? [pick] : [], pick ? doc.units.find((u) => u.id === pick.unitId)!.text.slice(pick.start, pick.end) : '');
        },
      });
      if (this.doc !== doc) return view.dispose();
      this.view = view;
      this.refreshPreview();
      return;
    }
    this.cellBar = null;
    this.editors = doc.pages.map((page) => this.pageEditor(page));
    // Pictures in a Word or PowerPoint file show at their own size rather than full width.
    if (isOffice(doc)) this.editors.forEach((e, i) => (e.el.style.maxWidth = `${doc.pages[i].canvas.width}px`));
    // On laid-out pages the editor takes the picture's place and size; a picture used twice gets a second editor.
    for (const { page, img } of this.layout?.pictures ?? []) {
      let editor = this.editors[page];
      if (editor.el.classList.contains('placed')) {
        editor = this.pageEditor(doc.pages[page]);
        this.editors.push(editor);
      }
      editor.el.style.cssText = img.style.cssText;
      editor.el.classList.add('placed');
      img.replaceWith(editor.el);
    }
    if (doc.audio) {
      this.timeline = new Timeline({
        ...doc.audio,
        stretches: () => [
          ...this.findings.filter((f) => f.times).map((f) => ({ id: f.key, kind: 'finding' as const, start: f.times![0], end: f.times![1], enabled: f.enabled })),
          ...this.boxes.flatMap((b) => (isBox(b) ? [] : [{ id: b.id, kind: 'manual' as const, start: b.times[0], end: b.times[1], enabled: true }])),
        ],
        onDraw: (start, end) => this.setMarks([...this.boxes, { id: crypto.randomUUID(), times: [start, end] }]),
        onClick: (s) => (s.kind === 'manual' ? this.setMarks(this.boxes.filter((b) => b.id !== s.id)) : this.toggle([s.id], !s.enabled)),
        onTime: (t) => this.follow(t),
      });
    }
    this.preview.replaceChildren();
    if (hasText(doc)) {
      // The player stays put while the text below it is redrawn, so playback is not interrupted.
      this.textHost = h('div');
      this.textHost.addEventListener('mouseup', this.onSelect);
      this.textHost.addEventListener('touchend', (e) => setTimeout(() => this.onSelect(e), 300));
      // A click on a spoken word moves the player there; a click on a highlight still toggles it.
      this.textHost.addEventListener('click', (e) => {
        const w = (e.target as Element).closest<HTMLElement>('.w');
        if (!w || w.closest('mark') || getSelection()?.isCollapsed === false) return;
        this.pinned = Number(w.dataset.w);
        this.timeline?.seek(Number(w.dataset.t));
      });
      // Hovering a word marks its place on the timeline.
      this.textHost.addEventListener('mouseover', (e) => {
        const w = (e.target as Element).closest<HTMLElement>('.w');
        this.timeline?.point(w ? Number(w.dataset.t) : null);
      });
      this.textHost.addEventListener('mouseleave', () => this.timeline?.point(null));
      this.preview.replaceChildren(...(this.timeline ? [this.timeline.el] : []), this.textHost);
    }
    this.refreshPreview();
  }

  private drawCellBar() {
    const bar = this.cellBar;
    const c = this.cell;
    if (!bar || !this.doc) return;
    const ref = h('span', { className: 'cell-ref' }, c?.label ?? '');
    const spot = c?.spot;
    const index = spot ? this.doc.units.findIndex((u) => u.id === spot.unitId) : -1;
    if (!spot || index < 0) return bar.replaceChildren(ref, h('div', { className: 'cell-text' }));
    const { unitId, start, end } = spot;
    const text = this.doc.units[index].text.slice(start, end);
    const spans = this.findings
      .filter((f) => f.unitId === unitId && f.start < end && f.end > start)
      .map((f) => ({ ...f, start: Math.max(f.start, start) - start, end: Math.min(f.end, end) - start }));
    const el = h('div', { className: 'unit cell-text', 'data-unit': String(index), 'data-from': String(start) });
    for (const p of pieces(text.length, spans)) el.append(p.top ? this.mark(p.top, text.slice(p.start, p.end)) : text.slice(p.start, p.end));
    bar.replaceChildren(ref, el);
  }

  private pageEditor(page: Page) {
    return new PageEditor({
      page,
      overlays: () => this.overlaysFor(page.index),
      onDraw: (rect) => this.setMarks([...this.boxes, { ...rect, page: page.index, id: crypto.randomUUID() }]),
      onClick: (o) => {
        if (o.kind === 'manual') return this.setMarks(this.boxes.filter((b) => b.id !== o.id));
        const f = this.findings.find((x) => x.key === o.id);
        if (f) this.toggle([f.key], !f.enabled);
      },
    });
  }

  private setMarks(marks: ManualMark[]) {
    this.boxes = marks;
    this.renderList();
    this.refreshPreview();
  }

  private onSelect = (e?: Event) => {
    if ((e?.target as Element | null)?.closest?.('.sel-add')) return;
    const range = getSelection()?.rangeCount ? getSelection()!.getRangeAt(0) : null;
    const sel = range?.toString().trim();
    this.preview.querySelector('.sel-add')?.remove();
    if (!range || !sel || sel.length < 2 || sel.length > 200 || !this.doc || !hasText(this.doc)) return;
    this.offerPicks(this.selectedSpans(range), sel);
  };

  /** Offers to redact a selection at this spot only, or every match of its text. */
  private offerPicks(picks: { unitId: string; start: number; end: number }[], sel: string) {
    this.preview.querySelector('.sel-add')?.remove();
    if (!picks.length || sel.trim().length < 2) return;
    const done = (fn: () => void) => () => {
      getSelection()?.removeAllRanges();
      this.preview.querySelector('.sel-add')?.remove();
      fn();
    };
    this.textHost.append(
      h(
        'div',
        { className: 'sel-add' },
        h('button', { type: 'button', className: 'btn primary', textContent: 'Redact here', onclick: done(() => this.addPicks(picks)) }),
        h('button', { type: 'button', className: 'btn', textContent: 'Redact everywhere', onclick: done(() => this.addTerm(sel.trim())) }),
      ),
    );
  }

  /** Character ranges of the selection in each text unit it touches, without surrounding spaces. */
  private selectedSpans(range: Range) {
    const units = this.doc!.units;
    const out: { unitId: string; start: number; end: number }[] = [];
    for (const el of this.preview.querySelectorAll<HTMLElement>('.unit')) {
      if (!range.intersectsNode(el)) continue;
      const unit = units[Number(el.dataset.unit)];
      const offset = (node: Node, at: number) => {
        const r = document.createRange();
        r.setStart(el, 0);
        r.setEnd(node, at);
        return r.toString().length;
      };
      // The cell bar shows part of a unit, from data-from on.
      const from = Number(el.dataset.from ?? 0);
      let start = from + (el.contains(range.startContainer) ? offset(range.startContainer, range.startOffset) : 0);
      let end = el.contains(range.endContainer) ? from + offset(range.endContainer, range.endOffset) : from + el.textContent!.length;
      while (start < end && /\s/.test(unit.text[start])) start++;
      while (end > start && /\s/.test(unit.text[end - 1])) end--;
      if (end > start) out.push({ unitId: unit.id, start, end });
    }
    for (const [unitId, blocks] of this.layout?.blocks ?? []) {
      const unit = units.find((u) => u.id === unitId)!;
      for (const block of blocks) {
        const span = range.intersectsNode(block) && unitRange(block, unit.text, range);
        if (span) out.push({ unitId, ...span });
      }
    }
    return out;
  }

  private addPicks(picks: { unitId: string; start: number; end: number }[]) {
    for (const p of picks) {
      this.overrides.delete(`pick:${p.unitId}:${p.start}:${p.end}`);
      if (!this.picks.some((x) => x.unitId === p.unitId && x.start === p.start && x.end === p.end)) this.picks.push(p);
    }
    this.analyze();
  }

  private overlaysFor(page: number): Overlay[] {
    const out: Overlay[] = [];
    for (const f of this.findings) if (f.page === page) for (const rect of f.rects) out.push({ id: f.key, kind: 'finding', rect, enabled: f.enabled });
    for (const b of this.boxes) if (isBox(b) && b.page === page) out.push({ id: b.id, kind: 'manual', rect: b, enabled: true });
    return out;
  }

  private refreshPreview() {
    const doc = this.doc;
    if (!doc) return;
    for (const e of this.editors) e.draw();
    this.timeline?.draw();
    const loose = this.editors.filter((e) => !e.el.classList.contains('placed'));
    const pictures = loose.length
      ? [h('p', { className: 'hint' }, isOffice(doc) ? 'Drag on a picture to add a box. Click a box to turn it off or remove it.' : 'Drag on a page to add a box. Click a box to turn it off or remove it.'), ...loose.map((e) => e.el)]
      : [];
    if (!hasText(doc)) {
      if (!this.preview.childElementCount) this.preview.replaceChildren(...pictures);
      return;
    }
    this.view?.update(this.findings);
    this.drawCellBar();
    // Text preview: one block per unit with highlighted findings. Text read from pictures shows on the pictures.
    // Spreadsheet cells show in the grid above, so only comments, headers and footers are listed here.
    const byUnit = new Map<string, Finding[]>();
    for (const f of this.findings) (byUnit.get(f.unitId) ?? byUnit.set(f.unitId, []).get(f.unitId)!).push(f);
    const { sheet, layout } = this;
    if (sheet && layout) return this.refreshSheet(sheet, layout, byUnit, pictures);
    let section: string | undefined;
    let said = 0;
    const blocks = doc.units.flatMap((u, i) => {
      if (u.page !== undefined || doc.gridUnits?.has(u.id) || (u.quiet && !byUnit.has(u.id))) return [];
      const heading = u.section !== undefined && u.section !== section ? [h('h3', { className: 'unit-section' }, u.section)] : [];
      section = u.section;
      const el = this.unitBlock(u, i, byUnit.get(u.id) ?? [], said);
      said += u.words?.length ?? 0;
      const start = u.words?.[0]?.start;
      if (start === undefined) return [...heading, el];
      // The paragraph's time sits beside the text, so selections inside the text keep their offsets.
      return [...heading, h('div', { className: 'para' }, h('button', { type: 'button', className: 'at', textContent: clock(start), onclick: () => this.timeline?.seek(start, true) }), el)];
    });
    const MAX = 2000;
    if (doc.audio && !doc.units.length) {
      this.textHost.replaceChildren(h('p', { className: 'hint' }, 'Drag on the timeline to bleep a stretch.'));
      return;
    }
    const text = [
      h('div', { className: 'text-preview' + (isOffice(doc) || doc.kind === 'audio' ? ' flow' : '') }, ...blocks.slice(0, MAX)),
      ...(blocks.length > MAX ? [h('p', { className: 'hint' }, `Preview shows the first ${MAX} paragraphs; the download covers the whole file.`)] : []),
    ];
    if (doc.mountView) this.extras.replaceChildren(...(blocks.length ? text : []));
    else this.textHost.replaceChildren(h('p', { className: 'hint' }, doc.audio ? 'Click a word to jump there, or a highlight to keep it. Select words to bleep them.' : 'Click a highlight to redact or keep it. Select text to add more.'), ...text, ...pictures);
    if (!this.timeline) return;
    const els = new Map<string, HTMLElement[]>();
    for (const el of this.textHost.querySelectorAll<HTMLElement>('.w')) (els.get(el.dataset.w!) ?? els.set(el.dataset.w!, []).get(el.dataset.w!)!).push(el);
    this.spoken = doc.units.flatMap((u) => u.words ?? []).map((word, i) => ({ word, els: els.get(String(i)) ?? [] }));
    this.speaking = [];
    this.saying = null;
    this.pinned = null;
    this.follow(this.timeline.player.currentTime);
  }

  private mark(f: Finding, ...content: (string | Node)[]) {
    const mark = h('mark', { className: f.enabled ? 'on' : 'off', title: `${ENTITY_LABELS[f.type]}, click to ${f.enabled ? 'keep' : 'redact'}`, 'data-key': f.key }, ...content);
    mark.addEventListener('click', () => this.toggle([f.key], !f.enabled));
    return mark;
  }

  /** `first` numbers the unit's first spoken word. */
  private unitBlock(u: Unit, index: number, spans: Finding[], first = 0) {
    const el = h('div', { className: 'unit', 'data-unit': String(index) });
    const text = (from: number, to: number) => (u.words ? this.words(u, first, from, to) : [u.text.slice(from, to)]);
    for (const p of pieces(u.text.length, spans)) el.append(...(p.top ? [this.mark(p.top, ...text(p.start, p.end))] : text(p.start, p.end)));
    return el;
  }

  /** Word pages and slides: highlights go into the laid-out paragraphs; notes, comments, alt text and other text off the pages follow below. */
  private refreshSheet(sheet: HTMLElement, layout: Layout, byUnit: Map<string, Finding[]>, pictures: HTMLElement[]) {
    const doc = this.doc!;
    for (const m of Array.from(sheet.querySelectorAll('mark[data-key]'))) m.replaceWith(...m.childNodes);
    sheet.normalize();
    const rest: HTMLElement[] = [];
    let section: string | undefined;
    doc.units.forEach((u, i) => {
      if (u.page !== undefined) return;
      const findings = byUnit.get(u.id) ?? [];
      const blocks = layout.blocks.get(u.id);
      if (!blocks && u.quiet && !findings.length) return;
      if (!blocks && u.section !== undefined && u.section !== section) rest.push(h('h4', { className: 'unit-section' }, u.section));
      if (!blocks) (section = u.section), rest.push(this.unitBlock(u, i, findings));
      else if (findings.length) for (const b of blocks) highlight(b, u.text, findings, (f) => this.mark(f));
    });
    const placed = this.editors.some((e) => e.el.classList.contains('placed'));
    this.textHost.replaceChildren(
      h('p', { className: 'hint' }, placed ? 'Click a highlight or box to redact or keep it. Select text, or drag on a picture, to add more.' : 'Click a highlight to redact or keep it. Select text to add more.'),
      sheet,
      ...(rest.length ? [h('h3', {}, 'Also in this file'), h('div', { className: 'text-preview flow' }, ...rest)] : []),
      ...pictures,
    );
    this.fitSheet();
  }

  /** The text from `from` to `to`, with each spoken word in its own span; `first` numbers the unit's first word. */
  private words(u: Unit, first: number, from: number, to: number): (string | HTMLElement)[] {
    const out: (string | HTMLElement)[] = [];
    let pos = from;
    u.words!.forEach((w, k) => {
      const a = Math.max(from, w.from);
      const b = Math.min(to, w.to);
      if (b <= a) return;
      if (a > pos) out.push(u.text.slice(pos, a));
      out.push(h('span', { className: 'w', 'data-w': String(first + k), 'data-t': String(w.start) }, u.text.slice(a, b)));
      pos = b;
    });
    if (to > pos) out.push(u.text.slice(pos, to));
    return out;
  }

  /** Lights the speech just heard: a highlight that runs through the text and fades out behind the playhead. */
  private follow(t: number) {
    const TRAIL = 1.5;
    // A seek can land a little before the word that was clicked, so that word counts as reached until playback is past it.
    const playing = !this.timeline?.player.paused;
    const pinned = this.pinned === null ? undefined : this.spoken[this.pinned];
    // Paused on a clicked word, it shows as just said.
    if (pinned && t >= pinned.word.start - 0.5 && t <= pinned.word.end) t = playing ? Math.max(t, pinned.word.start) : pinned.word.end;
    else this.pinned = null;
    // First word that ends after the trail begins.
    let lo = 0;
    let hi = this.spoken.length;
    const from = t - TRAIL;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.spoken[mid].word.end < from) lo = mid + 1;
      else hi = mid;
    }
    // How bright the highlight is at a moment: full at the playhead, gone TRAIL seconds behind it.
    const glow = (at: number) => Math.max(0, 1 - (t - at) / TRAIL);
    const lit: HTMLElement[] = [];
    let lead: HTMLElement | undefined;
    let bar: HTMLElement | null = null;
    for (let i = lo; i < this.spoken.length && this.spoken[i].word.start < t; i++) {
      const { word, els } = this.spoken[i];
      const until = Math.min(word.end, t);
      const said = Math.max(0, Math.min(1, (t - word.start) / Math.max(0.05, word.end - word.start)));
      for (const el of els) {
        el.style.setProperty('--a0', String(glow(word.start)));
        el.style.setProperty('--a1', String(glow(until)));
        el.style.setProperty('--said', `${said * 100}%`);
        lit.push(el);
      }
      lead = els[0] ?? lead;
      bar = t <= word.end + 0.25 ? (els.map((el) => el.closest('mark')).find(Boolean) ?? null) : null;
    }
    if (bar !== this.saying) {
      this.saying?.classList.remove('saying');
      bar?.classList.add('saying');
      this.saying = bar;
    }
    for (const el of this.speaking) if (!lit.includes(el)) el.classList.remove('speaking');
    for (const el of lit) el.classList.add('speaking');
    this.speaking = lit;
    const box = lead?.closest<HTMLElement>('.text-preview');
    if (!lead || !box || !playing) return;
    const r = lead.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (r.top < b.top || r.bottom > b.bottom) box.scrollTop += r.top - b.top - b.height / 3;
  }

  private async export(skipCheck = false, transcript = false) {
    const doc = this.doc;
    if (!doc || this.busy) return;
    this.busy = true;
    this.download.disabled = this.transcriptBtn.disabled = true;
    this.warn.hidden = true;
    let checkNote = '';
    try {
      // Ask a second model whether anything sensitive is still readable before handing over the file.
      if (!skipCheck && this.consent === 'yes' && this.checkBox.checked) {
        this.say('Checking the redacted file for anything left…', false, true);
        try {
          const { left, free } = await checkRemaining(remainingText(doc.units, this.findings, this.boxes), this.checkToken);
          if (this.doc !== doc) return;
          // Once the free check is used, further checks cost credits, so the box is no longer ticked.
          if (this.checkToken) this.setFreeCheck(undefined);
          if (left.length) return this.warnLeft(left, transcript, free);
        } catch (err) {
          console.warn(err);
          checkNote = err instanceof QuotaError ? ' Not enough credits for the final check, so review the file carefully.' : ' The final check could not run, so review the file carefully.';
        }
      }
      this.say('Preparing your redacted file…', false, true);
      const { blob, filename } =
        transcript && doc.exportTranscript
          ? await doc.exportTranscript(this.findings, this.boxes)
          : await doc.exportFile(this.findings, this.boxes, this.style, (m) => this.say(m, false, true));
      const url = URL.createObjectURL(blob);
      // Clicked without joining the page, so no page listener (such as analytics) sees the file name.
      h('a', { href: url, download: filename }).click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      const n = this.findings.filter((f) => f.enabled).length + this.boxes.length;
      if (this.consent !== 'yes') checkNote = ' The AI check was skipped because nothing is sent to our server, so review the file carefully.';
      this.say(`Done. ${n} item${n === 1 ? '' : 's'} redacted in ${filename}.${checkNote || ' Open it and check before sharing.'}`, false, true);
    } catch (err) {
      console.error(err);
      this.say(err instanceof Error ? err.message : 'Export failed.', true, true);
    } finally {
      this.busy = false;
      this.download.disabled = this.transcriptBtn.disabled = false;
    }
  }

  private askConsent(doc: LoadedDoc) {
    if (!this.consentBox.hidden) return;
    const text = doc.units.map((u) => u.text).join(' ');
    const words = text.split(/\s+/).filter(Boolean).length;
    const pictures = this.visualKinds.size > 0 && doc.pages.length > 0;
    const seconds = doc.transcribe ? (doc.audio?.duration ?? 0) : 0;
    if (!words && !pictures && !seconds) {
      this.consentBox.hidden = true;
      return;
    }
    const upload = () => {
      this.consent = 'yes';
      this.consentBox.hidden = true;
      this.checkRow.hidden = false;
      this.analyze();
    };
    const images = `${isOffice(doc) ? 'picture' : 'page image'}${doc.pages.length > 1 ? 's' : ''}`;
    const what = seconds ? `the recording (${clock(seconds)})` : words && pictures ? `the text and ${images}` : words ? 'the text' : `the ${images}`;
    // Speech runs at about 900 characters a minute, which detection then reads.
    const pages = (words ? pagesFor(text.length) : 0) + (pictures ? Math.min(doc.pages.length, MAX_AI_PICTURE_PAGES) : 0) + (seconds ? audioCredits(seconds) + pagesFor((seconds / 60) * 900) : 0);
    const cost = `Estimated cost: ${pages} credit${pages === 1 ? '' : 's'}`;
    const costLine = h('p', { className: 'hint' }, `${cost}.`);
    this.consentBox.replaceChildren(
      h('p', {}, `Upload ${what} to find personal info?`),
      costLine,
      h('button', { type: 'button', className: 'btn primary', textContent: 'Upload', onclick: upload }),
    );
    this.consentBox.hidden = false;
    freePagesLeft().then((left) => {
      if (left === null || this.doc !== doc || this.consentBox.hidden) return;
      costLine.textContent = `${cost}, ${left >= pages ? '' : 'only '}${left} left today.`;
    });
  }

  /** Ticks the final check while the scan's free one is unused, and labels its price. */
  private setFreeCheck(token: string | undefined) {
    this.checkToken = token;
    this.checkBox.checked = !!token;
    this.checkRow.replaceChildren(this.checkBox, `Check for anything left (${token ? 'free' : credits(CHECK_CREDITS)})`);
  }

  private warnLeft(left: string[], transcript: boolean, free: boolean) {
    const list = left.map((k) => CHECK_LABELS[k]);
    const what = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0];
    this.say('');
    this.warn.replaceChildren(
      h('p', { className: 'warn-text' }, `The final check thinks some ${what} may still be readable. Look through the preview, tick anything that was missed, or select the text and redact it.`),
      ...(free ? [h('p', { className: 'warn-text' }, `This check was free. To run it again, tick it above the download button (${credits(CHECK_CREDITS)}).`)] : []),
      h(
        'div',
        { className: 'warn-actions' },
        h('button', { type: 'button', className: 'btn', textContent: 'Keep reviewing', onclick: () => (this.warn.hidden = true) }),
        h('button', { type: 'button', className: 'btn ghost', textContent: 'Download anyway', onclick: () => this.export(true, transcript) }),
      ),
    );
    this.warn.hidden = false;
    this.warn.scrollIntoView({ block: 'nearest' });
  }
}

const credits = (n: number) => `${n} credit${n === 1 ? '' : 's'}`;

function aiFailure(err: unknown, fallback: string): string {
  if (err instanceof QuotaError) return err.negative ? err.message : `${err.message} They reset tomorrow, or you can buy more under Account.`;
  return err instanceof Error ? err.message : fallback;
}

const root = document.getElementById('tool');
if (root) new App(root);

// Picture hits per page, and the kinds already looked for, so ticking another
// kind only looks for that one and unticking needs no new pass. A failed pass
// records nothing, so the next analyze tries again.
interface PictureCache {
  kinds: Set<VisualKind>;
  hits: VisualHit[][];
}

function pictureCache(): PictureCache {
  return { kinds: new Set(), hits: [] };
}

function missingKinds(cache: PictureCache, kinds: Set<VisualKind>) {
  return new Set([...kinds].filter((k) => !cache.kinds.has(k)));
}

function addHits(cache: PictureCache, kinds: Set<VisualKind>, found: VisualHit[][]) {
  kinds.forEach((k) => cache.kinds.add(k));
  found.forEach((hits, page) => (cache.hits[page] ??= []).push(...hits));
}
