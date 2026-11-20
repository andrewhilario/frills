// A small local server for dist/:  node scripts/serve.mjs [port]
// It behaves like the live host: folders answer at /name/, a missing page gets the 404 page, and the headers in dist/_headers are
// applied, so a broken Content-Security-Policy shows up here and not after a deploy. It also answers the feedback form's POST to
// /api/feedback and /api/media with the same Worker code the live site runs, over a local SQLite file (.dev-feedback.sqlite, not committed;
// FEEDBACK_DB=:memory: keeps it in memory instead).

import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { createStatic } from "./lib/static.mjs";
import { localDatabase } from "./lib/d1-sqlite.mjs";
import { handleFeedback } from "../worker/feedback.mjs";
import { handleMedia } from "../worker/media.mjs";
import { handleSongs } from "../worker/songs.mjs";
import { handleNowPlaying } from "../worker/nowplaying.mjs";
import { handleSpotify } from "../worker/spotify.mjs";
import { handleAdmin } from "../worker/admin.mjs";
import { handleFollows } from "../worker/follows.mjs";
import { handleTimer } from "../worker/timer.mjs";
import { handleAccount } from "../worker/account-routes.mjs";
import { handlePlusWebhook } from "../worker/plus-webhook.mjs";
import { handlePolarWebhook } from "../worker/polar.mjs";
import { handlePlusRelayTicket } from "../worker/plus-relay.mjs";
import { cloudHostIdFromPath, handleCloudOverlays } from "../worker/cloud-overlays.mjs";
import { handleProStatus } from "../worker/region.mjs";
import { handleDevPass, handleTts } from "../worker/tts.mjs";

const root = join(import.meta.dirname, "..");
const port = Number(process.argv[2] ?? process.env.PORT ?? 3020);
const serveFiles = createStatic(process.env.DIST_DIR ? resolve(root, process.env.DIST_DIR) : join(root, "dist")); // (DIST_DIR lets a test serve a variant it built on the side)
// ADMIN_KEY is the admin password for this local server only (at least 12 characters); without it the admin side answers "off", as live does.
// SPOTIFY_TOKEN_KEY is the key the Spotify logins are kept under (32 random bytes, base64). Here, without one, a throwaway key is made each time the
// server starts, so a login kept in the local database cannot be read after a restart (the page then asks to log in again).
const throwaway = Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64");
const env = {
  DEV: true,
  DB: localDatabase(process.env.FEEDBACK_DB ?? join(root, ".dev-feedback.sqlite")),
  ADMIN_KEY: process.env.ADMIN_KEY,
  SPOTIFY_TOKEN_KEY: process.env.SPOTIFY_TOKEN_KEY ?? throwaway,
  OPENAI_TTS_KEY: process.env.OPENAI_TTS_KEY,
  GOOGLE_TTS_KEY: process.env.GOOGLE_TTS_KEY,
  GROQ_TTS_KEY: process.env.GROQ_TTS_KEY,
  PRO_DEV_KEY: process.env.PRO_DEV_KEY,
  PRO_COUNTRIES: process.env.PRO_COUNTRIES,
  PRO_ALLOW_IPS: process.env.PRO_ALLOW_IPS,
  PLUS_RELAY_URL: process.env.PLUS_RELAY_URL,
  PLUS_RELAY_SECRET: process.env.PLUS_RELAY_SECRET,
  REQUIRE_PRO_PASS: process.env.REQUIRE_PRO_PASS,
  LEMON_CHECKOUT_URL: process.env.LEMON_CHECKOUT_URL,
  LEMON_STORE_ID: process.env.LEMON_STORE_ID,
  LEMON_PRODUCT_ID: process.env.LEMON_PRODUCT_ID,
  LEMON_WEBHOOK_SECRET: process.env.LEMON_WEBHOOK_SECRET,
  LEMON_API_KEY: process.env.LEMON_API_KEY,
  LEMON_PORTAL_URL: process.env.LEMON_PORTAL_URL,
  LEMON_TEST_MODE: process.env.LEMON_TEST_MODE ?? "1",
  POLAR_ACCESS_TOKEN: process.env.POLAR_ACCESS_TOKEN,
  POLAR_PRODUCT_ID: process.env.POLAR_PRODUCT_ID,
  POLAR_WEBHOOK_SECRET: process.env.POLAR_WEBHOOK_SECRET,
  POLAR_SANDBOX: process.env.POLAR_SANDBOX,
  PLUS_REVIEW_KEY: process.env.PLUS_REVIEW_KEY,
  PLUS_MONTHLY_CHARS: process.env.PLUS_MONTHLY_CHARS,
  PRO_MONTHLY_LIMIT: process.env.PRO_MONTHLY_LIMIT,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  MAIL_FROM: process.env.MAIL_FROM,
  RESEND_LIVE: process.env.RESEND_LIVE,
};

createServer(async (req, res) => {
  const path = req.url?.split("?")[0] ?? "";
  if (path === "/api/songs") {
    const response = await handleSongs(new Request(`http://${req.headers.host}${req.url}`, { method: req.method }), { cache: null });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  if (path.startsWith("/api/follows/") || path.startsWith("/api/timer/")) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const response = await (path.startsWith("/api/timer/") ? handleTimer : handleFollows)(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  if (path.startsWith("/api/nowplaying/") || path.startsWith("/api/spotify/")) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const handle = path.startsWith("/api/spotify/") ? handleSpotify : handleNowPlaying;
    const response = await handle(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  if (path === "/api/feedback" || path.startsWith("/api/media") || path.startsWith("/api/admin/")) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const origin = `http://${req.headers.host}`;
    const request = new Request(origin + req.url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const response = path === "/api/feedback" ? await handleFeedback(request, env) : path.startsWith("/api/admin/") ? await handleAdmin(request, env) : await handleMedia(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  if (path.startsWith("/api/account/") || path === "/api/dev/outbox" || path === "/api/webhooks/lemonsqueezy" || path === "/api/webhooks/polar") {
    // (the local mailer writes each email down; this is how a test, or you, reads the sign-in link. It exists only in this local server.)
    if (path === "/api/dev/outbox") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(env.OUTBOX ?? []));
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const handler = path === "/api/webhooks/polar" ? handlePolarWebhook : path === "/api/webhooks/lemonsqueezy" ? handlePlusWebhook : handleAccount;
    const response = await handler(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  if (path === "/api/cloud-overlays" || path.startsWith("/api/cloud-overlays/") || path.startsWith("/api/o/")) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const response = await handleCloudOverlays(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  if (cloudHostIdFromPath(path)) {
    req.url = "/o/index.html";
    serveFiles(req, res);
    return;
  }
  if (path === "/api/pro/status" || path === "/api/pro/dev-pass" || path === "/api/plus/relay-ticket" || path === "/api/tts") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const response = path === "/api/pro/status"
      ? await handleProStatus(request, env)
      : path === "/api/pro/dev-pass"
        ? await handleDevPass(request, env)
        : path === "/api/plus/relay-ticket"
          ? await handlePlusRelayTicket(request, env)
          : await handleTts(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  serveFiles(req, res);
}).listen(port, () => console.log(`Frills is at http://localhost:${port}/`));
