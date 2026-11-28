// Owner-granted complimentary VIP Frills Plus passes:
//   - granted & listed & revoked via /api/admin/plus (protected by ADMIN_KEY)
//   - never overwrites an active paid subscription
//   - works from any country (bypasses regional rollout lock for login, verify, status, Plus relay, cloud overlays, and AI TTS gate)
//   - auto-refreshes monthly AI voice character allowance every 30 days

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";
import { handleAdmin } from "../worker/admin.mjs";
import { handleAccount } from "../worker/account-routes.mjs";
import { handleCloudOverlays } from "../worker/cloud-overlays.mjs";
import { handlePlusRelayTicket } from "../worker/plus-relay.mjs";
import { handleProStatus } from "../worker/region.mjs";
import { plusGate, spendCharacters } from "../worker/plus-gate.mjs";
import { COMP_MONTHLY_MS, getPlus, isCompPlus, plusActive } from "../worker/accounts.mjs";
import { handlePolarWebhook } from "../worker/polar.mjs";

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

test("the admin voice-allowance field accepts its own default (a number input only takes min + a whole number of steps)", () => {
  const html = fs.readFileSync(join(import.meta.dirname, "..", "src", "pages", "admin", "index.html"), "utf8");
  const tag = /<input[^>]*id="p-limit"[^>]*>/.exec(html)?.[0] ?? "";
  const attr = (name) => Number(new RegExp(`${name}="([0-9]+)"`).exec(tag)?.[1]);
  const [value, min, max, step] = [attr("value"), attr("min"), attr("max"), attr("step")];
  assert.ok([value, min, max, step].every(Number.isFinite), "the field states its value, min, max and step");
  assert.equal((value - min) % step, 0, "the default is a value the browser accepts");
  for (const typed of [150000, 200000, 500000]) assert.equal((typed - min) % step, 0, `${typed} can be typed`);
});

const DAY = 24 * 3600 * 1000;
const WEBHOOK_SECRET = "polar_whs_manual_grant_test_secret_0123456789";

async function signedPolar(body, now) {
  const raw = JSON.stringify(body);
  const id = "msg_manual_1";
  const ts = String(Math.floor(now / 1000));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${raw}`)));
  return new Request(`${SITE}/api/webhooks/polar`, { method: "POST", headers: { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${Buffer.from(sig).toString("base64")}` }, body: raw });
}

test("a manual grant is a normal Plus (not VIP): blank payment fields, days you choose, extends, never overwrites a VIP pass or a paid plan, and can be ended", async () => {
  const env = makeEnv();
  const t0 = 1_800_000_000_000;

  // grants Plus for the days asked, listed as manual (not VIP)
  const res = await handleAdmin(adminReq("POST", "plus/manual", { email: " Customer@Example.com ", days: 30, limit: 150000 }), env, { now: t0 });
  assert.equal(res.status, 200);
  const granted = await res.json();
  assert.equal(granted.email, "customer@example.com");
  assert.equal(granted.created, true);
  assert.equal(granted.extended, false);
  assert.equal(granted.renewsAt, t0 + 30 * DAY);
  let row = await getPlus(env.DB, granted.accountId, t0);
  assert.equal(row.provider_ref, "", "the payment fields stay blank, so a real subscription can attach later");
  assert.equal(isCompPlus(row), false, "it is not a VIP pass, so the country rules still apply to it");
  assert.equal(plusActive(row, t0 + 29 * DAY), true);
  assert.equal(plusActive(row, t0 + 34 * DAY), false, "it ends after its days (plus the usual three days of grace)");
  const list = (await (await handleAdmin(adminReq("GET", "plus"), env, { now: t0 })).json()).items;
  assert.equal(list[0].comp, false);
  assert.equal(list[0].manual, true);
  assert.equal(list[0].active, true);
  assert.equal((await (await handleAdmin(adminReq("GET", "summary"), env, { now: t0 })).json()).plus.manual, 1);

  // granting again to an active manual row adds the days to its end and keeps the voice usage
  await env.DB.prepare("UPDATE plus SET tts_used = 4000 WHERE account_id = ?").bind(granted.accountId).run();
  const again = await (await handleAdmin(adminReq("POST", "plus/manual", { email: "customer@example.com", days: 10 }), env, { now: t0 + DAY })).json();
  assert.equal(again.extended, true);
  assert.equal(again.renewsAt, t0 + 40 * DAY);
  assert.equal((await getPlus(env.DB, granted.accountId, t0 + DAY)).tts_used, 4000);

  // days are kept to a sensible range, and a bad address or bad body is refused
  assert.equal((await (await handleAdmin(adminReq("POST", "plus/manual", { email: "long@example.com", days: 99999 }), env, { now: t0 })).json()).days, 366);
  assert.equal((await (await handleAdmin(adminReq("POST", "plus/manual", { email: "not an email" }), env, { now: t0 })).json()).error, "bad_email");
  assert.equal((await handleAdmin(adminReq("GET", "plus/manual"), env, { now: t0 })).status, 405);

  // a real Polar subscription that arrives later takes over the same row
  const webhookEnv = { ...env, POLAR_WEBHOOK_SECRET: WEBHOOK_SECRET };
  const polar = await handlePolarWebhook(await signedPolar({
    type: "subscription.created",
    timestamp: new Date(t0 + 2 * DAY).toISOString(),
    data: { id: "sub_real_1", status: "active", customer: { external_id: granted.accountId }, current_period_start: new Date(t0 + 2 * DAY).toISOString(), current_period_end: new Date(t0 + 32 * DAY).toISOString() },
  }, t0 + 2 * DAY), webhookEnv, { now: t0 + 2 * DAY });
  assert.equal(polar.status, 200);
  row = await getPlus(env.DB, granted.accountId, t0 + 2 * DAY);
  assert.equal(row.provider_ref, "sub_real_1", "the subscription attached to the manual row");
  assert.equal(row.status, "active");

  // ...and now it is a real paid plan, so a manual grant refuses it
  const paid = await handleAdmin(adminReq("POST", "plus/manual", { email: "customer@example.com" }), env, { now: t0 + 3 * DAY });
  assert.equal(paid.status, 409);
  assert.equal((await paid.json()).error, "already_paid");

  // it never replaces a VIP pass
  const vip = await (await handleAdmin(adminReq("POST", "plus", { email: "friend@example.com" }), env, { now: t0 })).json();
  const refused = await handleAdmin(adminReq("POST", "plus/manual", { email: "friend@example.com" }), env, { now: t0 });
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, "already_vip");
  assert.equal(isCompPlus(await getPlus(env.DB, vip.accountId, t0)), true, "the VIP pass is untouched");

  // a manual grant can be ended by the owner; a paid plan cannot
  const lone = await (await handleAdmin(adminReq("POST", "plus/manual", { email: "lone@example.com", days: 5 }), env, { now: t0 })).json();
  assert.equal((await handleAdmin(adminReq("DELETE", `plus/${lone.accountId}`), env, { now: t0 + 1000 })).status, 200);
  assert.equal(plusActive(await getPlus(env.DB, lone.accountId, t0 + 2000), t0 + 2000), false);
  assert.equal((await handleAdmin(adminReq("DELETE", `plus/${granted.accountId}`), env, { now: t0 + 3 * DAY })).status, 409, "a real subscription is cancelled in Polar, not here");
});
