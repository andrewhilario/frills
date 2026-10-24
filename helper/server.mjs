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
import os from "node:os";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createStatic } from "../scripts/lib/static.mjs";
import { cleanTikTokUser } from "../src/js/tiktok.js";
import { Hub } from "./rooms.mjs";
import { ALERT_KINDS } from "./map.mjs";
import { DEMO_USER, DemoConnection } from "./demo.mjs";
import { ALERT_AT, Signing, capacity, deviceFacts, snapshot, statusPage } from "./status.mjs";
import { SlotAlerts, termuxNotifier } from "./alerts.mjs";
import { OWNER, ownerGate } from "./owner.mjs";

const VERSION = "0.5.5";
/** What this program can do, so a page can tell an old one ("chat" only) from one that sends alerts. */
const FEATURES = ["chat", "alerts", "info", "roles", "status"];

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
 * `relay` turns it into the shared version: { origins: [the website's address], slots, maxPerIp, maxAccountsPerIp, trustProxy }. A relay
 * answers pages on those other addresses (the website), has `slots` spots and a line for them, limits how many streams (and how many
 * different accounts) one visitor address can hold open, and serves no site of its own unless a folder is given.
 */
export function createHelper({ distDir, factory = realFactory, apiKey = "", log = () => {}, demoPace, relay = null, ...tuning } = {}) {
  // The one built-in account, frills_demo, never reaches TikTok: it makes up chat so the whole chain can be tested without a LIVE.
  const make = (user, options) => (user === DEMO_USER ? new DemoConnection({ pace: demoPace }) : factory(user, options));
  // Each connect to TikTok costs a request to the free signing service (a few thousand a day at most), so a shared relay keeps an account
  // for 10 minutes after its last page leaves (coming back is free). It looks for an offline account every 20 seconds for the first 3 minutes (the time
  // when a streamer has just opened OBS and is about to go LIVE), every minute until half an hour, every 3 minutes until 3 hours, then every 10 minutes.
  // A look at an account that is not LIVE only asks TikTok's own pages (measured with the connector we use: two requests, about 0.9 s, and none to the
  // signing service, which is asked once, when the LIVE is found), so looking often is cheap. It never gives up while a page is listening: an overlay in
  // OBS has no button to press, so one that was given up on stayed blank until someone reloaded it. A page that opens meanwhile makes it look at once
  // (Room.add).
  const shared = relay ? { queue: true, idleStopMs: 600000, offlineWaitMs: 20000, offlineGiveUpMs: 0, offlineSlowSteps: [[180000, 60000], [1800000, 180000], [10800000, 600000]], maxRooms: relay.slots ?? 30 } : {};
  const signing = new Signing();
  const startedAt = Date.now();
  const hub = new Hub({ factory: make, apiKey, log, onLimited: () => signing.note(), ...shared, ...tuning });
  // what this program costs the device, measured now and then, for the capacity guess on the status page
  const baseRss = process.memoryUsage().rss;
  let cpuFraction = 0;
  let lastCpu = { at: Date.now(), used: process.cpuUsage() };
  const sample = () => {
    const at = Date.now();
    const used = process.cpuUsage();
    const wall = (at - lastCpu.at) * 1000; // microseconds
    if (wall > 0) cpuFraction = Math.min(1, ((used.user - lastCpu.used.user) + (used.system - lastCpu.used.system)) / wall);
    lastCpu = { at, used };
  };
  const sampler = setInterval(sample, 10000);
  sampler.unref?.();
  const gate = ownerGate(relay?.ownerKey); // the owner's password, to see the names from anywhere
  const numbers = (local) => {
    const stats = hub.stats();
    const estimate = capacity({ freeMem: os.freemem(), rss: process.memoryUsage().rss, baseRss, rooms: stats.used, cpuFraction });
    const streams = relay ? { open: openCount(), limit: maxPerIp, turnedAway: away.total, replaced: away.replaced, lastTurnedAwayS: away.lastAt ? Math.round((Date.now() - away.lastAt) / 1000) : null } : null;
    return snapshot({ stats, startedAt, now: Date.now(), version: VERSION, features: FEATURES, signing, estimate, streams, alertAt: relay?.alertAt ?? ALERT_AT, device: local ? deviceFacts(cpuFraction) : null, roster: local ? hub.roster() : null, ownerLogin: gate.enabled && !local });
  };
  const nothing = (req, res) => {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found.");
  };
  const files = distDir ? createStatic(distDir) : nothing;
  const allowedOrigins = new Set((relay?.origins ?? []).map((o) => o.replace(/\/+$/, "")));
  // The streams each visitor address holds open (relay only), each { user, page, end() }. A streamer's chat, alerts, last gifts, goals and top likers
  // in OBS, plus the editors they have open, are many pages at once, and some internet providers put many homes behind one address, so the limit is
  // generous: it is there to stop one address from running away, not to count a streamer's own pages. How many different accounts one address can watch
  // is limited too, so that it cannot fill the spots.
  const open = new Map();
  const maxPerIp = relay?.maxPerIp ?? 60;
  const maxAccountsPerIp = relay?.maxAccountsPerIp ?? 12;
  const away = { total: 0, replaced: 0, lastAt: 0 }; // how often a page was turned away or replaced its own earlier stream, for the status page (numbers only)
  const PAGE_ID = /^[A-Za-z0-9_-]{8,40}$/;
  const openCount = () => { let n = 0; for (const set of open.values()) n += set.size; return n; };
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
    // The relay's own address in a browser is a readable page; a program (or the page itself, asking again) gets the numbers as JSON.
    const accept = String(req.headers.accept ?? "");
    const wantsPage = Boolean(relay) && (url.pathname === "/" || url.pathname === "/health") && accept.includes("text/html") && !accept.includes("application/json");
    // The device's details and the names of who is connected: for someone on the device itself, or anyone who sends the owner's password.
    // Everyone else gets only the numbers.
    const onDevice = !req.headers["cf-connecting-ip"] && !req.headers["x-forwarded-for"];
    let owner = onDevice;
    if (relay && url.pathname === "/health" && !wantsPage) {
      const asked = gate.check(req.headers.authorization, visitor(req));
      if (asked === "wrong" || asked === "locked") {
        res.writeHead(asked === "wrong" ? 401 : 429, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...(asked === "locked" ? { "Retry-After": "600" } : {}), ...cors });
        return res.end(JSON.stringify({ ok: false, error: asked === "wrong" ? "wrong_key" : "locked" }));
      }
      owner = owner || asked === "ok";
    }
    if (wantsPage) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'" });
      res.end(statusPage(numbers(onDevice))); // a page load can't carry the password: the page asks again with it
    } else if (url.pathname === "/tiktok/ping" || (relay && url.pathname === "/health")) {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...cors });
      res.end(JSON.stringify(relay && url.pathname === "/health" ? numbers(owner) : relay ? { ok: true, name: "frills-relay", version: VERSION, features: FEATURES, slots: hub.stats() } : { ok: true, name: "frills-helper", version: VERSION, features: FEATURES }));
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
    const asked = url.searchParams.get("page") ?? "";
    const page = PAGE_ID.test(asked) ? asked : "";
    const held = relay ? (open.get(who) ?? new Set()) : null;
    if (held) {
      // A page that opens a new stream after its connection dropped says which page it is (`page`). The stream it left behind may still look open
      // here for as long as the network takes to give up on it (a connection that dies without a word is not noticed for many minutes), so that
      // one is replaced at once instead of counting against the limit.
      if (page) {
        for (const earlier of [...held]) {
          if (earlier.page !== page) continue;
          away.replaced += 1;
          log(`@${earlier.user}: a page came back; its earlier stream was replaced`);
          earlier.end();
        }
      }
      const accounts = new Set([...held].map((s) => s.user));
      const full = held.size >= maxPerIp ? "pages" : !accounts.has(user) && accounts.size >= maxAccountsPerIp ? "accounts" : "";
      if (full) {
        away.total += 1;
        away.lastAt = Date.now();
        log(full === "pages" ? `@${user}: a page was turned away (${held.size} pages are already open from its address)` : `@${user}: a page was turned away (pages for ${accounts.size} different accounts are already open from its address)`);
        // The page reads this (it is allowed to), so it can tell the person what is wrong instead of a vague "busy".
        // It says why in plain words (`message`), which the page shows as it is, so the wording can change here without changing the website.
        const why = full === "pages"
          ? { error: "too_many_pages", open: held.size, limit: maxPerIp, message: `Too many Frills pages are open from your internet address (this relay allows ${maxPerIp}), so this one is waiting its turn. Close Frills tabs you are not using, or wait: pages left behind by a dropped connection clear by themselves. Trying again…` }
          : { error: "too_many_accounts", open: accounts.size, limit: maxAccountsPerIp, message: `This relay is already watching ${maxAccountsPerIp} different TikTok accounts from your internet address, so this one is waiting its turn. Trying again…` };
        res.writeHead(429, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "30", "X-Content-Type-Options": "nosniff", ...cors });
        return res.end(JSON.stringify(why));
      }
    }
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
    const kinds = events.size ? [...events].join("+") : "chat"; // which kind of page it is: chat, or the alerts it asked for
    let beat = 0;
    let released = false;
    const release = () => {
      if (released) return; // a stream can be let go twice (replaced, then closed): once is enough
      released = true;
      clearInterval(beat);
      if (held) {
        held.delete(record);
        if (!held.size && open.get(who) === held) open.delete(who);
      }
      room.remove(client);
      if (relay) log(`@${user}: a page left (${kinds}), ${room.clients.size} open`);
    };
    const record = { user, page, end() { release(); res.end(); } };
    if (held) {
      if (!open.has(who)) open.set(who, held);
      held.add(record);
    }
    if (relay) log(`@${user}: a page connected (${kinds}), ${room.clients.size} open`);
    beat = setInterval(() => res.write("event: beat\ndata: {}\n\n"), tuning.beatMs ?? 15000); // so a page can tell a quiet chat from a dead connection (an event, because a page cannot see a comment)
    res.on("close", release);
  }

  return {
    server,
    hub,
    signing,
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

/** One plain line for the start-up message: is the owner password on, and if not, why. Never prints the password itself. */
function ownerState(key) {
  if (key === undefined || key === "") return "not set (RELAY_OWNER_KEY); the names show only on this phone";
  if (key.length < OWNER.minKey) return `NOT USED: it has ${key.length} characters and needs at least ${OWNER.minKey}`;
  return "on";
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
  const alertAt = Number.isFinite(Number(process.env.RELAY_ALERT_SPOTS)) && process.env.RELAY_ALERT_SPOTS !== undefined && process.env.RELAY_ALERT_SPOTS !== "" ? Math.max(0, Number(process.env.RELAY_ALERT_SPOTS)) : 10;
  const ownerKey = process.env.RELAY_OWNER_KEY;
  const relay = { origins, slots, alertAt, ownerKey, maxPerIp: numberOr(process.env.RELAY_PER_IP, 60), maxAccountsPerIp: numberOr(process.env.RELAY_ACCOUNTS_PER_IP, 12), trustProxy: process.env.RELAY_TRUST_PROXY !== "0" };
  const port = numberOr(process.argv.find((a) => a.startsWith("--port="))?.slice(7) ?? process.env.PORT, 8765);
  const bind = process.env.RELAY_BIND ?? "127.0.0.1"; // behind a tunnel nothing else may reach it
  const helper = createHelper({ relay, apiKey: (process.env.EULER_API_KEY ?? "").trim(), log: say });
  try {
    await helper.listen(port, bind);
  } catch (error) {
    console.error(error.code === "EADDRINUSE" ? `Port ${port} is already in use. Is the relay already running?` : `Couldn't start: ${error.message}`);
    process.exit(1);
  }
  import("tiktok-live-connector").catch(() => {}); // warm it up now: the first account to connect should not wait for the library to load
  console.log(`\nFrills relay ${VERSION} is running on ${bind}:${port}.\n  Spots: ${slots}. Allowed website addresses: ${origins.join(", ")}.\n  Status page: http://${bind}:${port}/health (open it in a browser)\n  Warns you when ${alertAt} spots or fewer are left${process.env.RELAY_ALERTS === "0" ? " (alerts are off)" : ""}.\n  Owner password (to see who is connected from your PC): ${ownerState(ownerKey)}.\n  Pages one internet address may keep open: ${relay.maxPerIp} (RELAY_PER_IP), for at most ${relay.maxAccountsPerIp} different accounts (RELAY_ACCOUNTS_PER_IP).\n`);
  if (process.env.RELAY_ALERTS !== "0") {
    const alerts = new SlotAlerts({ stats: () => helper.hub.stats(), signing: helper.signing, alertAt, notify: termuxNotifier({ log: say }), log: say });
    alerts.start();
  }
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
