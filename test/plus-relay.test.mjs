// Dedicated Frills Plus DigitalOcean relay tests:
//   1. Stateless HMAC-SHA256 ticket signing & constant-time verification (valid, expired, tampered, wrong secret)
//   2. POST /api/plus/relay-ticket (cookie & overlay code, region lock + PRO_ALLOW_IPS, does NOT spend AI voice chars)
//   3. Live relay server enforcement (RELAY_TICKET_SECRET rejects 401 without valid ticket, streams SSE with valid ticket)
//   4. Client routing in connectTo (free user never calls ticket endpoint; Plus user routes to Plus relay and falls back cleanly on failure)

import test from "node:test";
import assert from "node:assert/strict";
import { signRelayTicket, verifyRelayTicket } from "../worker/relay-ticket.mjs";
import { handlePlusRelayTicket } from "../worker/plus-relay.mjs";
import { COOKIE, handleAccount } from "../worker/account-routes.mjs";
import { makeOverlayLink } from "../worker/overlay-links.mjs";
import { createHelper } from "../helper/server.mjs";
import { connectTo } from "../src/js/connect.js";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";

const SITE = "https://frills.valwidgets.live";
const SECRET = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const T0 = Date.parse("2026-12-01T12:00:00Z");
const DAY = 86_400_000;

const reqWithCf = (url, init = {}, country = "US") => {
  const req = new Request(url, init);
  Object.defineProperty(req, "cf", { value: { country }, configurable: true });
  return req;
};

async function createPlusAccount(env, email = "plus@example.com", { status = "active", renews = T0 + 30 * DAY } = {}) {
  const sent = [];
  const mailer = { send: async (m) => { sent.push(m); return { ok: true }; } };
  await handleAccount(new Request(`${SITE}/api/account/login`, { method: "POST", headers: { origin: SITE, "content-type": "application/json", "cf-connecting-ip": "203.0.113.5" }, body: JSON.stringify({ email }) }), env, { now: T0, mailer });
  const verified = await handleAccount(new Request(`${SITE}/api/account/verify`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: JSON.stringify({ token: /#([A-Za-z0-9_-]{43})/.exec(sent[0].text)[1] }) }), env, { now: T0 + 1000 });
  const id = env.DB.raw.prepare("SELECT id FROM accounts WHERE email = ?").get(email).id;
  if (status) {
    env.DB.raw.prepare("INSERT OR REPLACE INTO plus (account_id, provider_ref, order_ref, status, renews_at, tts_used, tts_limit, period_start, updated_at) VALUES (?, 'sub_1', 'ord_1', ?, ?, 0, 150000, ?, ?)").run(id, status, renews, T0, T0);
  }
  const code = await makeOverlayLink(env.DB, id, "tts", { now: T0 + 2000 });
  const cookie = `${COOKIE}=${/frills_session=([^;]*)/.exec(verified.headers.get("set-cookie"))[1]}`;
  return { id, code, cookie };
}

test("relay tickets: valid signature passes, expired / tampered / wrong-secret / missing fail", async () => {
  const signed = await signRelayTicket(SECRET, { now: T0, ttlMs: 60_000 });
  assert.ok(signed && signed.ticket && signed.expiresAt === T0 + 60_000);
  assert.deepEqual(await verifyRelayTicket(signed.ticket, SECRET, { now: T0 + 5_000 }), { ok: true, expiresAt: T0 + 60_000 });
  assert.deepEqual(await verifyRelayTicket(signed.ticket, SECRET, { now: T0 + 60_000 }), { ok: false, error: "expired" });
  assert.deepEqual(await verifyRelayTicket(signed.ticket, "different-secret-0123456789abcdef", { now: T0 + 5_000 }), { ok: false, error: "bad_sig" });
  const tampered = signed.ticket.slice(0, -1) + (signed.ticket.endsWith("0") ? "1" : "0");
  assert.deepEqual(await verifyRelayTicket(tampered, SECRET, { now: T0 + 5_000 }), { ok: false, error: "bad_sig" });
  assert.deepEqual(await verifyRelayTicket("", SECRET, { now: T0 }), { ok: false, error: "missing" });
  assert.deepEqual(await verifyRelayTicket("junk", SECRET, { now: T0 }), { ok: false, error: "bad_format" });
  assert.equal(await signRelayTicket("too-short"), null);
});

test("POST /api/plus/relay-ticket: enforces Plus, region + PRO_ALLOW_IPS, returns signed ticket without spending AI voice chars", async () => {
  const env = {
    DB: localDatabase(":memory:"),
    PLUS_RELAY_SECRET: SECRET,
    PLUS_RELAY_URL: "https://plus-relay.valwidgets.live",
    PRO_ALLOW_IPS: "198.51.100.42",
  };
  const active = await createPlusAccount(env, "active@example.com");
  const free = await createPlusAccount(env, "free@example.com", { status: "" });
  const ended = await createPlusAccount(env, "ended@example.com", { status: "refunded" });

  const ask = (body, { country = "US", headers = {} } = {}, customEnv = env) =>
    handlePlusRelayTicket(reqWithCf(`${SITE}/api/plus/relay-ticket`, {
      method: "POST",
      headers: { origin: SITE, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }, country), customEnv, { now: T0 + 5000 });

  // Unconfigured secret returns 503 plus_relay_off
  const off = await ask({ code: active.code }, {}, { ...env, PLUS_RELAY_SECRET: "" });
  assert.deepEqual([off.status, (await off.json()).error], [503, "plus_relay_off"]);

  // Free visitor / non-Plus / refunded refused
  assert.deepEqual([(await ask({})).status, (await (await ask({})).json()).error], [401, "no_pass"]);
  assert.deepEqual([(await ask({}, { headers: { cookie: free.cookie } })).status, (await (await ask({}, { headers: { cookie: free.cookie } })).json()).error], [401, "invalid_pass"]);
  assert.deepEqual([(await ask({ code: ended.code })).status, (await (await ask({ code: ended.code })).json()).error], [401, "invalid_pass"]);

  // Region lock enforced unless IP is in PRO_ALLOW_IPS
  const phBlocked = await ask({ code: active.code }, { country: "PH", headers: { "cf-connecting-ip": "198.51.100.99" } });
  assert.deepEqual([phBlocked.status, (await phBlocked.json()).error], [403, "region_unavailable"]);
  const phOwner = await ask({ code: active.code }, { country: "PH", headers: { "cf-connecting-ip": "198.51.100.42" } });
  assert.equal(phOwner.status, 200);

  // Active Plus via overlay code gets a valid verifiable ticket and spends 0 AI voice characters
  const ok = await ask({ code: active.code });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.ok, true);
  assert.equal(body.url, "https://plus-relay.valwidgets.live");
  const verified = await verifyRelayTicket(body.ticket, SECRET, { now: T0 + 6000 });
  assert.equal(verified.ok, true);
  assert.equal(env.DB.raw.prepare("SELECT tts_used FROM plus WHERE account_id = ?").get(active.id).tts_used, 0, "relay ticket does not consume AI voice allowance");
});

test("live DigitalOcean relay with RELAY_TICKET_SECRET rejects 401 without valid ticket and streams SSE with valid ticket", async () => {
  const helper = createHelper({
    relay: { origins: [SITE], slots: 10, ticketSecret: SECRET },
    demoPace: 20,
  });
  const port = await helper.listen(0);
  const base = `http://127.0.0.1:${port}`;
  try {
    const ping = await (await fetch(`${base}/tiktok/ping`, { headers: { origin: SITE } })).json();
    assert.equal(ping.ok, true);
    assert.equal(ping.plus, true);
    assert.equal(ping.auth, true);

    // Missing ticket -> 401
    const noTicket = await fetch(`${base}/tiktok/stream?user=frills_demo`, { headers: { origin: SITE } });
    assert.equal(noTicket.status, 401);
    assert.equal((await noTicket.json()).error, "ticket_required");

    // Expired ticket -> 401 ticket_expired
    const expired = await signRelayTicket(SECRET, { now: Date.now() - 120_000, ttlMs: 30_000 });
    const expRes = await fetch(`${base}/tiktok/stream?user=frills_demo&ticket=${expired.ticket}`, { headers: { origin: SITE } });
    assert.equal(expRes.status, 401);
    assert.equal((await expRes.json()).error, "ticket_expired");

    // Valid ticket -> 200 SSE stream with real demo events
    const good = await signRelayTicket(SECRET);
    const ac = new AbortController();
    const okRes = await fetch(`${base}/tiktok/stream?user=frills_demo&ticket=${good.ticket}`, { headers: { origin: SITE }, signal: ac.signal });
    assert.equal(okRes.status, 200);
    assert.match(okRes.headers.get("content-type"), /text\/event-stream/);
    const reader = okRes.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /retry: 3000/);
    ac.abort();
  } finally {
    await helper.close();
  }
});

test("connectTo: free users skip ticket endpoint; Plus users connect to Plus relay and fall back cleanly to free relay on failure", async () => {
  const opened = [];
  const makeFakeES = (failFirst = false) => {
    let n = 0;
    return (url) => {
      opened.push(url);
      const listeners = {};
      const es = {
        url,
        readyState: 1,
        addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
        close() { es.readyState = 2; },
      };
      const mine = ++n;
      queueMicrotask(() => {
        if (failFirst && mine === 1) {
          es.readyState = 2;
          es.onerror?.();
        }
      });
      return es;
    };
  };

  // 1. Free user (no plusCode) -> fetchTicket is NEVER called
  let ticketCalls = 0;
  const freeConn = connectTo([], "tiktok", "demo", () => {}, {
    relay: "https://relay.valwidgets.live",
    plusRelay: "https://plus-relay.valwidgets.live",
    plusCode: "",
    assumeRelay: true,
    fetchTicket: async () => { ticketCalls += 1; return null; },
    eventSourceFactory: makeFakeES(false),
  });
  await new Promise((r) => setTimeout(r, 20));
  freeConn.stop();
  assert.equal(ticketCalls, 0);
  assert.equal(opened.length, 1);
  assert.ok(opened[0].startsWith("https://relay.valwidgets.live/tiktok/stream?"));

  // 2. Plus user -> connects to Plus relay with ticket; if Plus relay refuses/fails on first try, falls back silently to free relay
  opened.length = 0;
  const code = "0123456789abcdef0123456789abcdef";
  const plusConn = connectTo([], "tiktok", "demo", () => {}, {
    relay: "https://relay.valwidgets.live",
    plusRelay: "https://plus-relay.valwidgets.live",
    plusCode: code,
    assumeRelay: true,
    fetchTicket: async () => ({ url: "https://plus-relay.valwidgets.live", ticket: "abc.def.123", expiresAt: Date.now() + 600_000 }),
    eventSourceFactory: makeFakeES(true),
  });
  await new Promise((r) => setTimeout(r, 40));
  plusConn.stop();
  assert.equal(opened.length, 2, "first tried Plus relay, then fell back to free relay");
  assert.ok(opened[0].startsWith("https://plus-relay.valwidgets.live/tiktok/stream?") && opened[0].includes("ticket=abc.def.123"));
  assert.ok(opened[1].startsWith("https://relay.valwidgets.live/tiktok/stream?") && !opened[1].includes("ticket="));
});
