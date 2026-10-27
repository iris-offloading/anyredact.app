import exifr from 'exifr';
import type { MetaField } from '../types.ts';

type Tags = Record<string, unknown>;

// Fields people care about, in display order. Each lists the EXIF, XMP and IPTC
// names that carry it; the first one present wins.
const KEY_FIELDS: [string, string[]][] = [
  ['Taken', ['DateTimeOriginal', 'CreateDate', 'DateCreated']],
  ['Modified', ['ModifyDate', 'MetadataDate']],
  ['Camera', []],
  ['Lens', ['LensModel', 'Lens']],
  ['Serial number', ['BodySerialNumber', 'SerialNumber', 'CameraSerialNumber', 'LensSerialNumber']],
  ['Owner', ['CameraOwnerName', 'OwnerName']],
  ['Author', ['Artist', 'creator', 'Byline', 'Creator']],
  ['Copyright', ['Copyright', 'rights', 'CopyrightNotice']],
  ['Title', ['title', 'ObjectName', 'Headline']],
  ['Description', ['ImageDescription', 'description', 'Caption', 'UserComment']],
  ['Keywords', ['Keywords', 'subject']],
  ['Place', []],
  ['Software', ['Software', 'CreatorTool', 'ProcessingSoftware']],
];

// Technical values that say nothing about the person or place.
const SKIP = new Set(['latitude', 'longitude', 'ExifVersion', 'FlashpixVersion', 'ComponentsConfiguration', 'YCbCrPositioning', 'ResolutionUnit', 'XResolution', 'YResolution', 'ColorSpace', 'ExifImageWidth', 'ExifImageHeight', 'ImageWidth', 'ImageHeight', 'Orientation', 'InteropIndex', 'InteropVersion', 'GPSVersionID', 'xmlns', 'about']);

/** Reads EXIF, GPS, XMP and IPTC from an image file. Never throws. */
export async function readMetadata(file: File): Promise<MetaField[]> {
  let tags: Tags | undefined;
  try {
    tags = await exifr.parse(file, {
      tiff: true,
      exif: true,
      gps: true,
      interop: false,
      xmp: true,
      iptc: true,
      icc: false,
      jfif: false,
      ihdr: false,
      makerNote: false,
      userComment: true,
      mergeOutput: true,
    });
  } catch (err) {
    console.warn(err);
  }
  return tags ? describe(tags) : [];
}

export function describe(tags: Tags): MetaField[] {
  const used = new Set<string>();
  const take = (names: string[]) => {
    for (const n of names) {
      const v = show(tags[n]);
      if (v) {
        names.forEach((x) => used.add(x));
        return v;
      }
    }
    return '';
  };
  const out: MetaField[] = [];
  const lat = Number(tags.latitude);
  const lon = Number(tags.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    out.push({ label: 'Location', value: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, key: true });
    for (const k of Object.keys(tags)) if (k.startsWith('GPS')) used.add(k);
  }
  for (const [label, names] of KEY_FIELDS) {
    let value = '';
    if (label === 'Camera') {
      const make = take(['Make']);
      const model = take(['Model']);
      value = model.toLowerCase().startsWith(make.toLowerCase()) ? model : [make, model].filter(Boolean).join(' ');
    } else if (label === 'Place') {
      value = [take(['Sublocation', 'Location']), take(['City']), take(['State', 'Province-State']), take(['Country', 'Country-PrimaryLocationName'])].filter(Boolean).join(', ');
    } else value = take(names);
    if (value) out.push({ label, value, key: true });
  }
  for (const [k, raw] of Object.entries(tags)) {
    if (used.has(k) || SKIP.has(k)) continue;
    const value = show(raw);
    if (value) out.push({ label: k.replace(/([a-z])([A-Z])/g, '$1 $2'), value, key: false });
  }
  return out;
}

export function show(v: unknown): string {
  if (v === undefined || v === null || v === '') return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toLocaleString();
  if (v instanceof Uint8Array || ArrayBuffer.isView(v)) return '';
  if (Array.isArray(v)) return v.map(show).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    // XMP language alternatives arrive as { lang, value }.
    const o = v as Record<string, unknown>;
    if ('value' in o) return show(o.value);
    return Object.values(o).map(show).filter(Boolean).join(', ');
  }
  const s = String(v).replace(/\0+$/, '').trim();
  return s.length > 160 ? s.slice(0, 158) + '…' : s;
}
