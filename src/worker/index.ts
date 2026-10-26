// Cloudflare Worker entry. Only the default export may live here: workerd
// rejects other named exports from the main module.
import { handleDetect, json, type Env } from './detect.ts';

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/detect') return handleDetect(request, env);
    if (url.pathname === '/api/health') return json({ ok: true });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
