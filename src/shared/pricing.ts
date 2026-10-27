// Paid AI detection is sold as credits. One credit covers 3,000 characters of
// extracted text (roughly one dense page), one picture or one minute of audio. Free use is the daily
// allowance in src/worker/quota.ts. Code and the database still call them pages.

export const PAGE_CHARS = 3_000;
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

// Placeholder prices until Iris sets the final ones.
export const PRODUCTS: Product[] = [
  { id: 'monthly', name: 'Monthly plan', pages: 1_000, cents: 500, monthly: true },
  { id: 'pack-300', name: '300 credits', pages: 300, cents: 300 },
  { id: 'pack-1000', name: '1,000 credits', pages: 1_000, cents: 800 },
];

/** Credits for a final check after the free first one. */
export const CHECK_CREDITS = 1;

export const pagesFor = (chars: number) => Math.max(1, Math.ceil(chars / PAGE_CHARS));

/** Credits for transcribing a stretch of audio: one per started minute. */
export const audioCredits = (seconds: number) => Math.max(1, Math.ceil(seconds / 60));

// Audio goes to the Worker as 16 kHz mono 16-bit WAV, in chunks of this many seconds.
export const SPEECH_RATE = 16_000;
export const CHUNK_SECONDS = 240;
export const CHUNK_OVERLAP = 1;

export const price = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
