import { labelText, maskText } from '../../shared/detect.ts';
import { outputName, type LoadedDoc } from '../types.ts';

export async function loadText(file: File): Promise<LoadedDoc> {
  const text = await file.text();
  return {
    kind: 'text',
    name: file.name,
    units: [{ id: 'text', text }],
    pages: [],
    notes: [],
    async exportFile(findings, _boxes, style) {
      const spans = findings.filter((f) => f.enabled);
      const out = style === 'label' ? labelText(text, spans) : maskText(text, spans);
      const ext = /\.[a-z0-9]{1,5}$/i.test(file.name) ? undefined : 'txt';
      return { blob: new Blob([out], { type: 'text/plain;charset=utf-8' }), filename: outputName(file.name, ext) };
    },
  };
}
