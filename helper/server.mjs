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
import { ALERT_AT, EULER_DEFAULT_CAP, Signing, capacity, deviceFacts, snapshot, statusPage } from "./status.mjs";
import { SlotAlerts, termuxNotifier } from "./alerts.mjs";
import { OWNER, ownerGate } from "./owner.mjs";
import { handleProStatus } from "../worker/region.mjs";
import { handleDevPass, handleTts } from "../worker/tts.mjs";
import { validTicketSecret, verifyRelayTicket } from "../worker/relay-ticket.mjs";

const VERSION = "0.7.4";
/** What this program can do, so a page can tell an old one ("chat" only) from one that sends alerts. */
const FEATURES = ["chat", "alerts", "info", "roles", "status", "viewers"];

const DIRECT_API_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.tiktok.com/",
};

/**
 * Clean single-shot direct TikTok `/api-live/user/room/` check (0 Euler calls).
 * Uses clean standard headers instead of `tiktok-live-connector`'s randomized outdated UA/region params,
 * returning `{ live, roomId, followers, viewers }` or throwing an error with `.status` on HTTP 403/429.
 */
export async function probeTikTokLiveDirect(uniqueId, { fetchImpl = globalThis.fetch?.bind(globalThis), timeoutMs = 10000 } = {}) {
  if (typeof fetchImpl !== "function") return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(
      `https://www.tiktok.com/api-live/user/room/?aid=1988&sourceType=54&uniqueId=${encodeURIComponent(uniqueId)}`,
      { method: "GET", headers: DIRECT_API_HEADERS, signal: ctrl.signal },
    );
    if (res.status === 403 || res.status === 429) {
      throw Object.assign(new Error(`TikTok /api-live/user/room/ returned HTTP ${res.status}`), { status: res.status });
    }
    if (!res.ok) throw Object.assign(new Error(`TikTok /api-live/user/room/ returned HTTP ${res.status}`), { status: res.status });
    const body = await res.json().catch(() => null);
    if (!body || typeof body !== "object") return null;
    if (body.statusCode === 19881007 || /user_not_found/i.test(String(body.message ?? ""))) {
      const err = new Error("TikTok doesn't know that name. Check the spelling.");
      err.name = "InvalidUniqueIdError";
      throw err;
    }
    const status = body?.data?.liveRoom?.status;
    const roomId = body?.data?.user?.roomId ? String(body.data.user.roomId) : "";
    const followers = Math.round(Number(body?.data?.stats?.followerCount ?? body?.data?.user?.stats?.followerCount ?? 0)) || 0;
    const viewers = Math.round(Number(body?.data?.liveRoom?.liveRoomStats?.userCount ?? 0)) || 0;
    if (status === 2 && roomId) return { live: true, roomId, followers, viewers };
    // HTTP 200 with status === 4, or HTTP 200 with no active roomId/liveRoom (account offline or has no live room)
    if (status === 4 || (!roomId && !body.statusCode)) return { live: false, roomId: "", followers, viewers: 0 };
    return { live: null, roomId, followers, viewers };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Configures `tiktok-live-connector` routes for minimal wasted traffic and single-account compliance:
 * - Always skips the dead HTML `SIGI_STATE` scrape (returns 1.4 KB JS challenge).
 * - Always keeps `IsLiveRouteConfig` Euler-free.
 * - Disables Euler's paid-only `/webcast/room_id` fallback by default (returns HTTP 403 on Free Euler plans);
 *   can be opted in via `EULER_ALLOW_ROOM_ID_FALLBACK=1` on Euler Business/Enterprise plans.
 */
export function configureConnectorRoutes(library, { allowEulerRoomIdFallback = false } = {}) {
  const skipRoomEuler = !allowEulerRoomIdFallback;
  if (library?.RoomIdRouteConfig) {
    library.RoomIdRouteConfig.skipFetchRoomInfoFromHtmlRoute = true;
    library.RoomIdRouteConfig.skipFetchRoomIdFromEulerRoute = skipRoomEuler;
  }
  if (library?.IsLiveRouteConfig) {
    library.IsLiveRouteConfig.skipFetchRoomInfoFromHtmlRoute = true;
    library.IsLiveRouteConfig.skipFetchRoomIdFromEulerRoute = true;
  }
  return { skipEulerRoomIdFallback: skipRoomEuler, skipHtmlScrape: true };
}

/**
 * Updates `tiktok-live-connector`'s global `SignConfig` and clears its cached Euler client whenever the key changes.
 */
export function syncConnectorSignKey(library, apiKey = "") {
  const cfg = library?.SignConfig;
  if (!cfg) return false;
  const next = String(apiKey ?? "").trim() || undefined;
  if (cfg.apiKey === next) return false;
  cfg.apiKey = next;
  cfg.cachedInstance = undefined;
  return true;
}

/** Makes a connection to TikTok for one account. The library is loaded only now, so everything else works (and is tested) without it. */
export async function realFactory(user, { apiKey, allowEulerRoomIdFallback = false } = {}) {
  let library;
  try {
    library = await import("tiktok-live-connector");
  } catch {
    const error = new Error("The TikTok connector isn't installed yet. Run: npm run tiktok:setup");
    error.name = "SetupError";
    throw error;
  }
  configureConnectorRoutes(library, { allowEulerRoomIdFallback });
  syncConnectorSignKey(library, apiKey);
  // processInitialData: false skips the little history TikTok sends on joining, so an overlay shows new chat only.
  const conn = new library.TikTokLiveConnection(user, { processInitialData: false, ...(apiKey ? { signApiKey: apiKey } : {}) });
  conn.checkLiveDirect = () => probeTikTokLiveDirect(conn.uniqueId);
  return conn;
}

/**
 * Reads the single compliant Euler Stream key (`EULER_API_KEY`; if legacy `EULER_API_KEYS` is present, uses ONLY the first key),
 * daily cap (`EULER_KEY_CAP`, default 1,500), optional daily reserve (`EULER_DAILY_RESERVE`, default 0), and room-ID fallback toggle.
 */
export function parseEulerConfig(env = process.env) {
  const explicit = String(env.EULER_API_KEY ?? "").trim();
  const legacyList = String(env.EULER_API_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const key = explicit || legacyList[0] || "";
  const ignoredExtraKeys = explicit
    ? [env.EULER_API_KEY_2, env.EULER_API_KEY_3].filter((s) => String(s ?? "").trim()).length
    : Math.max(0, legacyList.length - 1);
  const cap = Math.max(1, Number(env.EULER_KEY_CAP) || EULER_DEFAULT_CAP);
  const reserve = Math.max(0, Math.min(cap - 1, Math.round(Number(env.EULER_DAILY_RESERVE) || 0)));
  const allowEulerRoomIdFallback = env.EULER_ALLOW_ROOM_ID_FALLBACK === "1" || env.EULER_ALLOW_ROOM_ID_FALLBACK === "true";
  return { key, keys: key ? [key] : [], ignoredExtraKeys, cap, reserve, allowEulerRoomIdFallback };
}

/**
 * Builds the helper (nothing listens until listen() is called). `factory(user, { apiKey })` makes the connection to TikTok; tests pass a
 * pretend one. Anything else in `tuning` (waits, limits) goes to the Hub.
 *
 * `relay` turns it into the shared version: { origins: [the website's address], slots, maxPerIp, maxAccountsPerIp, trustProxy }. A relay
 * answers pages on those other addresses (the website), has `slots` spots and a line for them, limits how many streams (and how many
 * different accounts) one visitor address can hold open, and serves no site of its own unless a folder is given.
 */
export function createHelper({ distDir, factory = realFactory, apiKey = "", apiKeys = null, eulerCap = EULER_DEFAULT_CAP, eulerReserve = 0, allowEulerRoomIdFallback = false, log = () => {}, demoPace, relay = null, ...tuning } = {}) {
  // The one built-in account, frills_demo, never reaches TikTok: it makes up chat so the whole chain can be tested without a LIVE.
  const make = (user, options) => (user === DEMO_USER ? new DemoConnection({ pace: demoPace }) : factory(user, { allowEulerRoomIdFallback, ...options }));
  const singleKey = String(apiKey ?? "").trim().split(",")[0].trim()
    || (Array.isArray(apiKeys) ? apiKeys.map((k) => String(k ?? "").trim()).find(Boolean) ?? "" : "");
  const shared = relay
    ? {
        queue: true,
        connectAtOnce: 3,
        directGapMs: 3500,
        directBurst: 3,
        tiktokWaitMs: 30000,
        tiktokMaxMs: 180000,
        idleStopMs: 300000,
        offlineIdleStopMs: 45000,
        offlineWaitMs: 45000,
        offlineGiveUpMs: 14400000,
        offlineSlowSteps: [[600000, 120000], [1800000, 300000], [7200000, 600000]],
        wakeGapMs: 60000,
        silentMs: 300000,
        silentMaxMs: 1800000,
        maxRooms: relay.slots ?? 30,
      }
    : {};
  const ticketSecret = relay ? String(relay.ticketSecret ?? "").trim() : "";
  let hub = null;
  const signing = new Signing(Date.now, {
    key: singleKey,
    cap: eulerCap,
    reserve: eulerReserve,
    onBudgetPause: ({ reason, pauseUntil }) => {
      const until = pauseUntil ? new Date(pauseUntil).toISOString().slice(11, 16) + " UTC" : "quota reset";
      log(`Euler signing budget guard paused new connects (${reason}) until ${until}`);
    },
  });
  const startedAt = Date.now();
  hub = new Hub({
    factory: make,
    apiKey: () => signing.currentKey(),
    canSign: () => signing.canSign(),
    log,
    onLimited: () => signing.limitHit(),
    onSigned: (info) => signing.use(info),
    onOfflineSaved: () => signing.noteOfflineSaved(),
    onCacheHit: () => signing.noteCacheHit(),
    onBudgetBlocked: () => signing.noteBudgetBlocked(),
    ...shared,
    ...tuning,
  });
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
  const numbers = (local, owned = false) => {
    const stats = hub.stats();
    const estimate = capacity({ freeMem: os.freemem(), rss: process.memoryUsage().rss, baseRss, rooms: stats.used, cpuFraction });
    const streams = relay ? { open: openCount(), limit: maxPerIp, turnedAway: away.total, replaced: away.replaced, lastTurnedAwayS: away.lastAt ? Math.round((Date.now() - away.lastAt) / 1000) : null } : null;
    return snapshot({ stats, startedAt, now: Date.now(), version: VERSION, features: FEATURES, signing, estimate, streams, keyed: signing.hasKeys(), alertAt: relay?.alertAt ?? ALERT_AT, device: local ? deviceFacts(cpuFraction) : null, roster: local ? hub.roster() : null, ownerLogin: gate.enabled && !owned, actions: owned ? { restart: Boolean(relay?.restart) } : null });
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
  const json = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(JSON.stringify(body));
  };
  let restartAt = 0; // when the owner last asked for a restart
  const proEnv = {
    DEV: true,
    DB: null,
    OPENAI_TTS_KEY: process.env.OPENAI_TTS_KEY || "",
    GOOGLE_TTS_KEY: process.env.GOOGLE_TTS_KEY || "",
    GROQ_TTS_KEY: process.env.GROQ_TTS_KEY || "",
    PRO_DEV_KEY: process.env.PRO_DEV_KEY || "",
    PRO_COUNTRIES: process.env.PRO_COUNTRIES || "",
    REQUIRE_PRO_PASS: process.env.REQUIRE_PRO_PASS || "",
    LEMON_CHECKOUT_URL: process.env.LEMON_CHECKOUT_URL || "",
    LEMON_STORE_ID: process.env.LEMON_STORE_ID || "",
    LEMON_PRODUCT_ID: process.env.LEMON_PRODUCT_ID || "",
    LEMON_WEBHOOK_SECRET: process.env.LEMON_WEBHOOK_SECRET || "",
    LEMON_TEST_MODE: process.env.LEMON_TEST_MODE || "", // (off unless asked for: a test-mode payment is for a test setup only)
  };
  let dbInit = null;
  const ensureDb = async () => {
    if (proEnv.DB || dbInit) return dbInit;
    dbInit = import("../scripts/lib/d1-sqlite.mjs")
      .then(({ localDatabase }) => {
        const dbPath = process.env.FEEDBACK_DB ?? (existsSync(fileURLToPath(new URL("../scripts/serve.mjs", import.meta.url)))
          ? fileURLToPath(new URL("../.dev-feedback.sqlite", import.meta.url))
          : ":memory:");
        proEnv.DB = localDatabase(dbPath);
      })
      .catch(() => {});
    return dbInit;
  };

  const server = http.createServer(async (req, res) => {
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
    // Restarting the relay from the status page. It takes the owner's password in a header, like everything else of the owner's: a page on another site cannot send
    // that header without asking the relay's permission first, and the relay never gives it (it sends no CORS headers for this address).
    if (relay && url.pathname === "/owner/restart") {
      if (req.method !== "POST") return text(res, 405, "Use POST.", { Allow: "POST" });
      if (!gate.enabled) return json(res, 403, { ok: false, error: "no_owner_password" });
      const who = gate.check(req.headers.authorization, visitor(req));
      if (who === "locked") return json(res, 429, { ok: false, error: "locked" });
      if (who !== "ok") return json(res, 401, { ok: false, error: who === "wrong" ? "wrong_key" : "key_needed" });
      if (!relay.restart) return json(res, 409, { ok: false, error: "not_supervised" }); // nothing would start it again, so it stays up
      const now = Date.now();
      if (now - startedAt < (relay.minUptimeMs ?? 15000) || now - restartAt < (relay.restartGapMs ?? 30000)) return json(res, 429, { ok: false, error: "too_soon" });
      restartAt = now;
      log("a restart was asked for from the status page");
      res.on("finish", () => setTimeout(relay.restart, 250));
      return json(res, 200, { ok: true, restarting: true });
    }
    if (relay && url.pathname === "/owner/euler") {
      if (req.method !== "POST") return text(res, 405, "Use POST.", { Allow: "POST" });
      if (!onDevice) {
        if (!gate.enabled) return json(res, 403, { ok: false, error: "no_owner_password" });
        const who = gate.check(req.headers.authorization, visitor(req));
        if (who === "locked") return json(res, 429, { ok: false, error: "locked" });
        if (who !== "ok") return json(res, 401, { ok: false, error: who === "wrong" ? "wrong_key" : "key_needed" });
      }
      if (!signing.hasKeys()) return json(res, 409, { ok: false, error: "no_keys_configured" });
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return json(res, 400, { ok: false, error: "bad_json" }); }
      const action = body?.action;
      if (action === "refill") {
        const ok = signing.refillKey();
        if (ok) hub.clearBusy();
        return json(res, ok ? 200 : 400, { ok, action: "refill", quota: signing.quotaSummary(), pool: signing.poolSummary() });
      }
      if (action === "sync") {
        const quota = await signing.syncRemoteLimits();
        if (quota?.state === "active") hub.clearBusy();
        return json(res, quota ? 200 : 502, { ok: Boolean(quota), action: "sync", quota, pool: signing.poolSummary() });
      }
      return json(res, 400, { ok: false, error: "bad_action" });
    }
    let owner = onDevice;
    let proven = false; // the owner's password was sent and is right (being on the device is enough to see the names, not to restart it)
    if (relay && url.pathname === "/health" && !wantsPage) {
      const asked = gate.check(req.headers.authorization, visitor(req));
      if (asked === "wrong" || asked === "locked") {
        res.writeHead(asked === "wrong" ? 401 : 429, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...(asked === "locked" ? { "Retry-After": "600" } : {}), ...cors });
        return res.end(JSON.stringify({ ok: false, error: asked === "wrong" ? "wrong_key" : "locked" }));
      }
      owner = owner || asked === "ok";
      proven = asked === "ok";
    }
    if (wantsPage) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'" });
      res.end(statusPage(numbers(onDevice))); // a page load can't carry the password: the page asks again with it
    } else if (url.pathname === "/tiktok/ping" || (relay && url.pathname === "/health")) {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...cors });
      res.end(JSON.stringify(relay && url.pathname === "/health" ? numbers(owner, proven) : relay ? { ok: true, name: "frills-relay", version: VERSION, features: FEATURES, ...(ticketSecret ? { plus: true, auth: true } : {}), slots: hub.stats() } : { ok: true, name: "frills-helper", version: VERSION, features: FEATURES }));
    } else if (!relay && req.method === "GET" && url.pathname === "/api/account/me") {
      json(res, 200, { ok: true, signedIn: false });
    } else if (!relay && req.method === "GET" && url.pathname === "/api/cloud-overlays") {
      json(res, 200, { ok: true, signedIn: false, plusActive: false, eligible: false, overlays: [] });
    } else if (!relay && (url.pathname === "/api/pro/status" || url.pathname === "/api/pro/dev-pass" || url.pathname === "/api/tts")) {
      try {
        await ensureDb();
        const chunks = [];
        if (!["GET", "HEAD"].includes(req.method)) for await (const chunk of req) chunks.push(chunk);
        const request = new Request(`http://${req.headers.host || "127.0.0.1"}${req.url}`, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
        const response = await (
          url.pathname === "/api/pro/status"
            ? handleProStatus(request, proEnv)
            : url.pathname === "/api/pro/dev-pass"
              ? handleDevPass(request, proEnv)
              : handleTts(request, proEnv)
        );
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        json(res, 500, { ok: false, error: "tts_failed" });
      }
    } else if (url.pathname === "/tiktok/stream") {
      await stream(req, res, url, cors);
    } else {
      files(req, res);
    }
  });

  async function stream(req, res, url, cors) {
    if (relay && ticketSecret) {
      const checked = await verifyRelayTicket(url.searchParams.get("ticket") ?? "", ticketSecret);
      if (!checked.ok) {
        const error = checked.error === "expired" ? "ticket_expired" : "ticket_required";
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...cors });
        return res.end(JSON.stringify({ error, message: "This dedicated Frills Plus relay requires an active Frills Plus ticket." }));
      }
    }
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
      try { proEnv.DB?.raw?.close?.(); } catch { /* ignore */ }
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
  const ticketSecret = (process.env.RELAY_TICKET_SECRET ?? "").trim();
  if (ticketSecret && !validTicketSecret(ticketSecret)) {
    console.error("RELAY_TICKET_SECRET must be at least 16 characters.");
    process.exit(1);
  }
  // Something starts the relay again when it stops: the keeper that `npm run relay` runs (it sets RELAY_SUPERVISED), or systemd (it sets INVOCATION_ID).
  const supervised = Boolean(process.env.RELAY_SUPERVISED || process.env.INVOCATION_ID);
  const relay = { origins, slots, alertAt, ownerKey, ticketSecret, maxPerIp: numberOr(process.env.RELAY_PER_IP, 60), maxAccountsPerIp: numberOr(process.env.RELAY_ACCOUNTS_PER_IP, 12), trustProxy: process.env.RELAY_TRUST_PROXY !== "0" };
  const port = numberOr(process.argv.find((a) => a.startsWith("--port="))?.slice(7) ?? process.env.PORT, 8765);
  const bind = process.env.RELAY_BIND ?? "127.0.0.1"; // behind a tunnel nothing else may reach it
  const euler = parseEulerConfig(process.env);
  const helper = createHelper({ relay, apiKey: euler.key, eulerCap: euler.cap, eulerReserve: euler.reserve, allowEulerRoomIdFallback: euler.allowEulerRoomIdFallback, log: say });
  if (helper.signing.hasKeys()) {
    // Sync live Euler quota before opening the server so budget guards reflect real remaining requests immediately.
    await Promise.race([
      helper.signing.syncRemoteLimits(),
      new Promise((resolve) => setTimeout(resolve, 4000).unref?.()),
    ]).catch(() => {});
  }
  try {
    await helper.listen(port, bind);
  } catch (error) {
    console.error(error.code === "EADDRINUSE" ? `Port ${port} is already in use. Is the relay already running?` : `Couldn't start: ${error.message}`);
    process.exit(1);
  }
  import("tiktok-live-connector").catch(() => {}); // warm it up now: the first account to connect should not wait for the library to load
  const eulerDesc = euler.key
    ? `single compliant key configured (${euler.cap}/day cap${euler.reserve ? ` · ${euler.reserve} reserved` : ""} · Euler roomId fallback ${euler.allowEulerRoomIdFallback ? "ON" : "OFF (leak shield)"}${euler.ignoredExtraKeys ? ` · NOTE: ${euler.ignoredExtraKeys} extra key(s) in env ignored` : ""})`
    : "NOT set: the limits are shared with everyone, and TikTok will often be busy at night";
  console.log(`\nFrills relay ${VERSION} is running on ${bind}:${port}.\n  Spots: ${slots}. Allowed website addresses: ${origins.join(", ")}.\n  Status page: http://${bind}:${port}/health (open it in a browser)\n  Warns you when ${alertAt} spots or fewer are left${process.env.RELAY_ALERTS === "0" ? " (alerts are off)" : ""}.\n  Owner password (to see who is connected from your PC): ${ownerState(ownerKey)}.\n  Plus ticket lock (RELAY_TICKET_SECRET): ${ticketSecret ? "on (dedicated Frills Plus relay)" : "off (shared free relay)"}.\n  Signing service (EULER_API_KEY): ${eulerDesc}.\n  Pages one internet address may keep open: ${relay.maxPerIp} (RELAY_PER_IP), for at most ${relay.maxAccountsPerIp} different accounts (RELAY_ACCOUNTS_PER_IP).\n`);
  console.log(`  Restart from the status page: ${ownerKey && ownerKey.length >= OWNER.minKey ? (supervised ? "on" : "off (start the relay with npm run relay, or under systemd, so that something starts it again)") : "off (it needs the owner password)"}`);
  if (process.env.RELAY_ALERTS !== "0") {
    const alerts = new SlotAlerts({ stats: () => helper.hub.stats(), signing: helper.signing, alertAt, notify: termuxNotifier({ log: say }), log: say });
    alerts.start();
  }
  setInterval(() => {
    const s = helper.hub.stats();
    say(`spots ${s.used}/${s.max}, ${s.waiting} waiting`);
  }, 5 * 60000).unref();
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log("Stopping…");
    await helper.close();
    process.exit(0);
  };
  if (supervised) relay.restart = stop; // asked for from the owner's status page: it stops and is started again. Without a keeper it would just stay stopped.
  if (helper.signing.hasKeys()) {
    setInterval(() => {
      if (helper.signing.hasKeys()) helper.signing.syncRemoteLimits().catch(() => {});
    }, 5 * 60000).unref();
  }
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
  const euler = parseEulerConfig(process.env);
  const helper = createHelper({ distDir, apiKey: euler.key, eulerCap: euler.cap, eulerReserve: euler.reserve, allowEulerRoomIdFallback: euler.allowEulerRoomIdFallback, log: say });
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
