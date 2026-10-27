// Cloudflare Worker entry. Only the default export may live here: workerd
// rejects other named exports from the main module.
import { handleCheck } from './check.ts';
import { handleDetect, type Env } from './detect.ts';
import { pool } from '../shared/pool.ts';
import { base64, json, rateLimited, trialsAllowed } from './http.ts';
import { handleAccounts } from './accounts.ts';
import { handleBilling } from './billing.ts';
import { quotaStatus } from './quota.ts';
import { handleTranscribe } from './transcribe.ts';
import { handleVision } from './vision.ts';

// Durable Object class for the free daily allowance; workerd allows class exports.
export { Quota } from './quota.ts';

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/detect') return handleDetect(request, env);
    if (url.pathname === '/api/check') return handleCheck(request, env);
    if (url.pathname === '/api/vision') return handleVision(request, env);
    if (url.pathname === '/api/transcribe') return handleTranscribe(request, env);
    const account = (await handleAccounts(request, env, url)) ?? (await handleBilling(request, env, url));
    if (account) return account;
    if (url.pathname === '/api/quota') return json({ quota: await quotaStatus(request, env) });
    if (url.pathname === '/api/health') return json({ ok: true });
    // static/analytics.js asks for cookie consent in the countries that require it.
    if (url.pathname === '/api/country') return json({ country: request.cf?.country ?? null });
    // Preview-only model catalogue, for picking models to benchmark.
    if (url.pathname === '/api/models' && trialsAllowed(request, env) && env.AI) {
      const search = url.searchParams.get('search');
      const models = await env.AI.models((search ? { search, per_page: 50 } : { task: url.searchParams.get('task') || 'Text Generation', per_page: 200 }) as never);
      return json(search ? models : models.map((m) => m.name));
    }
    // Preview-only raw model call, for trying inputs such as images before building on them.
    // `inputs` runs several calls in one request (scripts/bench-audio.mjs sends many short speech clips).
    if (url.pathname === '/api/trial' && request.method === 'POST' && trialsAllowed(request, env) && env.AI) {
      if (await rateLimited(request, env.DETECT_LIMITER, 'trial:')) return json({ error: 'rate limited' }, 429);
      const { model, input, inputs, options } = (await request.json()) as { model: string; input?: Record<string, unknown>; inputs?: Record<string, unknown>[]; options?: Record<string, unknown> };
      const ai = env.AI;
      const call = async (one: Record<string, unknown>) => {
        const started = Date.now();
        const result = await trialResult(await ai.run(model as never, trialInput(one) as never, options as never));
        return { result, ms: Date.now() - started };
      };
      try {
        if (!inputs) return json(await call(input ?? {}));
        const out: unknown[] = new Array(Math.min(inputs.length, 100));
        await pool(out.length, 4, async (i) => {
          out[i] = await call(inputs[i]).catch((err) => ({ error: String(err) }));
        });
        return json({ results: out });
      } catch (err) {
        return json({ error: String(err) }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

// Audio sent to a trial as { base64, contentType } reaches the model as raw bytes
// (the Deepgram models' input shape). Whisper takes a plain base64 string instead.
function trialInput(input: Record<string, unknown>): Record<string, unknown> {
  const audio = input.audio as { base64?: string; contentType?: string } | undefined;
  if (!audio || typeof audio !== 'object' || typeof audio.base64 !== 'string') return input;
  const bytes = Uint8Array.from(atob(audio.base64), (c) => c.charCodeAt(0));
  return { ...input, audio: { body: new Blob([bytes]).stream(), contentType: audio.contentType } };
}

// Speech models answer with an audio stream, which JSON cannot carry: send it as base64.
async function trialResult(result: unknown): Promise<unknown> {
  if (!(result instanceof ReadableStream)) return result;
  return { audio: base64(new Uint8Array(await new Response(result).arrayBuffer())) };
}
