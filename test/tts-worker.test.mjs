// Worker Pro Region Lock + AI TTS tests (region whitelist, DEV & PRO_DEV_KEY bypasses, D1 quota & period reset, OpenAI & Google mocks).

import test from "node:test";
import assert from "node:assert/strict";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";
import { checkProRegion, handleProStatus, regionOf } from "../worker/region.mjs";
import { handleDevPass, handleTts, TTS_LIMITS } from "../worker/tts.mjs";
import { handleAdmin } from "../worker/admin.mjs";
import { handleActivateLicense, handleLemonWebhook, verifyLemonSignature } from "../worker/billing.mjs";

const SITE = "https://frills.example";
const sha256 = async (s) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");

const reqWithCf = (url, init = {}, country) => {
  const req = new Request(url, init);
  if (country !== undefined) req.cf = { country };
  return req;
};

const insertPass = async (db, { code = "pass123", token = "secret-pro-token", status = "active", country = "US", allowRoam = 0, used = 0, limit = 100, periodStart = 1_700_000_000_000 } = {}) => {
  const hash = await sha256(token);
  await db
    .prepare("INSERT INTO pro_passes (code, pass_hash, status, country, allow_roam, tts_used, tts_limit, period_start, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(code, hash, status, country, allowRoam, used, limit, periodStart, periodStart)
    .run();
};

test("region lock allows Tier-1 countries, localhost DEV, PRO_COUNTRIES override, and dev header bypasses", async () => {
  assert.equal(regionOf(new Request("http://127.0.0.1:3020/api/pro/status")), "DEV");
  assert.equal(regionOf(reqWithCf(`${SITE}/api/pro/status`, {}, "de")), "DE");

  assert.equal(checkProRegion(reqWithCf(`${SITE}/`, {}, "US"), {}).eligible, true);
  assert.equal(checkProRegion(reqWithCf(`${SITE}/`, {}, "FR"), {}).eligible, true);
  assert.equal(checkProRegion(reqWithCf(`${SITE}/`, {}, "GB"), {}).eligible, true);
  assert.equal(checkProRegion(reqWithCf(`${SITE}/`, {}, "PH"), {}).eligible, false);
  assert.equal(checkProRegion(reqWithCf(`${SITE}/`, {}, "BR"), {}).eligible, false);

  // Local dev works globally without Cloudflare cf.country
  assert.deepEqual(checkProRegion(new Request("http://localhost:8765/api/pro/status"), {}), { eligible: true, country: "DEV", reason: "local_dev" });

  // Owner override works from any country
  const bypassed = checkProRegion(reqWithCf(`${SITE}/`, { headers: { "x-frills-dev": "owner-dev-key" } }, "PH"), { PRO_DEV_KEY: "owner-dev-key" });
  assert.equal(bypassed.eligible, true);
  assert.equal(bypassed.reason, "dev_override");

  // PRO_COUNTRIES override restricts or expands list dynamically
  assert.equal(checkProRegion(reqWithCf(`${SITE}/`, {}, "PH"), { PRO_COUNTRIES: "PH,SG" }).eligible, true);
  assert.equal(checkProRegion(reqWithCf(`${SITE}/`, {}, "US"), { PRO_COUNTRIES: "PH,SG" }).eligible, false);

  const statusRes = await handleProStatus(reqWithCf(`${SITE}/api/pro/status`, {}, "US"), { OPENAI_TTS_KEY: "sk-test" });
  assert.equal(statusRes.status, 200);
  assert.deepEqual(await statusRes.json(), { ok: true, eligible: true, country: "US", reason: "allowed_country", aiReady: true });
});

test("handleTts enforces origin, pass, region lock, quota, and 30-day counter reset", async () => {
  const db = localDatabase(":memory:");
  const now = 1_700_000_000_000;
  await insertPass(db, { code: "p_us", token: "tok-us", used: 0, limit: 2, periodStart: now });
  await insertPass(db, { code: "p_max", token: "tok-max", used: 2, limit: 2, periodStart: now });
  await insertPass(db, { code: "p_old", token: "tok-old", used: 2, limit: 2, periodStart: now - TTS_LIMITS.windowMs - 1000 });
  await insertPass(db, { code: "p_roam", token: "tok-roam", allowRoam: 1, used: 0, limit: 5, periodStart: now });

  const env = { DB: db, OPENAI_TTS_KEY: "sk-openai-mock" };
  const fakeFetch = async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/audio/speech");
    assert.equal(init.headers.authorization, "Bearer sk-openai-mock");
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "content-type": "audio/mpeg" } });
  };

  // Wrong origin & missing pass
  const badOrigin = await handleTts(reqWithCf(`${SITE}/api/tts`, { method: "POST", headers: { origin: "https://evil.example" }, body: '{"text":"hi"}' }, "US"), env, { fetchFn: fakeFetch, now });
  assert.equal(badOrigin.status, 403);

  const noPass = await handleTts(reqWithCf(`${SITE}/api/tts`, { method: "POST", headers: { origin: SITE }, body: '{"text":"hi"}' }, "US"), env, { fetchFn: fakeFetch, now });
  assert.equal(noPass.status, 401);

  // Blocked country rejected even with valid US pass unless allow_roam = 1
  const blocked = await handleTts(reqWithCf(`${SITE}/api/tts`, { method: "POST", headers: { origin: SITE, "x-pass": "tok-us" }, body: '{"text":"hi"}' }, "PH"), env, { fetchFn: fakeFetch, now });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error, "region_unavailable");

  const roaming = await handleTts(reqWithCf(`${SITE}/api/tts`, { method: "POST", headers: { origin: SITE, "x-pass": "tok-roam" }, body: '{"text":"hi"}' }, "PH"), env, { fetchFn: fakeFetch, now });
  assert.equal(roaming.status, 200);

  // Active Tier-1 request succeeds & increments tts_used
  const ok = await handleTts(reqWithCf(`${SITE}/api/tts`, { method: "POST", headers: { origin: SITE, "x-pass": "tok-us" }, body: '{"text":"Hello pond!","voice":"nova","rate":1.1}' }, "US"), env, { fetchFn: fakeFetch, now });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "audio/mpeg");
  assert.deepEqual(new Uint8Array(await ok.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
  assert.equal((await db.prepare("SELECT tts_used FROM pro_passes WHERE code = 'p_us'").first()).tts_used, 1);

  // Exhausted monthly quota returns 402
  const quotaHit = await handleTts(reqWithCf(`${SITE}/api/tts`, { method: "POST", headers: { origin: SITE, "x-pass": "tok-max" }, body: '{"text":"hi"}' }, "US"), env, { fetchFn: fakeFetch, now });
  assert.equal(quotaHit.status, 402);

  // Expired 30-day window resets tts_used and allows synthesis
  const rolled = await handleTts(reqWithCf(`${SITE}/api/tts`, { method: "POST", headers: { origin: SITE, "x-pass": "tok-old" }, body: '{"text":"hi"}' }, "CA"), env, { fetchFn: fakeFetch, now });
  assert.equal(rolled.status, 200);
  const oldRow = await db.prepare("SELECT tts_used, period_start FROM pro_passes WHERE code = 'p_old'").first();
  assert.equal(oldRow.tts_used, 1);
  assert.equal(oldRow.period_start, now);
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

test("Groq Orpheus AI synthesis, dev pass minting, simulated region lock, and admin pass control", async () => {
  const db = localDatabase(":memory:");
  const env = { DEV: true, DB: db, GROQ_TTS_KEY: "gsk_mock_key", ADMIN_KEY: "a".repeat(16) };

  // handleDevPass is disabled when DEV is false
  const blockedProd = await handleDevPass(new Request(`${SITE}/api/pro/dev-pass`, { method: "POST", headers: { origin: SITE }, body: "{}" }), { DB: db });
  assert.equal(blockedProd.status, 404);

  // Local dev server issues a 5-credit pass cleanly
  const mintedRes = await handleDevPass(new Request("http://127.0.0.1:3020/api/pro/dev-pass", { method: "POST", headers: { origin: "http://127.0.0.1:3020" }, body: JSON.stringify({ country: "US", limit: 2 }) }), env);
  assert.equal(mintedRes.status, 201);
  const minted = await mintedRes.json();
  assert.ok(minted.token.startsWith("frills_pro_"));
  assert.equal(minted.limit, 2);

  // Simulated country header triggers real region lock & paywall even on localhost when env.DEV=true
  const phStatus = await (await handleProStatus(new Request("http://127.0.0.1:3020/api/pro/status", { headers: { "x-frills-country": "PH", "x-pass": minted.token } }), env)).json();
  assert.equal(phStatus.country, "PH");
  assert.equal(phStatus.eligible, false);
  assert.equal(phStatus.dev, true);

  const usNoPass = await handleTts(
    new Request("http://127.0.0.1:3020/api/tts", { method: "POST", headers: { origin: "http://127.0.0.1:3020", "x-frills-country": "US" }, body: '{"text":"hi"}' }),
    env,
  );
  assert.equal(usNoPass.status, 401);

  // Valid US pass hits Groq Orpheus WAV synthesis and returns quota headers
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

  const spoke = await handleTts(
    new Request("http://127.0.0.1:3020/api/tts", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3020", "x-frills-country": "US", "x-pass": minted.token },
      body: JSON.stringify({ text: "Deep male voice test", voice: "onyx" }),
    }),
    env,
    { fetchFn: groqFetch },
  );
  assert.equal(spoke.status, 200);
  assert.equal(spoke.headers.get("content-type"), "audio/wav");
  assert.equal(spoke.headers.get("x-tts-used"), "1");
  assert.equal(spoke.headers.get("x-tts-remaining"), "1");

  // Admin passes API lists & pauses passes securely
  const listRes = await handleAdmin(new Request(`${SITE}/api/admin/passes`, { headers: { authorization: `Bearer ${"a".repeat(16)}` } }), env);
  assert.equal(listRes.status, 200);
  const listData = await listRes.json();
  assert.equal(listData.items.length, 1);
  assert.equal("pass_hash" in listData.items[0], false);

  const pauseRes = await handleAdmin(
    new Request(`${SITE}/api/admin/passes/${minted.code}`, { method: "PATCH", headers: { authorization: `Bearer ${"a".repeat(16)}`, origin: SITE }, body: JSON.stringify({ status: "paused" }) }),
    env,
  );
  assert.equal(pauseRes.status, 200);

  const deniedAfterPause = await handleTts(
    new Request("http://127.0.0.1:3020/api/tts", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3020", "x-frills-country": "US", "x-pass": minted.token },
      body: JSON.stringify({ text: "Should fail" }),
    }),
    env,
    { fetchFn: groqFetch },
  );
  assert.equal(deniedAfterPause.status, 401);

  // Header simulation is completely ignored in production (env.DEV falsy)
  assert.equal(regionOf(reqWithCf(`${SITE}/api/pro/status`, { headers: { "x-frills-country": "US" } }, "PH"), {}), "PH");
});

const hmacHex = async (secret, body) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
};

test("Lemon Squeezy license activation enforces region lock, preserves used quota, and webhooks manage lifecycle", async () => {
  const db = localDatabase(":memory:");
  const secret = "ls-webhook-secret-test";
  const env = { DB: db, DEV: true, LEMON_STORE_ID: "99", LEMON_PRODUCT_ID: "42", LEMON_WEBHOOK_SECRET: secret, PRO_MONTHLY_LIMIT: "100" };
  const lsFetch = async (url) => {
    assert.equal(url, "https://api.lemonsqueezy.com/v1/licenses/validate");
    return Response.json({
      valid: true,
      license_key: { id: 777, status: "active", key: "LS-TEST-KEY-1234" },
      meta: { test_mode: true, store_id: 99, product_id: 42, order_id: 555 },
    });
  };

  // Blocked country cannot activate license
  const phDenied = await handleActivateLicense(
    reqWithCf(`${SITE}/api/pro/activate`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: '{"licenseKey":"LS-TEST-KEY-1234"}' }, "PH"),
    env,
    { fetchFn: lsFetch },
  );
  assert.equal(phDenied.status, 403);

  // Test mode license is blocked in non-DEV production unless LEMON_TEST_MODE=1
  const prodTestBlocked = await handleActivateLicense(
    reqWithCf(`${SITE}/api/pro/activate`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: '{"licenseKey":"LS-TEST-KEY-1234"}' }, "US"),
    { DB: db, LEMON_STORE_ID: "99", LEMON_PRODUCT_ID: "42" },
    { fetchFn: lsFetch },
  );
  assert.equal(prodTestBlocked.status, 403);
  assert.equal((await prodTestBlocked.json()).error, "test_mode_disabled");

  // Eligible region activates key cleanly
  const activated = await handleActivateLicense(
    reqWithCf(`${SITE}/api/pro/activate`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: '{"licenseKey":"LS-TEST-KEY-1234"}' }, "US"),
    env,
    { fetchFn: lsFetch },
  );
  assert.equal(activated.status, 200);
  const actBody = await activated.json();
  assert.equal(actBody.ok, true);
  assert.equal(actBody.testMode, true);
  assert.equal(actBody.pass.limit, 100);

  // Consuming 1 credit persists even if key is re-activated on another device
  await db.prepare("UPDATE pro_passes SET tts_used = 1 WHERE code = ?").bind(actBody.pass.code).run();
  const reactivated = await (
    await handleActivateLicense(
      reqWithCf(`${SITE}/api/pro/activate`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: '{"licenseKey":"LS-TEST-KEY-1234"}' }, "GB"),
      env,
      { fetchFn: lsFetch },
    )
  ).json();
  assert.equal(reactivated.pass.used, 1);

  // Webhook rejects bad signature
  const renewPayload = JSON.stringify({
    meta: { event_name: "subscription_payment_success", test_mode: true },
    data: { id: "888", attributes: { store_id: 99, order_id: 555, subscription_id: 888 } },
  });
  assert.equal(await verifyLemonSignature(renewPayload, await hmacHex(secret, renewPayload), secret), true);
  assert.equal((await handleLemonWebhook(new Request(`${SITE}/api/webhooks/lemonsqueezy`, { method: "POST", headers: { "x-signature": "00".repeat(32) }, body: renewPayload }), env)).status, 401);

  // Valid renewal webhook resets tts_used cleanly
  const renewRes = await handleLemonWebhook(
    new Request(`${SITE}/api/webhooks/lemonsqueezy`, { method: "POST", headers: { "x-signature": await hmacHex(secret, renewPayload) }, body: renewPayload }),
    env,
  );
  assert.equal(renewRes.status, 200);
  assert.equal((await db.prepare("SELECT tts_used, status FROM pro_passes WHERE code = ?").bind(actBody.pass.code).first()).tts_used, 0);

  // Refund webhook cancels the pass
  const refundPayload = JSON.stringify({
    meta: { event_name: "order_refunded", test_mode: true },
    data: { id: "555", attributes: { store_id: 99 } },
  });
  const refundRes = await handleLemonWebhook(
    new Request(`${SITE}/api/webhooks/lemonsqueezy`, { method: "POST", headers: { "x-signature": await hmacHex(secret, refundPayload) }, body: refundPayload }),
    env,
  );
  assert.equal(refundRes.status, 200);
  assert.equal((await db.prepare("SELECT status FROM pro_passes WHERE code = ?").bind(actBody.pass.code).first()).status, "canceled");
});
