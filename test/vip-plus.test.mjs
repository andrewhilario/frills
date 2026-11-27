// Owner-granted complimentary VIP Frills Plus passes:
//   - granted & listed & revoked via /api/admin/plus (protected by ADMIN_KEY)
//   - never overwrites an active paid subscription
//   - works from any country (bypasses regional rollout lock for login, verify, status, Plus relay, cloud overlays, and AI TTS gate)
//   - auto-refreshes monthly AI voice character allowance every 30 days

import test from "node:test";
import assert from "node:assert/strict";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";
import { handleAdmin } from "../worker/admin.mjs";
import { handleAccount } from "../worker/account-routes.mjs";
import { handleCloudOverlays } from "../worker/cloud-overlays.mjs";
import { handlePlusRelayTicket } from "../worker/plus-relay.mjs";
import { handleProStatus } from "../worker/region.mjs";
import { plusGate, spendCharacters } from "../worker/plus-gate.mjs";
import { COMP_MONTHLY_MS } from "../worker/accounts.mjs";

const SITE = "https://frills.example";
const ADMIN_KEY = "super-secret-admin-key-1234";
const PLUS_RELAY_SECRET = "relay-hmac-secret-1234567890";

const makeEnv = () => ({
  DB: localDatabase(":memory:"),
  ADMIN_KEY,
  SITE_URL: SITE,
  PLUS_RELAY_SECRET,
  PLUS_RELAY_URL: "https://plus-relay.example",
  OPENAI_TTS_KEY: "sk-test",
});

const adminReq = (method, path, body) =>
  new Request(`${SITE}/api/admin/${path}`, {
    method,
    headers: {
      origin: SITE,
      authorization: `Bearer ${ADMIN_KEY}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

const cfRequest = (url, init = {}, country = "PH") => {
  const req = new Request(url, init);
  Object.defineProperty(req, "cf", { value: { country } });
  return req;
};

test("admin can grant, list, reset, and revoke complimentary VIP Frills Plus; works globally from non-rollout countries", async () => {
  const env = makeEnv();
  const t0 = 1_800_000_000_000;

  // 1. Non-VIP visitor in PH is still blocked from login by region rollout
  let sentUrl = "";
  const mailer = { send: async (msg) => { sentUrl = msg.text; return { ok: true }; } };
  const blockedRes = await handleAccount(
    cfRequest(`${SITE}/api/account/login`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: JSON.stringify({ email: "random@example.com" }) }, "PH"),
    env,
    { now: t0, mailer },
  );
  assert.equal(blockedRes.status, 403);
  assert.equal((await blockedRes.json()).error, "region_unavailable");

  // 2. Owner grants complimentary VIP Frills Plus to friend@example.com via /api/admin/plus
  const grantRes = await handleAdmin(adminReq("POST", "plus", { email: "Friend@Example.com", limit: 200000 }), env, { now: t0 });
  assert.equal(grantRes.status, 200);
  const granted = await grantRes.json();
  assert.equal(granted.ok, true);
  assert.equal(granted.email, "friend@example.com");
  assert.equal(granted.limit, 200000);

  // 3. Summary & list report the active VIP pass
  const listRes = await handleAdmin(adminReq("GET", "plus"), env, { now: t0 });
  const list = await listRes.json();
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].comp, true);
  assert.equal(list.items[0].active, true);
  assert.equal(list.items[0].limit, 200000);

  // 4. VIP user in PH CAN sign in via magic email link and verify token
  const loginRes = await handleAccount(
    cfRequest(`${SITE}/api/account/login`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: JSON.stringify({ email: "friend@example.com" }) }, "PH"),
    env,
    { now: t0, mailer },
  );
  assert.equal(loginRes.status, 200);
  const tokenMatch = /#([A-Za-z0-9_-]{43})/.exec(sentUrl);
  assert.ok(tokenMatch, "magic sign-in token sent");

  const verifyRes = await handleAccount(
    cfRequest(`${SITE}/api/account/verify`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: JSON.stringify({ token: tokenMatch[1] }) }, "PH"),
    env,
    { now: t0 + 1000 },
  );
  assert.equal(verifyRes.status, 200);
  const cookie = verifyRes.headers.get("set-cookie").split(";")[0];

  // 5. /api/account/me reports active VIP pass with billing portal hidden
  const meRes = await handleAccount(
    cfRequest(`${SITE}/api/account/me`, { method: "GET", headers: { cookie } }, "PH"),
    env,
    { now: t0 + 2000 },
  );
  const me = await meRes.json();
  assert.equal(me.signedIn, true);
  assert.equal(me.plus.active, true);
  assert.equal(me.plus.comp, true);
  assert.equal(me.portal, false);

  // 6. /api/pro/status, plusGate, Dedicated Plus Relay, and Cloud Overlays all succeed from PH
  const proRes = await handleProStatus(cfRequest(`${SITE}/api/pro/status`, { method: "GET", headers: { cookie } }, "PH"), env, { now: t0 + 2000 });
  const pro = await proRes.json();
  assert.equal(pro.eligible, true);
  assert.equal(pro.reason, "comp_vip");
  assert.equal(pro.pass.valid, true);
  assert.equal(pro.pass.comp, true);

  const gate = await plusGate(cfRequest(`${SITE}/api/tts`, { method: "POST", headers: { cookie } }, "PH"), env, { now: t0 + 2000 });
  assert.equal(gate.ok, true);
  await spendCharacters(env.DB, gate.plus, 5000);

  const relayRes = await handlePlusRelayTicket(
    cfRequest(`${SITE}/api/plus/relay-ticket`, { method: "POST", headers: { origin: SITE, cookie, "content-type": "application/json" }, body: "{}" }, "PH"),
    env,
    { now: t0 + 2000 },
  );
  assert.equal(relayRes.status, 200);
  assert.equal((await relayRes.json()).ok, true);

  const cloudRes = await handleCloudOverlays(
    cfRequest(`${SITE}/api/cloud-overlays`, { method: "POST", headers: { origin: SITE, cookie, "content-type": "application/json" }, body: JSON.stringify({ kind: "jar", name: "Matcha Jar", query: "channel=matchafan&design=frog&look=matcha" }) }, "PH"),
    env,
    { now: t0 + 2000 },
  );
  assert.equal(cloudRes.status, 201);

  // 7. After 30 days, monthly AI voice usage auto-resets to 0 on read
  // Stay inside the 30-day sign-in session (created at t0 + 1000) so the revoke below is what ends Plus, not an expired cookie.
  const later = t0 + COMP_MONTHLY_MS + 100;
  const meLaterRes = await handleAccount(cfRequest(`${SITE}/api/account/me`, { method: "GET", headers: { cookie } }, "PH"), env, { now: later });
  const meLater = await meLaterRes.json();
  assert.equal(meLater.plus.active, true);
  assert.equal(meLater.plus.used, 0);

  // 8. Admin can revoke VIP pass, immediately turning off Plus
  const revokeRes = await handleAdmin(adminReq("DELETE", `plus/${granted.accountId}`), env, { now: later + 100 });
  assert.equal(revokeRes.status, 200);
  const gateAfter = await plusGate(cfRequest(`${SITE}/api/tts`, { method: "POST", headers: { cookie } }, "PH"), env, { now: later + 200 });
  assert.equal(gateAfter.ok, false);
  assert.equal(gateAfter.error, "invalid_pass");
});

test("admin grant refuses to overwrite an active paid subscription", async () => {
  const env = makeEnv();
  const now = 1_800_000_000_000;
  await env.DB.prepare("INSERT INTO accounts (id, email, created_at, last_login_at) VALUES ('0123456789abcdef', 'paid@example.com', ?, ?)").bind(now, now).run();
  await env.DB.prepare("INSERT INTO plus (account_id, provider_ref, order_ref, status, renews_at, tts_used, tts_limit, period_start, updated_at) VALUES ('0123456789abcdef', 'sub_polar_123', 'ord_1', 'active', ?, 0, 150000, ?, ?)").bind(now + 86400_000, now, now).run();

  const res = await handleAdmin(adminReq("POST", "plus", { email: "paid@example.com" }), env, { now });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, "already_paid");

  const del = await handleAdmin(adminReq("DELETE", "plus/0123456789abcdef"), env, { now });
  assert.equal(del.status, 409);
  assert.equal((await del.json()).error, "not_comp");
});
