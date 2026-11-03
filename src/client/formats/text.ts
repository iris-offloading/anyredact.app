import { redactStructured, syntaxOf } from '../../shared/structured.ts';
import { FileError, outputName, TEXT_STYLES, type LoadedDoc } from '../types.ts';

/**
 * Reads text as its byte order mark says, else as UTF-8, else as Windows-1252, the
 * encoding Excel and Notepad save in on most Western systems. `bom` is set when the
 * download should start with one, so programs that guess (Excel) read it as UTF-8.
 */
export function decodeText(bytes: Uint8Array): { text: string; bom: boolean } {
  const [a, b, c] = bytes;
  if (a === 0xef && b === 0xbb && c === 0xbf) return { text: new TextDecoder().decode(bytes), bom: true };
  if (a === 0xff && b === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes), bom: true };
  if (a === 0xfe && b === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes), bom: true };
  const head = bytes.subarray(0, 65_536);
  // UTF-16 without a byte order mark: Latin text has a zero in every other byte.
  const zeros = [0, 0];
  head.forEach((x, i) => x === 0 && zeros[i % 2]++);
  const utf16 = (odd: number) => head.length >= 4 && zeros[odd] > head.length * 0.4 && zeros[1 - odd] < head.length * 0.02;
  if (utf16(1)) return { text: new TextDecoder('utf-16le').decode(bytes), bom: true };
  if (utf16(0)) return { text: new TextDecoder('utf-16be').decode(bytes), bom: true };
  // Control characters other than tabs, line breaks and escape codes mark a binary file.
  let control = 0;
  for (const x of head) if (x < 0x20 && x !== 0x09 && x !== 0x0a && x !== 0x0d && x !== 0x0c && x !== 0x1b) control++;
  if (control > head.length * 0.05) throw new FileError('This file does not look like text.');
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), bom: false };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), bom: true };
  }
}

export async function loadText(file: File): Promise<LoadedDoc> {
  const { text, bom } = decodeText(new Uint8Array(await file.arrayBuffer()));
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
      return { blob: new Blob([bom ? '﻿' : '', out], { type: `${type.split(';')[0]};charset=utf-8` }), filename };
    },
  };
}
