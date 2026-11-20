// Managing an account (worker/portal.mjs and the routes portal, logout-all, delete in worker/account-routes.mjs) over a real in-memory SQLite database: the billing link is asked
// for fresh and only passed on if it is a Lemon Squeezy address, signing out everywhere ends every browser of one account only, and deleting an account needs the person's own email,
// refuses while a subscription is still renewing, and removes everything kept about them.

import test from "node:test";
import assert from "node:assert/strict";
import { COOKIE, handleAccount } from "../worker/account-routes.mjs";
import { acceptablePortalUrl, portalLink, portalReady } from "../worker/portal.mjs";
import { handlePlusWebhook } from "../worker/plus-webhook.mjs";
import { sessionAccount } from "../worker/accounts.mjs";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";
import { signedDelivery } from "../scripts/lib/lemon-fake.mjs";

const SITE = "https://frills.example";
const T0 = Date.parse("2026-12-01T12:00:00Z");
const DAY = 86_400_000;
const SECRET = "whsec-manage";
const SIGNED = "https://frills.lemonsqueezy.com/billing?expires=1&signature=abc";
const fresh = (extra = {}) => ({ DB: localDatabase(":memory:"), LEMON_WEBHOOK_SECRET: SECRET, LEMON_TEST_MODE: "1", ...extra });
const mailbox = () => { const sent = []; return { sent, send: async (m) => { sent.push(m); return { ok: true }; } }; };

const call = async (env, action, { method = "POST", body = {}, origin = SITE, cookie = "", now = T0, fetchFn } = {}) => {
  const headers = { ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}), "content-type": "application/json", "cf-connecting-ip": "203.0.113.5" };
  const res = await handleAccount(new Request(`${SITE}/api/account/${action}`, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body) }), env, { now, mailer: mailbox(), fetchFn });
  return { status: res.status, body: await res.json(), cookie: res.headers.get("set-cookie") ?? "" };
};
async function signIn(env, email = "streamer@example.com") {
  const mailer = mailbox();
  await handleAccount(new Request(`${SITE}/api/account/login`, { method: "POST", headers: { origin: SITE, "content-type": "application/json", "cf-connecting-ip": "203.0.113.5" }, body: JSON.stringify({ email }) }), env, { now: T0, mailer });
  const token = /#([A-Za-z0-9_-]{43})/.exec(mailer.sent[0].text)[1];
  const res = await call(env, "verify", { body: { token }, now: T0 + 1000 });
  return { cookie: `${COOKIE}=${new RegExp(`${COOKIE}=([^;]*)`).exec(res.cookie)[1]}`, accountId: env.DB.raw.prepare("SELECT id FROM accounts WHERE email = ?").get(email).id };
}
async function pay(env, accountId, extra = {}, now = T0 + 2000) {
  const { headers, body } = signedDelivery({ name: "subscription_created", account: accountId, subscription: "1001", order: "2001", at: now, testMode: false, ...extra }, SECRET);
  const res = await handlePlusWebhook(new Request(`${SITE}/api/webhooks/lemonsqueezy`, { method: "POST", headers, body }), env, { now });
  assert.equal((await res.json()).result, "applied");
}
const count = (env, table) => env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

// ── the billing link ──────────────────────────────────────────────────────────────────────────────────

test("a billing link is acceptable only if it is https on lemonsqueezy.com (plain http to this computer only on a local development server)", () => {
  assert.equal(acceptablePortalUrl(SIGNED), SIGNED);
  assert.notEqual(acceptablePortalUrl("https://lemonsqueezy.com/billing"), null);
  for (const bad of [undefined, "", "not a url", "http://frills.lemonsqueezy.com/billing", "https://evil.example/billing", "https://lemonsqueezy.com.evil.example/x", "https://notlemonsqueezy.com/x", "javascript:alert(1)", "https://u:p@frills.lemonsqueezy.com/x"]) assert.equal(acceptablePortalUrl(bad), null, String(bad));
  assert.equal(acceptablePortalUrl("http://localhost:3000/billing"), null);
  assert.notEqual(acceptablePortalUrl("http://localhost:3000/billing", true), null);
  assert.equal(acceptablePortalUrl("http://evil.example/billing", true), null);
  assert.equal(portalReady({}), false);
  assert.equal(portalReady({ LEMON_API_KEY: "k" }), true);
  assert.equal(portalReady({ LEMON_PORTAL_URL: "https://frills.lemonsqueezy.com/billing" }), true);
  assert.equal(portalReady({ LEMON_PORTAL_URL: "https://evil.example/billing" }), false);
});

test("the billing link is asked for from Lemon Squeezy's API with the key, for that subscription only, and only a Lemon Squeezy link is passed on", async () => {
  const calls = [];
  const fetchFn = async (url, options) => { calls.push([url, options.headers]); return new Response(JSON.stringify({ data: { attributes: { urls: { customer_portal: SIGNED } } } }), { status: 200 }); };
  assert.deepEqual(await portalLink({ LEMON_API_KEY: "sk-test" }, "1001", fetchFn), { ok: true, url: SIGNED });
  assert.equal(calls[0][0], "https://api.lemonsqueezy.com/v1/subscriptions/1001");
  assert.equal(calls[0][1].authorization, "Bearer sk-test");
  assert.equal(calls[0][1].accept, "application/vnd.api+json");
  const evil = async () => new Response(JSON.stringify({ data: { attributes: { urls: { customer_portal: "https://evil.example/steal" } } } }), { status: 200 });
  assert.deepEqual(await portalLink({ LEMON_API_KEY: "k" }, "1001", evil), { ok: false, error: "provider_error" }, "an address that is not Lemon Squeezy's is never passed on");
  assert.equal((await portalLink({ LEMON_API_KEY: "k", LEMON_PORTAL_URL: "https://frills.lemonsqueezy.com/billing" }, "1001", evil)).url, "https://frills.lemonsqueezy.com/billing", "the store's billing page is the fallback");
  assert.equal((await portalLink({ LEMON_API_KEY: "k" }, "1001", async () => new Response("{}", { status: 500 }))).error, "provider_error");
  assert.equal((await portalLink({ LEMON_API_KEY: "k" }, "1001", async () => { throw new Error("network"); })).error, "provider_error");
  assert.equal((await portalLink({ LEMON_API_KEY: "k" }, "../../x", async () => { throw new Error("must not be called"); })).error, "provider_error", "a subscription id that is not a number never reaches the address");
  assert.deepEqual(await portalLink({}, "1001", fetchFn), { ok: false, error: "portal_off" });
  assert.equal((await portalLink({ LEMON_PORTAL_URL: "https://frills.lemonsqueezy.com/billing" }, "1001", fetchFn)).url, "https://frills.lemonsqueezy.com/billing", "without a key the store's page is used");
});

test("Manage or cancel: signed in with a subscription gets a fresh link; nobody else, and nothing without a subscription", async () => {
  const env = fresh({ LEMON_API_KEY: "sk-test" });
  const fetchFn = async () => new Response(JSON.stringify({ data: { attributes: { urls: { customer_portal: SIGNED } } } }), { status: 200 });
  assert.deepEqual((await call(env, "portal", { fetchFn })).body, { ok: false, error: "sign_in_first" });
  const { cookie, accountId } = await signIn(env);
  assert.deepEqual((await call(env, "portal", { cookie, fetchFn, now: T0 + 5000 })).body, { ok: false, error: "no_subscription" }, "nothing bought yet");
  await pay(env, accountId);
  const res = await call(env, "portal", { cookie, fetchFn, now: T0 + 5000 });
  assert.deepEqual([res.status, res.body], [200, { ok: true, url: SIGNED }]);
  assert.equal((await call(env, "portal", { cookie, fetchFn, origin: "https://evil.example" })).status, 403);
  assert.equal((await call(env, "portal", { cookie, fetchFn, method: "GET" })).status, 405);
  const off = fresh();
  const other = await signIn(off, "other@example.com");
  await pay(off, other.accountId);
  assert.deepEqual((await call(off, "portal", { cookie: other.cookie, now: T0 + 5000 })).body, { ok: false, error: "portal_off" });
  const broken = await call(env, "portal", { cookie, now: T0 + 5000, fetchFn: async () => new Response("{}", { status: 500 }) });
  assert.deepEqual([broken.status, broken.body.error], [502, "provider_error"]);
});

test("the page is told whether Manage or cancel can work", async () => {
  const withKey = fresh({ LEMON_API_KEY: "k" });
  assert.equal((await call(withKey, "me", { method: "GET", cookie: (await signIn(withKey)).cookie, now: T0 + 5000 })).body.portal, true);
  const without = fresh();
  assert.equal((await call(without, "me", { method: "GET", cookie: (await signIn(without)).cookie, now: T0 + 5000 })).body.portal, false);
});

// ── sign out everywhere ──────────────────────────────────────────────────────────────────────────────

test("sign out everywhere ends every browser of this account and no other, and clears this cookie", async () => {
  const env = fresh();
  const one = await signIn(env, "streamer@example.com");
  const two = await signIn(env, "streamer@example.com");
  const other = await signIn(env, "other@example.com");
  assert.deepEqual((await call(env, "logout-all")).body, { ok: false, error: "sign_in_first" });
  const out = await call(env, "logout-all", { cookie: one.cookie, now: T0 + 5000 });
  assert.equal(out.status, 200);
  assert.match(out.cookie, new RegExp(`^${COOKIE}=; .*Max-Age=0`));
  for (const who of [one, two]) assert.equal(await sessionAccount(env.DB, who.cookie.split("=")[1], { now: T0 + 6000 }), null);
  assert.notEqual(await sessionAccount(env.DB, other.cookie.split("=")[1], { now: T0 + 6000 }), null, "the other person is still signed in");
  assert.equal((await call(env, "logout-all", { cookie: other.cookie, origin: "https://evil.example", now: T0 + 7000 })).status, 403);
});

// ── delete ────────────────────────────────────────────────────────────────────────────────────────────

test("deleting needs the person's own email typed exactly (capitals do not matter), and nothing is deleted without it", async () => {
  const env = fresh();
  const { cookie } = await signIn(env);
  assert.deepEqual((await call(env, "delete", { body: { email: "streamer@example.com" } })).body, { ok: false, error: "sign_in_first" });
  for (const body of [{}, { email: "" }, { email: "someone.else@example.com" }, { email: 7 }, { confirm: "yes" }]) assert.deepEqual((await call(env, "delete", { cookie, body, now: T0 + 5000 })).body, { ok: false, error: "confirm_mismatch" }, JSON.stringify(body));
  assert.equal(count(env, "accounts"), 1);
  assert.equal((await call(env, "delete", { cookie, body: { email: "streamer@example.com" }, origin: "https://evil.example", now: T0 + 5000 })).status, 403);
  assert.equal(count(env, "accounts"), 1);
  const done = await call(env, "delete", { cookie, body: { email: "  Streamer@Example.COM " }, now: T0 + 5000 });
  assert.equal(done.status, 200);
  assert.match(done.cookie, /Max-Age=0/);
  assert.equal(count(env, "accounts"), 0);
});

test("a subscription that is still renewing must be cancelled first; a cancelled one, an ended one, or none does not stop the deletion", async () => {
  const env = fresh();
  const { cookie, accountId } = await signIn(env);
  await pay(env, accountId);
  const refused = await call(env, "delete", { cookie, body: { email: "streamer@example.com" }, now: T0 + 5000 });
  assert.deepEqual([refused.status, refused.body.error], [409, "cancel_first"]);
  assert.equal(count(env, "accounts"), 1, "nothing was deleted");
  assert.equal(count(env, "plus"), 1);
  env.DB.raw.prepare("UPDATE plus SET status = 'canceled', renews_at = ?").run(T0 + 10 * DAY);
  assert.equal((await call(env, "delete", { cookie, body: { email: "streamer@example.com" }, now: T0 + 5000 })).status, 200, "cancelled and paid until later: the person decides");
  const ended = fresh();
  const b = await signIn(ended, "b@example.com");
  await pay(ended, b.accountId);
  ended.DB.raw.prepare("UPDATE plus SET status = 'expired'").run();
  assert.equal((await call(ended, "delete", { cookie: b.cookie, body: { email: "b@example.com" }, now: T0 + 5000 })).status, 200);
  const none = fresh();
  const c = await signIn(none, "c@example.com");
  assert.equal((await call(none, "delete", { cookie: c.cookie, body: { email: "c@example.com" }, now: T0 + 5000 })).status, 200);
});

test("deleting removes the account, every session, the sign-in links and what was bought, and nobody else's; a late payment notice for it does nothing", async () => {
  const env = fresh();
  const gone = await signIn(env, "gone@example.com");
  const second = await signIn(env, "gone@example.com");
  const kept = await signIn(env, "kept@example.com");
  await pay(env, gone.accountId);
  await pay(env, kept.accountId, { subscription: "1002", order: "2002" });
  env.DB.raw.prepare("UPDATE plus SET status = 'canceled', renews_at = ? WHERE account_id = ?").run(T0 + 10 * DAY, gone.accountId);
  assert.equal((await call(env, "delete", { cookie: gone.cookie, body: { email: "gone@example.com" }, now: T0 + 5000 })).status, 200);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM accounts WHERE email = 'gone@example.com'").get().n, 0);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM login_links WHERE email = 'gone@example.com'").get().n, 0);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM plus WHERE account_id = ?").get(gone.accountId).n, 0);
  assert.equal(await sessionAccount(env.DB, second.cookie.split("=")[1], { now: T0 + 6000 }), null, "the other browser of the deleted account is out too");
  assert.deepEqual((await call(env, "me", { method: "GET", cookie: gone.cookie, now: T0 + 6000 })).body, { ok: true, signedIn: false });
  assert.notEqual(await sessionAccount(env.DB, kept.cookie.split("=")[1], { now: T0 + 6000 }), null);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM plus WHERE account_id = ?").get(kept.accountId).n, 1, "the other person's Plus is untouched");
  const { headers, body } = signedDelivery({ name: "subscription_payment_success", subscription: "1001", at: T0 + 7000, testMode: false }, SECRET);
  const late = await (await handlePlusWebhook(new Request(`${SITE}/api/webhooks/lemonsqueezy`, { method: "POST", headers, body }), env, { now: T0 + 7000 })).json();
  assert.equal(late.reason, "unknown_subscription");
});
