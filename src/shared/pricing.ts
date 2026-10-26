// Paid AI detection is sold as credits. One credit covers 3,000 characters of
// extracted text (roughly one dense page) or one picture. Free use is the daily
// allowance in src/worker/quota.ts. Code and the database still call them pages.

export const PAGE_CHARS = 3_000;

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

export const pagesFor = (chars: number) => Math.max(1, Math.ceil(chars / PAGE_CHARS));

export const price = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
