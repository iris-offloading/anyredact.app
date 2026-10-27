import { redactStructured, syntaxOf } from '../../shared/structured.ts';
import { outputName, TEXT_STYLES, type LoadedDoc } from '../types.ts';

export async function loadText(file: File): Promise<LoadedDoc> {
  const text = await file.text();
  const syntax = syntaxOf(file.name, text);
  return {
    kind: 'text',
    styles: TEXT_STYLES,
    units: [{ id: 'text', text }],
    pages: [],
    notes: [],
    async exportFile(findings, _boxes, style) {
      const spans = findings.filter((f) => f.enabled);
      const out = redactStructured(text, spans, style === 'label' ? 'label' : 'block', syntax);
      // Dotfiles such as .env keep their name at the end so editors still know them.
      const filename = file.name.startsWith('.') ? `redacted${file.name}` : outputName(file.name, /\.[a-z0-9]{1,10}$/i.test(file.name) ? undefined : 'txt');
      const type = /^(text\/|application\/(json|xml|x-ndjson|yaml))/.test(file.type) ? file.type : 'text/plain';
      return { blob: new Blob([out], { type: `${type.split(';')[0]};charset=utf-8` }), filename };
    },
  };
}
