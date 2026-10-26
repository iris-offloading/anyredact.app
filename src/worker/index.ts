// Cloudflare Worker entry. Only the default export may live here: workerd
// rejects other named exports from the main module.
import { handleCheck } from './check.ts';
import { handleDetect, json, type Env } from './detect.ts';
import { handleAccounts } from './accounts.ts';
import { handleBilling } from './billing.ts';
import { quotaStatus } from './quota.ts';

// Durable Object class for the free daily allowance; workerd allows class exports.
export { Quota } from './quota.ts';

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/detect') return handleDetect(request, env);
    if (url.pathname === '/api/check') return handleCheck(request, env);
    const account = (await handleAccounts(request, env, url)) ?? (await handleBilling(request, env, url));
    if (account) return account;
    if (url.pathname === '/api/quota') return json({ quota: await quotaStatus(request, env) });
    if (url.pathname === '/api/health') return json({ ok: true });
    // Preview-only model catalogue, for picking models to benchmark.
    if (url.pathname === '/api/models' && env.MODEL_TRIALS === '1' && env.AI) {
      const models = await env.AI.models({ task: url.searchParams.get('task') || 'Text Generation', per_page: 200 } as never);
      return json(models.map((m) => m.name));
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
