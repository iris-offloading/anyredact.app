// Paid AI detection is sold as credits. One credit covers 3,000 characters of
// extracted text (roughly one dense page) or one picture; a minute of audio takes three. Free use is the daily
// allowance in src/worker/quota.ts. Code and the database still call them pages.

export const PAGE_CHARS = 3_000;
/** Free credits each browser gets a day. */
export const FREE_CREDITS = 10;
// Most characters one AI request may carry.
export const MAX_CHARS = 60_000;

export interface Product {
  id: string;
  name: string;
  pages: number;
  /** Price in US cents. */
  cents: number;
  /** Monthly subscription rather than a one-off pack. */
  monthly?: boolean;
}

// Prices set by Iris on 2026-10-27 after comparing similar redaction tools; packs lowered the same day so they sit closer to plan rates.
export const PRODUCTS: Product[] = [
  { id: 'plus', name: 'Plus', pages: 600, cents: 900, monthly: true },
  { id: 'pro', name: 'Pro', pages: 3_000, cents: 2_400, monthly: true },
  { id: 'pack-100', name: '100 credits', pages: 100, cents: 500 },
  { id: 'pack-500', name: '500 credits', pages: 500, cents: 1_500 },
  { id: 'pack-2000', name: '2,000 credits', pages: 2_000, cents: 3_900 },
];

/** Credits for a final check after the free first one. */
export const CHECK_CREDITS = 1;

export const pagesFor = (chars: number) => Math.max(1, Math.ceil(chars / PAGE_CHARS));

export const AUDIO_CREDITS_PER_MINUTE = 3;

/** Credits for transcribing a stretch of audio: three per started minute. */
export const audioCredits = (seconds: number) => AUDIO_CREDITS_PER_MINUTE * Math.max(1, Math.ceil(seconds / 60));

// Audio goes to the Worker as 16 kHz mono 16-bit WAV, in chunks of this many seconds.
export const SPEECH_RATE = 16_000;
export const CHUNK_SECONDS = 240;
export const CHUNK_OVERLAP = 1;

export const price = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
