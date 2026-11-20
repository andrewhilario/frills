// Getting to the checkout (worker/checkout.mjs and POST /api/account/checkout): the address carries the buyer's email and our account id and nothing a configured link tried to
// put there, a link that is not acceptable is refused, only a signed-in person gets one, nobody who already has Plus is sent to pay again, and the page is told when there is no checkout.

import test from "node:test";
import assert from "node:assert/strict";
import { COOKIE, handleAccount } from "../worker/account-routes.mjs";
import { checkoutLink, checkoutReady } from "../worker/checkout.mjs";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";

const SITE = "https://frills.example";
const T0 = 1_800_000_000_000;
const STORE = "https://frills.lemonsqueezy.com/checkout/buy/00000000-1111-2222-3333-444444444444";
const ID = "0123456789abcdef";
const fresh = (extra = {}) => ({ DB: localDatabase(":memory:"), ...extra });
const mailbox = () => { const sent = []; return { sent, send: async (m) => { sent.push(m); return { ok: true }; } }; };

const call = async (env, action, { method = "POST", body = {}, origin = SITE, cookie = "", now = T0, mailer } = {}) => {
  const headers = { ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}), "content-type": "application/json", "cf-connecting-ip": "203.0.113.5" };
  const res = await handleAccount(new Request(`${SITE}/api/account/${action}`, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body) }), env, { now, mailer });
  return { status: res.status, body: await res.json(), cookie: res.headers.get("set-cookie") ?? "", headers: res.headers };
};
async function signedIn(env, email = "streamer@example.com") {
  const mailer = mailbox();
  await call(env, "login", { body: { email }, mailer });
  const token = /#([A-Za-z0-9_-]{43})/.exec(mailer.sent[0].text)[1];
  const verified = await call(env, "verify", { body: { token }, now: T0 + 1000 });
  return `${COOKIE}=${new RegExp(`${COOKIE}=([^;]*)`).exec(verified.cookie)[1]}`;
}

test("the checkout address carries the buyer's email and our account id, in the places Lemon Squeezy reads them", () => {
  const link = new URL(checkoutLink(STORE, { email: "streamer+tips@example.com", accountId: ID }));
  assert.equal(link.origin + link.pathname, STORE);
  assert.equal(link.searchParams.get("checkout[email]"), "streamer+tips@example.com", "a + in an email survives");
  assert.equal(link.searchParams.get("checkout[custom][account_id]"), ID);
});

test("a value already in the configured link cannot replace ours, and its other settings stay", () => {
  const configured = `${STORE}?discount=0&checkout[email]=someone@else.com&checkout[custom][account_id]=ffffffffffffffff`;
  const link = new URL(checkoutLink(configured, { email: "streamer@example.com", accountId: ID }));
  assert.equal(link.searchParams.get("checkout[email]"), "streamer@example.com");
  assert.equal(link.searchParams.get("checkout[custom][account_id]"), ID);
  assert.equal(link.searchParams.get("discount"), "0");
  assert.equal(link.searchParams.getAll("checkout[custom][account_id]").length, 1);
});

test("a checkout link that is missing, not https, or odd is refused (plain http only to this computer, on a local development server)", () => {
  const who = { email: "streamer@example.com", accountId: ID };
  for (const bad of [undefined, null, "", "   ", "not a url", "http://frills.lemonsqueezy.com/checkout/buy/x", "javascript:alert(1)", "ftp://x.example/y", "https://user:pass@frills.lemonsqueezy.com/x"]) assert.equal(checkoutLink(bad, who), null, String(bad));
  assert.equal(checkoutLink("http://localhost:3000/pay", who), null, "not a local server: refused");
  assert.notEqual(checkoutLink("http://localhost:3000/pay", who, { dev: true }), null);
  assert.equal(checkoutLink("http://evil.example/pay", who, { dev: true }), null, "a local server still refuses plain http to other hosts");
  assert.equal(checkoutLink(STORE, { email: "streamer@example.com", accountId: "not-an-id" }), null);
  assert.equal(checkoutLink(STORE, { email: "nope", accountId: ID }), null);
  assert.equal(checkoutReady(STORE), true);
  assert.equal(checkoutReady(""), false);
});

test("a signed-in person gets their own checkout address; a signed-out one, or another site, does not", async () => {
  const env = fresh({ LEMON_CHECKOUT_URL: STORE });
  assert.deepEqual((await call(env, "checkout")).body, { ok: false, error: "sign_in_first" }, "signed out");
  assert.equal((await call(env, "checkout", { cookie: `${COOKIE}=${"x".repeat(43)}` })).status, 401, "a cookie that is not a session");
  const cookie = await signedIn(env);
  const res = await call(env, "checkout", { cookie, now: T0 + 5000 });
  assert.equal(res.status, 200);
  const url = new URL(res.body.url);
  assert.equal(url.searchParams.get("checkout[email]"), "streamer@example.com");
  assert.equal(url.searchParams.get("checkout[custom][account_id]"), env.DB.raw.prepare("SELECT id FROM accounts").get().id);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal((await call(env, "checkout", { cookie, origin: "https://evil.example" })).status, 403, "another site cannot make a visitor open a checkout");
  assert.equal((await call(env, "checkout", { method: "GET", cookie })).status, 405);
});

test("two people each get their own account id in their own address", async () => {
  const env = fresh({ LEMON_CHECKOUT_URL: STORE });
  const a = await signedIn(env, "one@example.com");
  const b = await signedIn(env, "two@example.com");
  const urlA = new URL((await call(env, "checkout", { cookie: a, now: T0 + 5000 })).body.url);
  const urlB = new URL((await call(env, "checkout", { cookie: b, now: T0 + 5000 })).body.url);
  assert.equal(urlA.searchParams.get("checkout[email]"), "one@example.com");
  assert.equal(urlB.searchParams.get("checkout[email]"), "two@example.com");
  assert.notEqual(urlA.searchParams.get("checkout[custom][account_id]"), urlB.searchParams.get("checkout[custom][account_id]"));
});

test("with no checkout link set the checkout says it is off, and the page is told so (and told when it is on)", async () => {
  const off = fresh();
  const cookie = await signedIn(off);
  assert.deepEqual((await call(off, "checkout", { cookie, now: T0 + 5000 })).body, { ok: false, error: "checkout_off" });
  assert.equal((await call(off, "me", { method: "GET", cookie, now: T0 + 5000 })).body.checkout, false);
  const on = fresh({ LEMON_CHECKOUT_URL: STORE });
  const cookieOn = await signedIn(on);
  assert.equal((await call(on, "me", { method: "GET", cookie: cookieOn, now: T0 + 5000 })).body.checkout, true);
  const bad = fresh({ LEMON_CHECKOUT_URL: "http://not-https.example/pay" });
  assert.equal((await call(bad, "checkout", { cookie: await signedIn(bad), now: T0 + 5000 })).body.error, "checkout_off", "an unacceptable link counts as no link");
});

test("someone who already has Plus is not sent to pay again; one whose Plus was cancelled can buy again", async () => {
  const env = fresh({ LEMON_CHECKOUT_URL: STORE });
  const cookie = await signedIn(env);
  const id = env.DB.raw.prepare("SELECT id FROM accounts").get().id;
  const put = (status) => env.DB.raw.prepare("INSERT OR REPLACE INTO plus (account_id, provider_ref, status, renews_at, tts_used, tts_limit, period_start, updated_at) VALUES (?, 'sub_1', ?, NULL, 0, 1500, ?, ?)").run(id, status, T0, T0);
  put("active");
  assert.deepEqual((await call(env, "checkout", { cookie, now: T0 + 5000 })).body, { ok: false, error: "already_plus" });
  put("canceled");
  assert.equal((await call(env, "checkout", { cookie, now: T0 + 5000 })).status, 200);
});

test("checkout respects Tier-1 region gating on Cloudflare and allows owner IPs listed in PRO_ALLOW_IPS", async () => {
  const env = fresh({ LEMON_CHECKOUT_URL: STORE, PRO_ALLOW_IPS: "198.51.100.42" });
  const cookie = await signedIn(env);
  const reqWithCf = (action, method, country, ip) => {
    const r = new Request(`${SITE}/api/account/${action}`, {
      method,
      headers: { origin: SITE, cookie, "content-type": "application/json", "cf-connecting-ip": ip },
      body: method === "GET" ? undefined : "{}",
    });
    Object.defineProperty(r, "cf", { value: { country }, configurable: true });
    return r;
  };

  // Non-Tier-1 visitor whose IP is not allowlisted cannot start checkout
  const blockedMe = await (await handleAccount(reqWithCf("me", "GET", "PH", "198.51.100.99"), env, { now: T0 + 5000 })).json();
  assert.equal(blockedMe.checkout, false);
  const blockedPay = await handleAccount(reqWithCf("checkout", "POST", "PH", "198.51.100.99"), env, { now: T0 + 5000 });
  assert.deepEqual([blockedPay.status, (await blockedPay.json()).error], [403, "region_unavailable"]);

  // Owner in PH whose IP is in PRO_ALLOW_IPS can see checkout and open Lemon Squeezy
  const allowedMe = await (await handleAccount(reqWithCf("me", "GET", "PH", "198.51.100.42"), env, { now: T0 + 5000 })).json();
  assert.equal(allowedMe.checkout, true);
  const allowedPay = await handleAccount(reqWithCf("checkout", "POST", "PH", "198.51.100.42"), env, { now: T0 + 5000 });
  assert.equal(allowedPay.status, 200);
});
