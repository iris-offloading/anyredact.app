// Paid AI detection is sold as credits. One credit covers 3,000 characters of
// extracted text (roughly one dense page) or one picture; a minute of audio takes three. Free use is the daily
// allowance in src/worker/quota.ts.

export const CREDIT_CHARS = 3_000;
/** Free credits each browser gets a day. */
export const FREE_CREDITS = 10;
// Most characters one AI request may carry.
export const MAX_CHARS = 60_000;

export interface Product {
  id: string;
  name: string;
  credits: number;
  /** Price in US cents. */
  cents: number;
  /** Monthly plan rather than credits paid once. */
  monthly?: boolean;
}

// Prices set by Iris on 2026-10-27 after comparing similar redaction tools; one-off credits lowered the same day so they sit closer to plan rates.
export const PRODUCTS: Product[] = [
  { id: 'plus', name: 'Plus', credits: 600, cents: 900, monthly: true },
  { id: 'pro', name: 'Pro', credits: 3_000, cents: 2_400, monthly: true },
  { id: 'credits-100', name: '100 credits', credits: 100, cents: 500 },
  { id: 'credits-500', name: '500 credits', credits: 500, cents: 1_500 },
  { id: 'credits-2000', name: '2,000 credits', credits: 2_000, cents: 3_900 },
];

/** The product with this id. Ids from before the rename (pack-500) still name their product, for checkouts started then and old links. */
export const findProduct = (id: unknown): Product | undefined =>
  typeof id === 'string' ? PRODUCTS.find((p) => p.id === id.replace(/^pack-/, 'credits-')) : undefined;

/** Credits for a final check after the free first one. */
export const CHECK_CREDITS = 1;

export const creditsFor = (chars: number) => Math.max(1, Math.ceil(chars / CREDIT_CHARS));

export const AUDIO_CREDITS_PER_MINUTE = 3;

/** Credits for transcribing a stretch of audio: three per started minute. */
export const audioCredits = (seconds: number) => AUDIO_CREDITS_PER_MINUTE * Math.max(1, Math.ceil(seconds / 60));

// Audio goes to the Worker as 16 kHz mono 16-bit WAV, in chunks of this many seconds.
export const SPEECH_RATE = 16_000;
export const CHUNK_SECONDS = 240;
export const CHUNK_OVERLAP = 1;

export const price = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
