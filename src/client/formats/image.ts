import { burnBoxes, canvasToBlob, outputName, rectsForPage, type LoadedDoc, type Progress, type Unit } from '../types.ts';
import { readMetadata } from './metadata.ts';
import { ocrUnit } from './ocr.ts';

const MAX_SIDE = 6000;

export async function loadImage(file: File, progress: Progress): Promise<LoadedDoc> {
  progress('Opening image…');
  const metadata = readMetadata(file);
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const notes: string[] = [];
  let unit: Unit = { id: 'image', page: 0, text: '' };
  try {
    unit = await ocrUnit('image', 0, canvas, progress);
    if (!unit.text.trim()) notes.push('No text was found in this image. Drag on the image to draw redaction boxes.');
  } catch (err) {
    console.error(err);
    notes.push('Automatic text reading failed, so nothing was detected. Drag on the image to draw redaction boxes.');
  }

  const type = ['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ? file.type : 'image/png';
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[type]!;
  return {
    kind: 'image',
    name: file.name,
    units: [unit],
    pages: [{ index: 0, canvas }],
    notes,
    metadata: await metadata,
    async exportFile(findings, boxes) {
      // Re-encoding through a canvas writes pixels only, so EXIF, GPS, XMP and IPTC are left behind.
      const out = burnBoxes(canvas, rectsForPage(0, findings, boxes));
      return { blob: await canvasToBlob(out, type, 0.92), filename: outputName(file.name, ext) };
    },
  };
}
