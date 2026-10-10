// The Frills helper:  npm run tiktok
// A small program for your own PC. It does two things:
//   1. serves the Frills site (the editor, the matcha page, the overlay for OBS) at http://127.0.0.1:8765/, and
//   2. reads TikTok LIVE chat for an account and hands it to those pages, so TikTok chat can appear in your overlay.
// It listens only on this computer. It reads public chat only: no TikTok login, no password, nothing is sent to Frills (there is no Frills
// server in this). TikTok, and the signing service its connector uses (Euler Stream), see your internet address and which account you
// watch, as they would for any viewer. Chat is held in memory just long enough to show it; nothing is written to disk.
//
// The same program can also run as a shared RELAY:  npm run relay
// That is the free hosted version for people who don't install anything: it answers the Frills website from another address, has a
// limited number of spots and a line for them, and keeps no chat (see createHelper's `relay` option).

import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createStatic } from "../scripts/lib/static.mjs";
import { cleanTikTokUser } from "../src/js/tiktok.js";
import { Hub } from "./rooms.mjs";
import { ALERT_KINDS } from "./map.mjs";
import { DEMO_USER, DemoConnection } from "./demo.mjs";

const VERSION = "0.2.0";
/** What this program can do, so a page can tell an old one ("chat" only) from one that sends alerts. */
const FEATURES = ["chat", "alerts"];

/** Makes a connection to TikTok for one account. The library is loaded only now, so everything else works (and is tested) without it. */
export async function realFactory(user, { apiKey } = {}) {
  let library;
  try {
    library = await import("tiktok-live-connector");
  } catch {
    const error = new Error("The TikTok connector isn't installed yet. Run: npm run tiktok:setup");
    error.name = "SetupError";
    throw error;
  }
  // processInitialData: false skips the little history TikTok sends on joining, so an overlay shows new chat only.
  return new library.TikTokLiveConnection(user, { processInitialData: false, ...(apiKey ? { signApiKey: apiKey } : {}) });
}

/**
 * Builds the helper (nothing listens until listen() is called). `factory(user, { apiKey })` makes the connection to TikTok; tests pass a
 * pretend one. Anything else in `tuning` (waits, limits) goes to the Hub.
 *
 * `relay` turns it into the shared version: { origins: [the website's address], slots, maxPerIp, trustProxy }. A relay answers pages on
 * those other addresses (the website), has `slots` spots and a line for them, limits how many streams one visitor address can hold open,
 * and serves no site of its own unless a folder is given.
 */
export function createHelper({ distDir, factory = realFactory, apiKey = "", log = () => {}, demoPace, relay = null, ...tuning } = {}) {
  // The one built-in account, frills_demo, never reaches TikTok: it makes up chat so the whole chain can be tested without a LIVE.
  const make = (user, options) => (user === DEMO_USER ? new DemoConnection({ pace: demoPace }) : factory(user, options));
  const shared = relay ? { queue: true, idleStopMs: 60000, offlineWaitMs: 60000, maxRooms: relay.slots ?? 30 } : {};
  const hub = new Hub({ factory: make, apiKey, log, ...shared, ...tuning });
  const nothing = (req, res) => {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found.");
  };
  const files = distDir ? createStatic(distDir) : nothing;
  const allowedOrigins = new Set((relay?.origins ?? []).map((o) => o.replace(/\/+$/, "")));
  const perIp = new Map(); // open streams per visitor address (relay only)
  const maxPerIp = relay?.maxPerIp ?? 8; // chat, alerts and the editor for one streamer are several open pages
  let hosts = new Set();
  let origins = new Set();

  /** Who is asking: behind Cloudflare's tunnel the real address is in a header, otherwise it is the connection's own. */
  const visitor = (req) => {
    const forwarded = relay?.trustProxy ? String(req.headers["cf-connecting-ip"] ?? req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
    return forwarded || req.socket.remoteAddress || "unknown";
  };
  const text = (res, status, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...headers });
    res.end(body);
  };

  const server = http.createServer((req, res) => {
    let cors = {};
    const url = new URL(req.url, "http://localhost");
    if (relay) {
      // Only the Frills website's own pages may use a relay from a browser. Other programs (no Origin) can ask, within the limits.
      // (Any site files a relay is given to serve, in tests, are not part of that.)
      const origin = req.headers.origin;
      if (origin && (url.pathname.startsWith("/tiktok/") || url.pathname === "/health")) {
        if (!allowedOrigins.has(origin)) return text(res, 403, "Not allowed.");
        cors = { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
      }
      if (req.method === "OPTIONS") return text(res, 204, "", { ...cors, "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "600" });
    } else {
      // Only pages from this very address may talk to us. A web page on the internet can make a browser send a request to 127.0.0.1
      // (or trick the name lookup into pointing at it), so the Host and Origin are checked on every request.
      if (!hosts.has(String(req.headers.host ?? "").toLowerCase())) return text(res, 421, "Open this from the address the Frills helper printed.");
      if (req.headers.origin && !origins.has(req.headers.origin)) return text(res, 403, "Not allowed.");
    }
    if (url.pathname === "/tiktok/ping" || (relay && url.pathname === "/health")) {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...cors });
      res.end(JSON.stringify(relay ? { ok: true, name: "frills-relay", version: VERSION, features: FEATURES, slots: hub.stats() } : { ok: true, name: "frills-helper", version: VERSION, features: FEATURES }));
    } else if (url.pathname === "/tiktok/stream") {
      stream(req, res, url, cors);
    } else {
      files(req, res);
    }
  });

  function stream(req, res, url, cors) {
    const user = cleanTikTokUser(url.searchParams.get("user"));
    if (!user) return text(res, 400, "That is not a TikTok name.", cors);
    const who = relay ? visitor(req) : "";
    if (relay && (perIp.get(who) ?? 0) >= maxPerIp) return text(res, 429, "Too many open streams from your address.", cors);
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
      ...cors,
    });
    res.on("error", () => {}); // a page that has gone away mid-write is not worth stopping for
    res.write("retry: 3000\n\n");
    const events = new Set((url.searchParams.get("events") ?? "").split(",").filter((kind) => ALERT_KINDS.includes(kind)));
    const client = { events, send: (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) };
    const room = hub.subscribe(user, client);
    if (!room) {
      res.end(); // too many accounts at once: the page has been told why
      return;
    }
    if (relay) perIp.set(who, (perIp.get(who) ?? 0) + 1);
    const beat = setInterval(() => res.write(": ping\n\n"), 15000); // so a page can tell a quiet chat from a dead connection
    res.on("close", () => {
      clearInterval(beat);
      if (relay) perIp.set(who, Math.max(0, (perIp.get(who) ?? 1) - 1));
      room.remove(client);
    });
  }

  return {
    server,
    hub,
    /** Starts listening, on this computer only unless a relay is told to bind elsewhere. Resolves with the port. */
    listen(port = 8765, bind = "127.0.0.1") {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, bind, () => {
          const actual = server.address().port;
          hosts = new Set([`127.0.0.1:${actual}`, `localhost:${actual}`]);
          origins = new Set([`http://127.0.0.1:${actual}`, `http://localhost:${actual}`]);
          resolve(actual);
        });
      });
    },
    close() {
      hub.closeAll();
      server.closeAllConnections?.();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

// ── Running it ────────────────────────────────────────────────────────────────────────────────────────────────────────────
function openInBrowser(url) {
  const [command, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(command, args, { stdio: "ignore", detached: true }).unref();
  } catch { /* the address is printed anyway */ }
}

const stamp = () => new Date().toLocaleTimeString("en-GB");
const say = (line) => console.log(`[${stamp()}] ${line}`);

/** The shared relay: settings come from the environment so a phone or a server can be set up once and left alone. */
async function mainRelay() {
  const numberOr = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback);
  const origins = (process.env.RELAY_ORIGINS ?? "https://frills.valwidgets.live").split(",").map((o) => o.trim()).filter(Boolean);
  const slots = numberOr(process.env.RELAY_SLOTS, 30);
  const relay = { origins, slots, maxPerIp: numberOr(process.env.RELAY_PER_IP, 8), trustProxy: process.env.RELAY_TRUST_PROXY !== "0" };
  const port = numberOr(process.argv.find((a) => a.startsWith("--port="))?.slice(7) ?? process.env.PORT, 8765);
  const bind = process.env.RELAY_BIND ?? "127.0.0.1"; // behind a tunnel nothing else may reach it
  const helper = createHelper({ relay, apiKey: (process.env.EULER_API_KEY ?? "").trim(), log: say });
  try {
    await helper.listen(port, bind);
  } catch (error) {
    console.error(error.code === "EADDRINUSE" ? `Port ${port} is already in use. Is the relay already running?` : `Couldn't start: ${error.message}`);
    process.exit(1);
  }
  console.log(`\nFrills relay ${VERSION} is running on ${bind}:${port}.\n  Spots: ${slots}. Allowed website addresses: ${origins.join(", ")}.\n  Health: http://${bind}:${port}/health\n`);
  setInterval(() => {
    const s = helper.hub.stats();
    say(`spots ${s.used}/${s.max}, ${s.waiting} waiting`);
  }, 5 * 60000).unref();
  const stop = async () => {
    console.log("Stopping…");
    await helper.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

async function main() {
  const distDir = fileURLToPath(new URL("../dist", import.meta.url));
  if (!existsSync(join(distDir, "index.html"))) {
    console.error("The site hasn't been built yet. Run: npm run tiktok   (it builds first)");
    process.exit(1);
  }
  const portArg = process.argv.find((a) => a.startsWith("--port="));
  const wanted = Number(portArg?.slice(7) ?? process.env.PORT ?? 8765);
  const helper = createHelper({ distDir, apiKey: (process.env.EULER_API_KEY ?? "").trim(), log: say });
  let port;
  try {
    port = await helper.listen(wanted);
  } catch (error) {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${wanted} is already in use. Is the Frills helper already running in another window?\nTo use a different port, run:  npm run tiktok -- --port=8766`);
    } else {
      console.error(`Couldn't start: ${error.message}`);
    }
    process.exit(1);
  }
  const base = `http://127.0.0.1:${port}`;
  console.log(`
Frills helper ${VERSION} is running.

  Editor (pick a look, connect TikTok):  ${base}/editor/
  Matcha styles:                         ${base}/matcha/

Leave this window open while you stream. Press Ctrl+C to stop.
It reads public TikTok chat only, with no TikTok login. TikTok and its signing service (Euler Stream)
can see your internet address and which account you watch, like any viewer. Nothing goes to Frills.
`);
  if (!process.argv.includes("--no-open") && !process.env.FRILLS_NO_OPEN) openInBrowser(`${base}/editor/`);
  process.on("SIGINT", async () => {
    console.log("\nStopping…");
    await helper.close();
    process.exit(0);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) (process.argv.includes("--relay") || process.env.FRILLS_RELAY ? mainRelay : main)();
