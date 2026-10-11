// The site's Worker. Cloudflare serves every static file straight from dist/ without waking this up (`run_worker_first` in wrangler.jsonc
// names only /api/*), so pages stay free and fast. This runs for the feedback form and the alert media, and for nothing else.

import { handleFeedback } from "./feedback.mjs";
import { handleMedia } from "./media.mjs";

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/feedback") return handleFeedback(request, env);
    if (pathname.startsWith("/api/media")) {
      // A file never changes under its id, so the edge keeps it and the database is asked once.
      const cache = request.method === "GET" ? globalThis.caches?.default : null;
      const hit = cache && (await cache.match(request));
      if (hit) return hit;
      const response = await handleMedia(request, env);
      if (response) {
        if (cache && response.status === 200) ctx?.waitUntil(cache.put(request, response.clone()));
        return response;
      }
    }
    return env.ASSETS.fetch(request); // not ours: hand it to the static files
  },
};
