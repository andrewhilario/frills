// A small local server for dist/:  node scripts/serve.mjs [port]
// It behaves like the live host: folders answer at /name/, a missing page gets the 404 page, and the headers in dist/_headers are
// applied, so a broken Content-Security-Policy shows up here and not after a deploy. It also answers the feedback form's POST to
// /api/feedback and /api/media with the same Worker code the live site runs, over a local SQLite file (.dev-feedback.sqlite, not committed;
// FEEDBACK_DB=:memory: keeps it in memory instead).

import { createServer } from "node:http";
import { join } from "node:path";
import { createStatic } from "./lib/static.mjs";
import { localDatabase } from "./lib/d1-sqlite.mjs";
import { handleFeedback } from "../worker/feedback.mjs";
import { handleMedia } from "../worker/media.mjs";
import { handleSongs } from "../worker/songs.mjs";
import { handleNowPlaying } from "../worker/nowplaying.mjs";
import { handleSpotify } from "../worker/spotify.mjs";
import { handleAdmin } from "../worker/admin.mjs";
import { handleFollows } from "../worker/follows.mjs";

const root = join(import.meta.dirname, "..");
const port = Number(process.argv[2] ?? process.env.PORT ?? 3020);
const serveFiles = createStatic(join(root, "dist"));
// ADMIN_KEY is the admin password for this local server only (at least 12 characters); without it the admin side answers "off", as live does.
// SPOTIFY_TOKEN_KEY is the key the Spotify logins are kept under (32 random bytes, base64). Here, without one, a throwaway key is made each time the
// server starts, so a login kept in the local database cannot be read after a restart (the page then asks to log in again).
const throwaway = Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64");
const env = { DB: localDatabase(process.env.FEEDBACK_DB ?? join(root, ".dev-feedback.sqlite")), ADMIN_KEY: process.env.ADMIN_KEY, SPOTIFY_TOKEN_KEY: process.env.SPOTIFY_TOKEN_KEY ?? throwaway };

createServer(async (req, res) => {
  const path = req.url?.split("?")[0] ?? "";
  if (path === "/api/songs") {
    const response = await handleSongs(new Request(`http://${req.headers.host}${req.url}`, { method: req.method }), { cache: null });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  if (path.startsWith("/api/follows/")) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const response = await handleFollows(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
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
  serveFiles(req, res);
}).listen(port, () => console.log(`Frills is at http://localhost:${port}/`));
