// Cloudflare Worker entry. Only the default export may live here: workerd
// rejects other named exports from the main module.
import { handleCheck } from './check.ts';
import { handleDetect, json, type Env } from './detect.ts';
import { handleAccounts } from './accounts.ts';
import { handleBilling } from './billing.ts';
import { quotaStatus } from './quota.ts';
import { handleVision } from './vision.ts';

// Durable Object class for the free daily allowance; workerd allows class exports.
export { Quota } from './quota.ts';

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/detect') return handleDetect(request, env);
    if (url.pathname === '/api/check') return handleCheck(request, env);
    if (url.pathname === '/api/vision') return handleVision(request, env);
    const account = (await handleAccounts(request, env, url)) ?? (await handleBilling(request, env, url));
    if (account) return account;
    if (url.pathname === '/api/quota') return json({ quota: await quotaStatus(request, env) });
    if (url.pathname === '/api/health') return json({ ok: true });
    // Preview-only model catalogue, for picking models to benchmark.
    if (url.pathname === '/api/models' && env.MODEL_TRIALS === '1' && env.AI) {
      const search = url.searchParams.get('search');
      const models = await env.AI.models((search ? { search, per_page: 50 } : { task: url.searchParams.get('task') || 'Text Generation', per_page: 200 }) as never);
      return json(search ? models : models.map((m) => m.name));
    }
    // Preview-only raw model call, for trying inputs such as images before building on them.
    if (url.pathname === '/api/trial' && request.method === 'POST' && env.MODEL_TRIALS === '1' && env.AI) {
      if (env.DETECT_LIMITER && !(await env.DETECT_LIMITER.limit({ key: `trial:${request.headers.get('cf-connecting-ip')}` })).success) return json({ error: 'rate limited' }, 429);
      const { model, input } = (await request.json()) as { model: string; input: Record<string, unknown> };
      try {
        return json({ result: await env.AI.run(model as never, input as never) });
      } catch (err) {
        return json({ error: String(err) }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
