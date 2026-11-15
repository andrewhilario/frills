// The AI voice route and the region rule (worker/tts.mjs, worker/region.mjs), over a real in-memory SQLite database with the real schema: the region list and the owner's override, who may ask
// (an account with Frills Plus, never a key), the credits being spent, the local-development helper that gives a signed-in test account a few credits, the provider calls (OpenAI, Google, Groq), and
// that the older license-key way in is gone. The gate's own cases (every kind of visitor) are in plus-gate.test.mjs; the payment notices are in plus-webhook.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";
import { COOKIE, handleAccount } from "../worker/account-routes.mjs";
import { checkProRegion, handleProStatus, regionOf } from "../worker/region.mjs";
import { handleDevPass, handleTts } from "../worker/tts.mjs";
import { handleAdmin } from "../worker/admin.mjs";
import worker from "../worker/index.mjs";
import { verifyLemonSignature } from "../worker/plus-webhook.mjs";

const SITE = "https://frills.example";
const LOCAL = "http://127.0.0.1:3020";
const T0 = Date.parse("2026-12-01T12:00:00Z");
const DAY = 86_400_000;

const reqWithCf = (url, init = {}, country) => {
  const req = new Request(url, init);
  if (country !== undefined) req.cf = { country };
  return req;
};

/** A signed-in account: its id and the cookie of a browser signed in as it. */
async function signedIn(env, email = "streamer@example.com", site = SITE) {
  const sent = [];
  const mailer = { send: async (m) => { sent.push(m); return { ok: true }; } };
  await handleAccount(new Request(`${site}/api/account/login`, { method: "POST", headers: { origin: site, "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify({ email }) }), env, { now: T0, mailer });
  const verified = await handleAccount(new Request(`${site}/api/account/verify`, { method: "POST", headers: { origin: site, "content-type": "application/json" }, body: JSON.stringify({ token: /#([A-Za-z0-9_-]{43})/.exec(sent[0].text)[1] }) }), env, { now: T0 + 1000 });
  return { id: env.DB.raw.prepare("SELECT id FROM accounts WHERE email = ?").get(email).id, cookie: `${COOKIE}=${/frills_session=([^;]*)/.exec(verified.headers.get("set-cookie"))[1]}` };
}
const give = (env, accountId, { used = 0, limit = 5 } = {}) =>
  env.DB.raw.prepare("INSERT OR REPLACE INTO plus (account_id, provider_ref, order_ref, status, renews_at, tts_used, tts_limit, period_start, updated_at) VALUES (?, '1001', '2001', 'active', ?, ?, ?, ?, ?)").run(accountId, T0 + 30 * DAY, used, limit, T0, T0);
const creditsUsed = (env, accountId) => env.DB.raw.prepare("SELECT tts_used FROM plus WHERE account_id = ?").get(accountId)?.tts_used;
const speak = (init, country, body = '{"text":"hi"}') => reqWithCf(`${SITE}/api/tts`, { method: "POST", body, ...init, headers: { origin: SITE, ...(init?.headers ?? {}) } }, country);

test("region lock allows Tier-1 countries, localhost DEV, PRO_COUNTRIES override, and the owner's header override", async () => {
  assert.equal(regionOf(new Request(`${LOCAL}/api/pro/status`)), "DEV");
  assert.equal(regionOf(reqWithCf(`${SITE}/api/pro/status`, {}, "de")), "DE");

  assert.equal(checkProRegion(reqWithCf(`${SITE}/`, {}, "US"), {}).eligible, true);
  assert.equal(checkProRegion(reqWithCf(`${SITE}/`, {}, "FR"), {}).eligible, true);
  assert.equal(checkProRegion(reqWithCf(`${SITE}/`, {}, "GB"), {}).eligible, true);
  assert.equal(checkProRegion(reqWithCf(`${SITE}/`, {}, "PH"), {}).eligible, false);
  assert.equal(checkProRegion(reqWithCf(`${SITE}/`, {}, "BR"), {}).eligible, false);

  // Local dev works globally without Cloudflare cf.country
  assert.deepEqual(checkProRegion(new Request("http://localhost:8765/api/pro/status"), {}), { eligible: true, country: "DEV", reason: "local_dev" });

  // The owner's override works from any country, only as a header (a web page cannot send it)
  const bypassed = checkProRegion(reqWithCf(`${SITE}/`, { headers: { "x-frills-dev": "owner-dev-key" } }, "PH"), { PRO_DEV_KEY: "owner-dev-key" });
  assert.equal(bypassed.eligible, true);
  assert.equal(bypassed.reason, "dev_override");

  // PRO_COUNTRIES override restricts or expands list dynamically
  assert.equal(checkProRegion(reqWithCf(`${SITE}/`, {}, "PH"), { PRO_COUNTRIES: "PH,SG" }).eligible, true);
  assert.equal(checkProRegion(reqWithCf(`${SITE}/`, {}, "US"), { PRO_COUNTRIES: "PH,SG" }).eligible, false);

  // The status answer says nothing about a payment address: buying is on the account page, where the payment is tied to an account
  const statusRes = await handleProStatus(reqWithCf(`${SITE}/api/pro/status`, {}, "US"), { OPENAI_TTS_KEY: "sk-test", LEMON_CHECKOUT_URL: "https://frills.lemonsqueezy.com/checkout/buy/abc" });
  assert.equal(statusRes.status, 200);
  assert.deepEqual(await statusRes.json(), { ok: true, eligible: true, country: "US", reason: "allowed_country", aiReady: true });
});

test("handleTts: wrong origin, no account, a locked region, credits spent one by one and used up", async () => {
  const env = { DB: localDatabase(":memory:"), OPENAI_TTS_KEY: "sk-openai-mock", REQUIRE_PRO_PASS: "1" };
  const me = await signedIn(env);
  give(env, me.id, { used: 0, limit: 2 });
  const fakeFetch = async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/audio/speech");
    assert.equal(init.headers.authorization, "Bearer sk-openai-mock");
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "content-type": "audio/mpeg" } });
  };
  const call = (req) => handleTts(req, env, { fetchFn: fakeFetch, now: T0 + 5000 });
  const asMe = { headers: { cookie: me.cookie } };

  assert.equal((await call(reqWithCf(`${SITE}/api/tts`, { method: "POST", headers: { origin: "https://evil.example" }, body: '{"text":"hi"}' }, "US"))).status, 403);
  const free = await call(speak({}, "US"));
  assert.deepEqual([free.status, (await free.json()).error], [401, "no_pass"], "a visitor with nothing is a free visitor");

  const blocked = await call(speak(asMe, "PH"));
  assert.deepEqual([blocked.status, (await blocked.json()).error], [403, "region_unavailable"], "Plus is not sold in this country yet");
  assert.equal(creditsUsed(env, me.id), 0, "a refusal spends nothing");

  const ok = await call(speak(asMe, "US", '{"text":"Hello pond!","voice":"nova","rate":1.1}'));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "audio/mpeg");
  assert.deepEqual(new Uint8Array(await ok.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
  assert.deepEqual([ok.headers.get("x-tts-used"), ok.headers.get("x-tts-limit"), ok.headers.get("x-tts-remaining")], ["1", "2", "1"]);
  assert.equal(creditsUsed(env, me.id), 1);

  assert.equal((await call(speak(asMe, "CA"))).status, 200);
  const spent = await call(speak(asMe, "US"));
  assert.deepEqual([spent.status, (await spent.json()).error], [402, "quota_exceeded"]);
  assert.equal(creditsUsed(env, me.id), 2);
});

test("the older ways in are gone: a key sent as x-pass or in the body, and the owner's dev key as a pass, bring nothing; /api/pro/activate and /api/admin/passes are not there", async () => {
  const env = { DB: localDatabase(":memory:"), OPENAI_TTS_KEY: "sk-openai-mock", PRO_DEV_KEY: "owner-dev-key", ADMIN_KEY: "a".repeat(16), REQUIRE_PRO_PASS: "1" };
  let calls = 0;
  const fakeFetch = async () => { calls += 1; return new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "audio/mpeg" } }); };
  for (const [name, init, body] of [
    ["a key in the x-pass header", { headers: { "x-pass": "frills_pro_abc" } }, '{"text":"hi"}'],
    ["the owner's dev key as a pass", { headers: { "x-pass": "owner-dev-key" } }, '{"text":"hi"}'],
    ["a key in the body", {}, '{"text":"hi","pass":"owner-dev-key"}'],
  ]) {
    const res = await handleTts(speak(init, "US", body), env, { fetchFn: fakeFetch, now: T0 });
    assert.deepEqual([res.status, (await res.json()).error], [401, "no_pass"], name);
  }
  assert.equal(calls, 0, "no voice was made");

  const assets = { fetch: async (request) => new Response("a page", { status: 200, headers: { "x-from": "assets" } }) };
  const activate = await worker.fetch(new Request(`${SITE}/api/pro/activate`, { method: "POST", headers: { origin: SITE }, body: '{"licenseKey":"LS-TEST-KEY-1234"}' }), { ...env, ASSETS: assets }, {});
  assert.equal(activate.headers.get("x-from"), "assets", "the Worker no longer answers /api/pro/activate");

  const passes = await handleAdmin(new Request(`${SITE}/api/admin/passes`, { headers: { authorization: `Bearer ${"a".repeat(16)}` } }), env);
  assert.equal(passes.status, 404);
  assert.equal(env.DB.raw.prepare("SELECT name FROM sqlite_master WHERE name IN ('pro_passes', 'pro_links')").all().length, 0, "the old key tables are not in the schema");
});

test("handleTts supports localhost local dev testing without D1 and Google Cloud TTS base64 synthesis", async () => {
  const localEnv = { GOOGLE_TTS_KEY: "goog-key" };
  const audioSample = new Uint8Array([73, 68, 51, 9]); // "ID3\t"
  const googleFetch = async (url, init) => {
    assert.ok(url.startsWith("https://texttospeech.googleapis.com/v1/text:synthesize?key=goog-key"));
    const body = JSON.parse(init.body);
    assert.equal(body.input.text, "Rose from Pond Pal!");
    assert.equal(body.voice.name, "en-GB-Neural2-B");
    return Response.json({ audioContent: Buffer.from(audioSample).toString("base64") });
  };

  const res = await handleTts(
    new Request("http://127.0.0.1:8765/api/tts", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:8765" },
      body: JSON.stringify({ text: "Rose from Pond Pal!", voice: "fable", rate: 1.0 }),
    }),
    localEnv,
    { fetchFn: googleFetch },
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "audio/mpeg");
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), audioSample);
});

test("Groq Orpheus synthesis, the local-only test credits for a signed-in account, and a simulated region lock", async () => {
  const db = localDatabase(":memory:");
  const env = { DEV: true, DB: db, GROQ_TTS_KEY: "gsk_mock_key", REQUIRE_PRO_PASS: "1" };
  const devPass = (headers, body = "{}", site = LOCAL) => new Request(`${site}/api/pro/dev-pass`, { method: "POST", headers: { origin: site, ...headers }, body });

  // off on the live site (no DEV), and it needs a signed-in browser
  assert.equal((await handleDevPass(devPass({}, "{}", SITE), { DB: db })).status, 404);
  const anonymous = await handleDevPass(devPass({}), env);
  assert.deepEqual([anonymous.status, (await anonymous.json()).error], [401, "sign_in_first"]);

  const me = await signedIn(env, "streamer@example.com", LOCAL);
  const minted = await handleDevPass(devPass({ cookie: me.cookie }, JSON.stringify({ limit: 2 })), env, { now: T0 + 5000 });
  assert.equal(minted.status, 201);
  assert.deepEqual(await minted.json(), { ok: true, used: 0, limit: 2 });
  assert.deepEqual({ ...db.raw.prepare("SELECT status, tts_used, tts_limit FROM plus WHERE account_id = ?").get(me.id) }, { status: "active", tts_used: 0, tts_limit: 2 });

  // A simulated country triggers the real region rule even on localhost when env.DEV is on
  const statusAs = async (country) => (await (await handleProStatus(new Request(`${LOCAL}/api/pro/status`, { headers: { "x-frills-country": country, cookie: me.cookie } }), env, { now: T0 + 5000 })).json());
  const ph = await statusAs("PH");
  assert.deepEqual([ph.country, ph.eligible, ph.dev], ["PH", false, true]);
  const us = await statusAs("US");
  assert.deepEqual([us.eligible, us.pass.valid, us.pass.remaining], [true, true, 2]);

  const usNoAccount = await handleTts(new Request(`${LOCAL}/api/tts`, { method: "POST", headers: { origin: LOCAL, "x-frills-country": "US" }, body: '{"text":"hi"}' }), env, { now: T0 + 5000 });
  assert.equal(usNoAccount.status, 401, "a simulated US visitor with nothing brought is a free visitor");

  const wavSample = new Uint8Array([82, 73, 70, 70]); // "RIFF"
  const groqFetch = async (url, init) => {
    assert.equal(url, "https://api.groq.com/openai/v1/audio/speech");
    assert.equal(init.headers.authorization, "Bearer gsk_mock_key");
    const body = JSON.parse(init.body);
    assert.equal(body.model, "canopylabs/orpheus-v1-english");
    assert.equal(body.voice, "daniel");
    assert.equal(body.response_format, "wav");
    return new Response(wavSample, { status: 200, headers: { "content-type": "audio/wav" } });
  };
  const sayAs = (text) => handleTts(new Request(`${LOCAL}/api/tts`, { method: "POST", headers: { origin: LOCAL, "x-frills-country": "US", cookie: me.cookie }, body: JSON.stringify({ text, voice: "onyx" }) }), env, { fetchFn: groqFetch, now: T0 + 5000 });

  const spoke = await sayAs("Deep male voice test");
  assert.equal(spoke.status, 200);
  assert.equal(spoke.headers.get("content-type"), "audio/wav");
  assert.deepEqual([spoke.headers.get("x-tts-used"), spoke.headers.get("x-tts-remaining")], ["1", "1"]);
  assert.equal((await sayAs("One more")).status, 200);
  const used = await sayAs("One too many");
  assert.deepEqual([used.status, (await used.json()).error], [402, "quota_exceeded"]);

  // Header simulation is completely ignored in production (env.DEV falsy)
  assert.equal(regionOf(reqWithCf(`${SITE}/api/pro/status`, { headers: { "x-frills-country": "US" } }, "PH"), {}), "PH");
});

const hmacHex = async (secret, body) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
};

test("Lemon Squeezy's signature: the right digest passes; a wrong one, a short one, junk and no secret do not", async () => {
  const secret = "ls-webhook-secret-test";
  const payload = JSON.stringify({ meta: { event_name: "subscription_payment_success" }, data: { id: "888" } });
  assert.equal(await verifyLemonSignature(payload, await hmacHex(secret, payload), secret), true);
  assert.equal(await verifyLemonSignature(payload + " ", await hmacHex(secret, payload), secret), false, "a changed body");
  assert.equal(await verifyLemonSignature(payload, "00".repeat(32), secret), false);
  assert.equal(await verifyLemonSignature(payload, "00", secret), false);
  assert.equal(await verifyLemonSignature(payload, "not hex", secret), false);
  assert.equal(await verifyLemonSignature(payload, await hmacHex(secret, payload), ""), false);
});
