import { handleAnalytics } from '../server/analytics.js';

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname.startsWith('/api/')) {
      try {
        return await handleAnalytics(request, env) ?? Response.json(
          { error: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } },
        );
      } catch {
        // Never echo database errors, tokens, or user-supplied payloads.
        return Response.json({ error: 'service_unavailable' }, {
          status: 503,
          headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' },
        });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
