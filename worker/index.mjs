// The site's Worker. Cloudflare serves every static file straight from dist/ without waking this up (`run_worker_first` in wrangler.jsonc
// names only /api/*), so pages stay free and fast. This runs for the feedback form's POST and for nothing else.

import { handleFeedback } from "./feedback.mjs";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/feedback") return handleFeedback(request, env);
    return env.ASSETS.fetch(request); // not ours: hand it to the static files
  },
};
