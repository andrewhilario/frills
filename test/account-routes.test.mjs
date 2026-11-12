// The account web routes (worker/account-routes.mjs) over a real in-memory SQLite database with the real schema and a pretend mailer: the sign-in link is asked for and
// emailed (the same answer whoever asks), it is used once through a page that needs a button press, the cookie is set safely, and sign-out works. Also the limits and the refusals.

import test from "node:test";
import assert from "node:assert/strict";
import { COOKIE, handleAccount } from "../worker/account-routes.mjs";
import { getMailer, signInMessage } from "../worker/mailer.mjs";
import { LIMITS } from "../worker/accounts.mjs";
import worker from "../worker/index.mjs";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";

const SITE = "https://frills.example";
const T0 = 1_800_000_000_000;
const fresh = (extra = {}) => ({ DB: localDatabase(":memory:"), ...extra });
const pretendMailer = () => {
  const sent = [];
  return { sent, send: async (message) => { sent.push(message); return { ok: true }; } };
};

const call = async (env, action, { method = "POST", body, origin = SITE, cookie = "", now = T0, mailer, ip = "203.0.113.5", raw } = {}) => {
  const headers = { ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}), "content-type": "application/json", "cf-connecting-ip": ip };
  const res = await handleAccount(new Request(`${SITE}/api/account/${action}`, { method, headers, body: method === "GET" ? undefined : raw ?? JSON.stringify(body ?? {}) }), env, { now, mailer });
  return { status: res.status, body: await res.json(), cookie: res.headers.get("set-cookie") ?? "", headers: res.headers };
};
const tokenIn = (message) => /#([A-Za-z0-9_-]{43})/.exec(message.text)[1];
const cookieValue = (setCookie) => new RegExp(`${COOKIE}=([^;]*)`).exec(setCookie)?.[1] ?? "";

async function signedIn(env, mailer, email = "streamer@example.com", now = T0) {
  await call(env, "login", { body: { email }, mailer, now });
  const verified = await call(env, "verify", { body: { token: tokenIn(mailer.sent.at(-1)) }, now: now + 1000 });
  return { cookie: `${COOKIE}=${cookieValue(verified.cookie)}`, verified };
}

test("asking for a link emails it: the address, a link to the sign-in page with the token after the # (never sent to a server), and what to do if it was not asked for", async () => {
  const env = fresh();
  const mail = pretendMailer();
  const res = await call(env, "login", { body: { email: " Streamer@Example.com " }, mailer: mail });
  assert.deepEqual(res.body, { ok: true, minutes: 15 });
  assert.equal(mail.sent.length, 1);
  const [message] = mail.sent;
  assert.equal(message.to, "streamer@example.com");
  assert.match(message.text, /https:\/\/frills\.example\/account\/verify\/#[A-Za-z0-9_-]{43}\n/);
  assert.match(message.text, /works once, for 15 minutes/);
  assert.match(message.text, /If you did not ask for this/);
  assert.equal(message.text.includes("?token="), false, "the token is not in the part of the address a server sees");
  assert.equal(signInMessage("a@b.co", "https://x/y").subject, "Your Frills sign-in link");
});

test("the answer is the same for an address that has an account and one that has not", async () => {
  const env = fresh();
  const mail = pretendMailer();
  await signedIn(env, mail, "known@example.com");
  const known = await call(env, "login", { body: { email: "known@example.com" }, mailer: mail, now: T0 + 5000 });
  const unknown = await call(env, "login", { body: { email: "never.seen@example.com" }, mailer: mail, now: T0 + 5000 });
  assert.deepEqual([known.status, known.body], [unknown.status, unknown.body]);
});

test("a link signs in once: the cookie is HttpOnly, SameSite=Lax, Secure on the real site, and lasts 30 days; a second use fails", async () => {
  const env = fresh();
  const mail = pretendMailer();
  await call(env, "login", { body: { email: "streamer@example.com" }, mailer: mail });
  const token = tokenIn(mail.sent[0]);
  const first = await call(env, "verify", { body: { token }, now: T0 + 1000 });
  assert.deepEqual([first.status, first.body], [200, { ok: true, email: "streamer@example.com", created: true }]);
  assert.match(first.cookie, new RegExp(`^${COOKIE}=[A-Za-z0-9_-]{43};`));
  for (const part of ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${30 * 86400}`, "Secure"]) assert.ok(first.cookie.includes(part), part);
  const again = await call(env, "verify", { body: { token }, now: T0 + 2000 });
  assert.deepEqual([again.status, again.body], [400, { ok: false, error: "invalid_link" }]);
  assert.equal(again.cookie, "", "no cookie for a link that did not work");
  assert.equal((await call(env, "verify", { body: { token: "nonsense" } })).status, 400);
  assert.equal((await call(env, "verify", { body: {} })).status, 400);
});

test("on a local development server the cookie is not marked Secure (plain http), and nothing else about it changes", async () => {
  const env = fresh({ DEV: true });
  const mail = pretendMailer();
  const { verified } = await signedIn(env, mail);
  assert.equal(verified.cookie.includes("Secure"), false);
  assert.ok(verified.cookie.includes("HttpOnly") && verified.cookie.includes("SameSite=Lax"));
});

test("an expired link (over 15 minutes) does not sign in", async () => {
  const env = fresh();
  const mail = pretendMailer();
  await call(env, "login", { body: { email: "streamer@example.com" }, mailer: mail });
  const late = await call(env, "verify", { body: { token: tokenIn(mail.sent[0]) }, now: T0 + LIMITS.linkMs });
  assert.deepEqual(late.body, { ok: false, error: "invalid_link" });
});

test("who is signed in: nobody without the cookie, the email with it, and what they bought once they have bought", async () => {
  const env = fresh();
  const mail = pretendMailer();
  assert.deepEqual((await call(env, "me", { method: "GET" })).body, { ok: true, signedIn: false });
  assert.deepEqual((await call(env, "me", { method: "GET", cookie: `${COOKIE}=${"x".repeat(43)}` })).body, { ok: true, signedIn: false });
  const { cookie } = await signedIn(env, mail);
  const me = await call(env, "me", { method: "GET", cookie, now: T0 + 5000 });
  assert.deepEqual(me.body, { ok: true, signedIn: true, email: "streamer@example.com", checkout: false, portal: false, plus: null });
  const id = env.DB.raw.prepare("SELECT id FROM accounts").get().id;
  env.DB.raw.prepare("INSERT INTO plus (account_id, provider_ref, status, renews_at, tts_used, tts_limit, period_start, updated_at) VALUES (?, 'sub_9', 'active', ?, 12, 1500, ?, ?)").run(id, T0 + 86400000, T0, T0);
  const bought = await call(env, "me", { method: "GET", cookie, now: T0 + 5000 });
  assert.deepEqual(bought.body.plus, { status: "active", active: true, renewsAt: T0 + 86400000, used: 12, limit: 1500 });
  assert.equal(JSON.stringify(bought.body).includes("sub_9"), false, "the payment provider's id is not handed to the browser");
  assert.equal(bought.headers.get("cache-control"), "no-store");
});

test("signing out ends this browser's session and clears the cookie", async () => {
  const env = fresh();
  const mail = pretendMailer();
  const { cookie } = await signedIn(env, mail);
  const out = await call(env, "logout", { cookie, now: T0 + 5000 });
  assert.equal(out.status, 200);
  assert.match(out.cookie, new RegExp(`^${COOKIE}=; .*Max-Age=0`));
  assert.deepEqual((await call(env, "me", { method: "GET", cookie, now: T0 + 6000 })).body, { ok: true, signedIn: false }, "the old cookie no longer works, even if it is sent again");
  assert.equal((await call(env, "logout", { now: T0 })).status, 200, "signing out when not signed in is fine");
});

test("only this site can make a change, only the right method works, and the body is small and JSON", async () => {
  const env = fresh();
  const mail = pretendMailer();
  for (const action of ["login", "verify", "logout"]) {
    assert.equal((await call(env, action, { body: { email: "a@example.com" }, origin: "https://evil.example", mailer: mail })).status, 403, `${action}: another site`);
    assert.equal((await call(env, action, { body: { email: "a@example.com" }, origin: "", mailer: mail })).status, 403, `${action}: no origin`);
  }
  assert.equal(mail.sent.length, 0, "nothing was emailed to anyone");
  assert.equal((await call(env, "login", { method: "GET" })).status, 405);
  assert.equal((await call(env, "me", { method: "POST", body: {} })).status, 405);
  assert.equal((await call(env, "login", { raw: "{ not json", mailer: mail })).status, 400);
  assert.equal((await call(env, "login", { raw: "[1,2]", mailer: mail })).status, 400);
  assert.equal((await call(env, "login", { raw: JSON.stringify({ email: "a@example.com", pad: "x".repeat(600) }), mailer: mail })).status, 413);
  assert.equal((await call(env, "nope", { body: {} })).status, 404);
  for (const email of ["", "nope", "a@b", 7, null, "a@example.com\nbcc:x@y.com"]) assert.equal((await call(env, "login", { body: { email }, mailer: mail })).body.error, "bad_email", JSON.stringify(email));
  assert.equal(mail.sent.length, 0);
});

test("one address may ask for only so many links an hour, and the person is told to wait", async () => {
  const env = fresh();
  const mail = pretendMailer();
  for (let i = 0; i < LIMITS.perEmail; i++) assert.equal((await call(env, "login", { body: { email: "streamer@example.com" }, mailer: mail, now: T0 + i, ip: `198.51.100.${i}` })).status, 200);
  const blocked = await call(env, "login", { body: { email: "streamer@example.com" }, mailer: mail, now: T0 + 100, ip: "198.51.100.77" });
  assert.deepEqual([blocked.status, blocked.body], [429, { ok: false, error: "rate_limited" }]);
  assert.equal(mail.sent.length, LIMITS.perEmail, "nothing more was emailed");
});

test("with no email service the live site says so, and a failing mailer is reported without hiding it", async () => {
  const env = fresh();
  assert.deepEqual((await call(env, "login", { body: { email: "streamer@example.com" } })).body, { ok: false, error: "email_off" }, "no mailer and not a local server");
  const broken = { send: async () => { throw new Error("service down"); } };
  assert.deepEqual((await call(env, "login", { body: { email: "streamer@example.com" }, mailer: broken })).body, { ok: false, error: "mail_failed" });
  assert.deepEqual((await call(env, "login", { body: { email: "streamer@example.com" }, mailer: { send: async () => ({ ok: false }) } })).body, { ok: false, error: "mail_failed" });
  assert.equal((await handleAccount(new Request(`${SITE}/api/account/me`), {})).status, 503, "no database: not ready, not a crash");
});

test("the local development mailer writes each email in the outbox (and only a local server has one), and the link sends people to the configured site", async () => {
  assert.equal(getMailer({}), null);
  const dev = fresh({ DEV: true });
  assert.deepEqual((await call(dev, "login", { body: { email: "streamer@example.com" } })).body, { ok: true, minutes: 15 });
  assert.equal(dev.OUTBOX.length, 1);
  assert.match(dev.OUTBOX[0].text, /https:\/\/frills\.example\/account\/verify\/#/);
  const configured = fresh({ DEV: true, SITE_URL: "https://plus.example.org/" });
  await call(configured, "login", { body: { email: "streamer@example.com" } });
  assert.match(configured.OUTBOX[0].text, /^.*\n\nhttps:\/\/plus\.example\.org\/account\/verify\/#/s);
});

test("the real Worker routes the account address", async () => {
  const env = { ...fresh({ DEV: true }), ASSETS: { fetch: async () => new Response("asset") } };
  const res = await worker.fetch(new Request(`${SITE}/api/account/me`), env, { waitUntil() {} });
  assert.deepEqual(await res.json(), { ok: true, signedIn: false });
});
