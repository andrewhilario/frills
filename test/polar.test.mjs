// Polar.sh integration tests (worker/polar.mjs + account-routes.mjs + worker/index.mjs):
//   - Standard Webhooks HMAC-SHA256 verification (both whsec_ base64 keys and literal polar_whs_ UTF-8 keys, replay window)
//   - Checkout session creation (POST /v1/checkouts, sandbox vs prod, external_customer_id + metadata + success_url)
//   - Customer Portal session creation (POST /v1/customer-sessions)
//   - Full webhook lifecycle (subscription.created -> order.paid -> renewal character reset -> canceled -> revoked -> order.refunded)
//   - Reviewer preview bypass on /plus/?review=KEY

import test from "node:test";
import assert from "node:assert/strict";
import { COOKIE, handleAccount } from "../worker/account-routes.mjs";
import { acceptablePolarUrl, createPolarCheckout, createPolarPortal, handlePolarWebhook, polarConfig, polarIsSandbox, verifyPolarWebhook } from "../worker/polar.mjs";
import { getPlus, plusActive } from "../worker/accounts.mjs";
import worker from "../worker/index.mjs";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";

const SITE = "https://frills.valwidgets.live";
const T0 = Date.parse("2026-12-01T12:00:00Z");
const DAY = 86_400_000;
const RAW_SECRET_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
const WHSEC_SECRET = "whsec_" + Buffer.from(RAW_SECRET_BYTES).toString("base64");
const LEGACY_SECRET = "polar_whs_legacy_secret_value_for_tests_0123";
const PRODUCT_ID = "prod_frills_plus_001";

async function signStdWebhook(raw, { id = "msg_1", ts = Math.floor(T0 / 1000), keyBytes }) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${raw}`)));
  return {
    "webhook-id": id,
    "webhook-timestamp": String(ts),
    "webhook-signature": `v1,${Buffer.from(sig).toString("base64")}`,
  };
}

async function signedInAccount(env, email = "creator@example.com") {
  const sent = [];
  const mailer = { send: async (m) => { sent.push(m); return { ok: true }; } };
  await handleAccount(new Request(`${SITE}/api/account/login`, { method: "POST", headers: { origin: SITE, "content-type": "application/json", "cf-connecting-ip": "203.0.113.5" }, body: JSON.stringify({ email }) }), env, { now: T0, mailer });
  const verified = await handleAccount(new Request(`${SITE}/api/account/verify`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: JSON.stringify({ token: /#([A-Za-z0-9_-]{43})/.exec(sent[0].text)[1] }) }), env, { now: T0 + 1000 });
  const id = env.DB.raw.prepare("SELECT id FROM accounts WHERE email = ?").get(email).id;
  const cookie = `${COOKIE}=${/frills_session=([^;]*)/.exec(verified.headers.get("set-cookie"))[1]}`;
  return { id, cookie };
}

test("Standard Webhooks verification accepts whsec_ base64 keys and literal polar_whs_ UTF-8 keys, and rejects tampered or stale deliveries", async () => {
  const raw = JSON.stringify({ type: "subscription.created", data: { id: "sub_1" } });

  // Post-Sept-2026 Standard Webhooks base64 key (whsec_...)
  const h1 = await signStdWebhook(raw, { keyBytes: RAW_SECRET_BYTES });
  assert.equal(await verifyPolarWebhook({ raw, id: h1["webhook-id"], timestamp: h1["webhook-timestamp"], signature: h1["webhook-signature"], secret: WHSEC_SECRET, now: T0 + 5000 }), true);

  // Legacy literal UTF-8 secret (polar_whs_...)
  const h2 = await signStdWebhook(raw, { keyBytes: new TextEncoder().encode(LEGACY_SECRET) });
  assert.equal(await verifyPolarWebhook({ raw, id: h2["webhook-id"], timestamp: h2["webhook-timestamp"], signature: h2["webhook-signature"], secret: LEGACY_SECRET, now: T0 + 5000 }), true);

  // Tampered body, wrong secret, and expired timestamp (> 5 min) are rejected
  assert.equal(await verifyPolarWebhook({ raw: raw + " ", id: h1["webhook-id"], timestamp: h1["webhook-timestamp"], signature: h1["webhook-signature"], secret: WHSEC_SECRET, now: T0 + 5000 }), false);
  assert.equal(await verifyPolarWebhook({ raw, id: h1["webhook-id"], timestamp: h1["webhook-timestamp"], signature: h1["webhook-signature"], secret: "whsec_wrong", now: T0 + 5000 }), false);
  assert.equal(await verifyPolarWebhook({ raw, id: h1["webhook-id"], timestamp: h1["webhook-timestamp"], signature: h1["webhook-signature"], secret: WHSEC_SECRET, now: T0 + 400_000 }), false);
});

test("Polar checkout and customer portal call Polar REST API (sandbox & prod) and enforce polar.sh URL host safety", async () => {
  assert.equal(acceptablePolarUrl("https://buy.polar.sh/checkout_abc"), "https://buy.polar.sh/checkout_abc");
  assert.equal(acceptablePolarUrl("https://sandbox.polar.sh/org/portal?token=1"), "https://sandbox.polar.sh/org/portal?token=1");
  assert.equal(acceptablePolarUrl("https://evil.example/phish"), null);

  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (url.endsWith("/checkouts/")) {
      return new Response(JSON.stringify({ id: "chk_1", url: "https://sandbox.polar.sh/checkout/chk_1" }), { status: 201 });
    }
    if (url.endsWith("/customer-sessions/")) {
      return new Response(JSON.stringify({ customer_portal_url: "https://sandbox.polar.sh/frills/portal?customer_session_token=polar_cst_1" }), { status: 201 });
    }
    return new Response("not found", { status: 404 });
  };

  const env = { DB: localDatabase(":memory:"), POLAR_ACCESS_TOKEN: "polar_oat_test", POLAR_PRODUCT_ID: PRODUCT_ID, POLAR_SANDBOX: "1" };
  const acct = await signedInAccount(env);

  // Checkout via /api/account/checkout
  const chkRes = await handleAccount(
    new Request(`${SITE}/api/account/checkout`, { method: "POST", headers: { origin: SITE, cookie: acct.cookie, "content-type": "application/json" }, body: "{}" }),
    env,
    { now: T0 + 5000, fetchFn: fakeFetch },
  );
  assert.equal(chkRes.status, 200);
  assert.deepEqual(await chkRes.json(), { ok: true, url: "https://sandbox.polar.sh/checkout/chk_1" });
  assert.equal(calls[0].url, "https://sandbox-api.polar.sh/v1/checkouts/");
  assert.equal(calls[0].init.headers.authorization, "Bearer polar_oat_test");
  assert.deepEqual(calls[0].body.products, [PRODUCT_ID]);
  assert.equal(calls[0].body.external_customer_id, acct.id);
  assert.equal(calls[0].body.metadata.account_id, acct.id);
  assert.equal(calls[0].body.success_url, `${SITE}/account/?welcome=1&checkout_id={CHECKOUT_ID}`);

  // Portal via /api/account/portal (after subscription exists)
  env.DB.raw.prepare("INSERT INTO plus (account_id, provider_ref, order_ref, status, renews_at, tts_used, tts_limit, period_start, updated_at) VALUES (?, 'sub_polar_1', 'ord_1', 'active', ?, 0, 150000, ?, ?)").run(acct.id, T0 + 30 * DAY, T0, T0);
  const portalRes = await handleAccount(
    new Request(`${SITE}/api/account/portal`, { method: "POST", headers: { origin: SITE, cookie: acct.cookie, "content-type": "application/json" }, body: "{}" }),
    env,
    { now: T0 + 6000, fetchFn: fakeFetch },
  );
  assert.equal(portalRes.status, 200);
  assert.deepEqual(await portalRes.json(), { ok: true, url: "https://sandbox.polar.sh/frills/portal?customer_session_token=polar_cst_1" });
  assert.equal(calls[1].url, "https://sandbox-api.polar.sh/v1/customer-sessions/");
  assert.equal(calls[1].body.external_customer_id, acct.id);

  // Rejects non-polar.sh URL returned by compromised upstream
  const bad = await createPolarCheckout(env, { email: "a@b.co", accountId: acct.id }, async () => new Response(JSON.stringify({ url: "https://evil.example/steal" }), { status: 201 }));
  assert.equal(bad.ok, false);
  assert.equal(bad.error, "provider_error");
  const badPortal = await createPolarPortal(env, { accountId: acct.id }, async () => new Response(JSON.stringify({ customer_portal_url: "https://evil.example/steal" }), { status: 201 }));
  assert.equal(badPortal.ok, false);
  assert.equal(badPortal.error, "provider_error");
});

test("POST /api/webhooks/polar: created -> order.paid -> renewal resets chars -> canceled stays active until end -> revoked & refunded turn Plus off", async () => {
  const env = { DB: localDatabase(":memory:"), POLAR_WEBHOOK_SECRET: WHSEC_SECRET, POLAR_PRODUCT_ID: PRODUCT_ID };
  const acct = await signedInAccount(env);

  const deliver = async (type, data, atMs) => {
    const raw = JSON.stringify({ type, timestamp: new Date(atMs).toISOString(), data });
    const headers = await signStdWebhook(raw, { id: `msg_${atMs}`, ts: Math.floor(atMs / 1000), keyBytes: RAW_SECRET_BYTES });
    const res = await handlePolarWebhook(new Request(`${SITE}/api/webhooks/polar`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw }), env, { now: atMs + 1000 });
    return { status: res.status, body: await res.json() };
  };

  // 1. subscription.created turns Plus ON with 150,000 chars
  const created = await deliver("subscription.created", {
    id: "sub_polar_99",
    status: "active",
    product_id: PRODUCT_ID,
    current_period_start: new Date(T0).toISOString(),
    current_period_end: new Date(T0 + 30 * DAY).toISOString(),
    cancel_at_period_end: false,
    customer: { id: "cust_1", external_id: acct.id },
  }, T0 + 5000);
  assert.equal(created.status, 200);
  assert.equal(created.body.result, "applied");
  let row = await getPlus(env.DB, acct.id);
  assert.equal(plusActive(row, T0 + 6000), true);
  assert.equal(row.tts_limit, 150000);

  // Spend some characters, record initial order.paid (should NOT reset on initial purchase)
  env.DB.raw.prepare("UPDATE plus SET tts_used = 42000 WHERE account_id = ?").run(acct.id);
  await deliver("order.paid", { id: "ord_polar_1", subscription_id: "sub_polar_99", product_id: PRODUCT_ID, billing_reason: "subscription_create", customer: { external_id: acct.id } }, T0 + 10_000);
  row = await getPlus(env.DB, acct.id);
  assert.equal(row.order_ref, "ord_polar_1");
  assert.equal(row.tts_used, 42000);

  // 2. Renewal via subscription.updated advancing current_period_start resets tts_used to 0
  await deliver("subscription.updated", {
    id: "sub_polar_99",
    status: "active",
    product_id: PRODUCT_ID,
    current_period_start: new Date(T0 + 30 * DAY).toISOString(),
    current_period_end: new Date(T0 + 60 * DAY).toISOString(),
    cancel_at_period_end: false,
  }, T0 + 30 * DAY + 5000);
  row = await getPlus(env.DB, acct.id);
  assert.equal(row.tts_used, 0);

  // 3. Cancel at period end keeps Plus active until current_period_end
  await deliver("subscription.updated", {
    id: "sub_polar_99",
    status: "active",
    product_id: PRODUCT_ID,
    current_period_start: new Date(T0 + 30 * DAY).toISOString(),
    current_period_end: new Date(T0 + 60 * DAY).toISOString(),
    cancel_at_period_end: true,
  }, T0 + 35 * DAY);
  row = await getPlus(env.DB, acct.id);
  assert.equal(row.status, "canceled");
  assert.equal(plusActive(row, T0 + 40 * DAY), true);
  assert.equal(plusActive(row, T0 + 61 * DAY), false);

  // 4. order.refunded turns Plus OFF immediately
  await deliver("order.refunded", { id: "ord_polar_1", subscription_id: "sub_polar_99", product_id: PRODUCT_ID, status: "refunded", amount: 599, refunded_amount: 599 }, T0 + 36 * DAY);
  row = await getPlus(env.DB, acct.id);
  assert.equal(row.status, "refunded");
  assert.equal(plusActive(row, T0 + 36 * DAY + 1000), false);
});

test("Worker allows /plus/?review=PLUS_REVIEW_KEY from non-Tier-1 countries for payment reviewer verification", async () => {
  const assets = {
    fetch: async (req) => {
      const p = new URL(req.url).pathname;
      return new Response(p === "/404.html" ? "Not found" : "Frills Plus Page", { status: 200, headers: { "content-type": "text/html" } });
    },
  };
  const env = { ASSETS: assets, PLUS_REVIEW_KEY: "polar-review-2026" };
  const mk = (url) => {
    const r = new Request(url, { headers: { "cf-connecting-ip": "198.51.100.88" } });
    Object.defineProperty(r, "cf", { value: { country: "PH" }, configurable: true });
    return r;
  };
  assert.equal((await worker.fetch(mk(`${SITE}/plus/`), env, {})).status, 404);
  assert.equal((await worker.fetch(mk(`${SITE}/plus/?review=wrong`), env, {})).status, 404);
  const ok = await worker.fetch(mk(`${SITE}/plus/?review=polar-review-2026`), env, {});
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "Frills Plus Page");
});

test("POLAR_SANDBOX=1 uses POLAR_SANDBOX_* secrets and locks checkout to PRO_ALLOW_IPS; POLAR_SANDBOX=0 switches cleanly to Live", async () => {
  const baseEnv = {
    DB: localDatabase(":memory:"),
    POLAR_ACCESS_TOKEN: "polar_oat_live",
    POLAR_PRODUCT_ID: "prod_live_111",
    POLAR_WEBHOOK_SECRET: "whsec_live_secret",
    POLAR_SANDBOX_ACCESS_TOKEN: "polar_oat_sandbox",
    POLAR_SANDBOX_PRODUCT_ID: "prod_sandbox_222",
    POLAR_SANDBOX_WEBHOOK_SECRET: "whsec_sandbox_secret",
    PRO_ALLOW_IPS: "203.0.113.7",
  };

  // Sandbox ON (POLAR_SANDBOX=1)
  const sbEnv = { ...baseEnv, POLAR_SANDBOX: "1" };
  assert.equal(polarIsSandbox(sbEnv), true);
  assert.deepEqual(polarConfig(sbEnv), {
    sandbox: true,
    apiBase: "https://sandbox-api.polar.sh/v1",
    token: "polar_oat_sandbox",
    productId: "prod_sandbox_222",
    webhookSecret: "whsec_sandbox_secret",
  });

  // Sandbox OFF (POLAR_SANDBOX=0) -> instantly flips to Production Live credentials
  const liveEnv = { ...baseEnv, POLAR_SANDBOX: "0" };
  assert.equal(polarIsSandbox(liveEnv), false);
  assert.deepEqual(polarConfig(liveEnv), {
    sandbox: false,
    apiBase: "https://api.polar.sh/v1",
    token: "polar_oat_live",
    productId: "prod_live_111",
    webhookSecret: "whsec_live_secret",
  });

  // Security check: on real Cloudflare edge, POLAR_SANDBOX=1 blocks public US visitors from Sandbox checkout while allowing PRO_ALLOW_IPS
  const acct = await signedInAccount(sbEnv);
  const fakeFetch = async (url) =>
    new Response(JSON.stringify({ url: url.includes("sandbox") ? "https://sandbox.polar.sh/checkout/sb1" : "https://buy.polar.sh/checkout/live1" }), { status: 201 });

  const edgeReq = (path, method, country, ip) => {
    const r = new Request(`${SITE}${path}`, {
      method,
      headers: { origin: SITE, cookie: acct.cookie, "cf-connecting-ip": ip, ...(method === "POST" ? { "content-type": "application/json" } : {}) },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    Object.defineProperty(r, "cf", { value: { country }, configurable: true });
    return r;
  };

  // Public US visitor cannot open Sandbox checkout while POLAR_SANDBOX=1
  const usMeSb = await (await handleAccount(edgeReq("/api/account/me", "GET", "US", "198.51.100.20"), sbEnv, { now: T0 + 2000 })).json();
  assert.equal(usMeSb.checkout, false);
  const usChkSb = await handleAccount(edgeReq("/api/account/checkout", "POST", "US", "198.51.100.20"), sbEnv, { now: T0 + 2000, fetchFn: fakeFetch });
  assert.equal(usChkSb.status, 503);

  // Owner IP (PRO_ALLOW_IPS) CAN open Sandbox checkout while POLAR_SANDBOX=1
  const ownerChkSb = await handleAccount(edgeReq("/api/account/checkout", "POST", "PH", "203.0.113.7"), sbEnv, { now: T0 + 2000, fetchFn: fakeFetch });
  assert.equal(ownerChkSb.status, 200);
  assert.equal((await ownerChkSb.json()).url, "https://sandbox.polar.sh/checkout/sb1");

  // Switching POLAR_SANDBOX=0 immediately unlocks Live checkout for US visitors
  const usMeLive = await (await handleAccount(edgeReq("/api/account/me", "GET", "US", "198.51.100.20"), liveEnv, { now: T0 + 3000 })).json();
  assert.equal(usMeLive.checkout, true);
  const usChkLive = await handleAccount(edgeReq("/api/account/checkout", "POST", "US", "198.51.100.20"), liveEnv, { now: T0 + 3000, fetchFn: fakeFetch });
  assert.equal(usChkLive.status, 200);
  assert.equal((await usChkLive.json()).url, "https://buy.polar.sh/checkout/live1");
});
