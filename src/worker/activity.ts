// The account page's recent activity: credits spent per opened file, and
// payments and refunds. Rows hold a format and a credit count, never a file
// name or content. A missing table (migration 0003 not applied) only loses rows.
import { now } from './http.ts';

export const FORMATS = ['pdf', 'docx', 'pptx', 'sheet', 'text', 'image', 'audio'] as const;
export type ActivityKind = (typeof FORMATS)[number] | 'check' | 'pack' | 'plan' | 'refund' | 'dispute';

export interface Activity {
  kind: ActivityKind;
  credits: number;
  cents: number | null;
  at: number;
}

/** The file a metered request belongs to, from the page's x-job and x-format headers. */
export function jobOf(request: Request): { job: string; kind: ActivityKind } {
  const job = request.headers.get('x-job');
  const kind = request.headers.get('x-format') as ActivityKind | null;
  return {
    job: job && /^[\w-]{8,64}$/.test(job) ? job : crypto.randomUUID(),
    kind: kind && (FORMATS as readonly string[]).includes(kind) ? kind : 'text',
  };
}

/** Adds `credits` to the row for this job, creating it. */
export async function logActivity(db: D1Database | undefined, userId: string, job: string, kind: ActivityKind, credits: number, cents: number | null = null): Promise<void> {
  if (!db || !credits) return;
  await db
    .prepare('INSERT INTO activity (user_id, job, kind, credits, cents, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, job) DO UPDATE SET credits = credits + excluded.credits, at = excluded.at')
    .bind(userId, job, kind, credits, cents, now())
    .run()
    .catch((err: unknown) => console.error('activity not recorded', err));
}

export async function recentActivity(db: D1Database, userId: string, limit = 50): Promise<Activity[]> {
  try {
    const rows = await db.prepare('SELECT kind, credits, cents, at FROM activity WHERE user_id = ? ORDER BY at DESC LIMIT ?').bind(userId, limit).all<Activity>();
    return rows.results ?? [];
  } catch {
    return [];
  }
}
