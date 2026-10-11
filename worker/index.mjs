// The site's Worker. Cloudflare serves every static file straight from dist/ without waking this up (`run_worker_first` in wrangler.jsonc
// names only /api/*), so pages stay free and fast. This runs for the feedback form and the alert media, and for nothing else.

import { handleFeedback } from "./feedback.mjs";
import { handleMedia } from "./media.mjs";

/** How long the edge keeps a file it has already read from the database. Short, so a deleted or reported file is gone within the hour. */
const EDGE_SECONDS = 3600;

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/feedback") return handleFeedback(request, env);
    if (pathname.startsWith("/api/media")) {
      const cache = globalThis.caches?.default;
      const key = new Request(new URL(request.url).origin + pathname); // one entry per file, whatever else is on the address
      if (cache && request.method === "GET") {
        const hit = await cache.match(key);
        if (hit) return hit;
      }
      const response = await handleMedia(request, env);
      if (response) {
        if (cache && request.method === "GET" && response.status === 200) {
          // the copy kept at the edge has a short life; the visitor gets the normal headers
          const kept = new Response(response.clone().body, response);
          kept.headers.set("cache-control", `public, max-age=${EDGE_SECONDS}`);
          ctx?.waitUntil(cache.put(key, kept));
        }
        // a delete also clears the copy this edge holds right now (other edges clear within the hour)
        if (cache && request.method === "DELETE" && response.status === 200) ctx?.waitUntil(cache.delete(key));
        return response;
      }
    }
    return env.ASSETS.fetch(request); // not ours: hand it to the static files
  },
};
