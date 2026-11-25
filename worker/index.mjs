// The site's Worker. Cloudflare serves every static file straight from dist/ without waking this up (`run_worker_first` in wrangler.jsonc
// names only /api/* and the overlay pages), so pages stay free and fast. This runs for the feedback form, the alert media, the song lookup, the Spotify post box and
// login keeper, the anonymous counts, and the overlay pages (it counts each opening and hands the page on). Once a day (the cron trigger in wrangler.jsonc) it also deletes Spotify logins that have not been used for 14 days.

import { handleFeedback } from "./feedback.mjs";
import { handleMedia } from "./media.mjs";
import { handleSongs } from "./songs.mjs";
import { handleNowPlaying } from "./nowplaying.mjs";
import { handleSpotify, pruneSpotify } from "./spotify.mjs";
import { handleAdmin } from "./admin.mjs";
import { handleFollows } from "./follows.mjs";
import { handleTimer } from "./timer.mjs";
import { handleAccount } from "./account-routes.mjs";
import { sweep } from "./accounts.mjs";
import { handlePlusWebhook } from "./plus-webhook.mjs";
import { handlePolarWebhook } from "./polar.mjs";
import { handlePlusRelayTicket } from "./plus-relay.mjs";
import { cloudHostIdFromPath, handleCloudOverlays } from "./cloud-overlays.mjs";
import { checkProRegion, handleProStatus } from "./region.mjs";
import { handleDevPass, handleTts, handleVoiceSample, handleCohost } from "./tts.mjs";
import { countOverlay, handleEvent } from "./stats.mjs";
import { handlePublicStatus } from "./stats-report.mjs";
import { runPlusAgent } from "./plus-agent.mjs";
const PLUS_AGENT_CRON = "17 15 * * *"; // keep in step with "triggers" in wrangler.jsonc

/** How long the edge keeps a file it has already read from the database. Short, so a deleted or reported file is gone within the hour. */
const EDGE_SECONDS = 3600;

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/e") return handleEvent(request, env);
    if (pathname === "/api/status") return handlePublicStatus(request, env);
    if (pathname === "/overlay" || pathname.startsWith("/overlay/")) return countOverlay(request, env); // (counts the opening, then serves the page as before)
    if (pathname === "/api/feedback") return handleFeedback(request, env);
    if (pathname === "/api/songs") return handleSongs(request, { ctx });
    if (pathname.startsWith("/api/nowplaying/")) return handleNowPlaying(request, env);
    if (pathname.startsWith("/api/spotify/")) return handleSpotify(request, env);
    if (pathname.startsWith("/api/follows/")) return handleFollows(request, env);
    if (pathname.startsWith("/api/timer/")) return handleTimer(request, env);
    if (pathname.startsWith("/api/account/")) return handleAccount(request, env);
    if (pathname === "/api/pro/status") return handleProStatus(request, env);
    if (pathname === "/api/pro/dev-pass") return handleDevPass(request, env);
    if (pathname === "/api/plus/relay-ticket") return handlePlusRelayTicket(request, env);
    if (pathname === "/api/cloud-overlays" || pathname.startsWith("/api/cloud-overlays/") || pathname.startsWith("/api/o/")) {
      return handleCloudOverlays(request, env);
    }
    if (pathname === "/o" || pathname.startsWith("/o/")) {
      if (!cloudHostIdFromPath(pathname)) {
        const notFound = await env.ASSETS.fetch(new Request(new URL("/404.html", request.url), { method: "GET" }));
        return new Response(request.method === "HEAD" ? null : notFound.body, { status: 404, headers: { ...Object.fromEntries(notFound.headers), "cache-control": "no-store" } });
      }
      const res = await env.ASSETS.fetch(new Request(new URL("/o/index.html", request.url), { method: "GET" }));
      const headers = new Headers(res.headers);
      headers.set("cache-control", "no-store");
      headers.set("x-robots-tag", "noindex, nofollow");
      return new Response(request.method === "HEAD" ? null : res.body, { status: res.status, statusText: res.statusText, headers });
    }
    if (pathname === "/api/webhooks/lemonsqueezy") return handlePlusWebhook(request, env);
    if (pathname === "/api/webhooks/polar") return handlePolarWebhook(request, env);
    if (pathname === "/api/tts") return handleTts(request, env);
    if (pathname === "/api/voice-sample") return handleVoiceSample(request, env, { ctx });
    if (pathname === "/api/cohost") return handleCohost(request, env);
    if (pathname.startsWith("/api/admin/")) {
      const response = await handleAdmin(request, env);
      // a file the owner removed also goes from the copy this edge holds right now (other edges clear within the hour)
      const gone = /^\/api\/admin\/media\/([^/]+)$/.exec(pathname);
      if (gone && request.method === "DELETE" && response?.status === 200 && globalThis.caches?.default) {
        ctx?.waitUntil(globalThis.caches.default.delete(new Request(new URL(request.url).origin + "/api/media/" + gone[1])));
      }
      return response;
    }
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
    if (pathname === "/plus" || pathname.startsWith("/plus/") || pathname === "/account" || pathname.startsWith("/account/")) {
      const reviewKey = String(env?.PLUS_REVIEW_KEY ?? "").trim();
      const reviewPass = Boolean(reviewKey && (pathname === "/plus" || pathname.startsWith("/plus/")) && new URL(request.url).searchParams.get("review") === reviewKey);
      const region = checkProRegion(request, env);
      if (!region.eligible && !reviewPass) {
        const notFound = await env.ASSETS.fetch(new Request(new URL("/404.html", request.url), { method: "GET" }));
        const headers = new Headers(notFound.headers);
        headers.set("cache-control", "no-store");
        headers.set("vary", "CF-IPCountry");
        return new Response(request.method === "HEAD" ? null : notFound.body, { status: 404, headers });
      }
      const res = await env.ASSETS.fetch(request);
      const headers = new Headers(res.headers);
      headers.set("cache-control", "private, no-store");
      headers.set("vary", "CF-IPCountry");
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }
    return env.ASSETS.fetch(request); // not ours: hand it to the static files
  },

  /** The daily clean-up: idle Spotify logins (14 days) plus expired sign-in links and sessions. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([
      pruneSpotify(env),
      env?.DB ? sweep(env.DB).catch(() => {}) : Promise.resolve(),
      // Mango, the Plus sales agent, runs on the afternoon schedule only (15:17 UTC: daytime in the US and Europe). It never throws.
      event?.cron === PLUS_AGENT_CRON ? runPlusAgent(env).catch(() => {}) : Promise.resolve(),
    ]));
  },
};
