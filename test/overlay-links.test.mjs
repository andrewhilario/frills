// Frills Plus overlay links (worker/overlay-links.mjs, the routes overlay-link and overlay-link-off, and the AI voice route accepting the code): the code stands for an account but is
// never the payment, only its hash is kept, a new link ends the old one, only an account with Plus can make one, and the voice route spends the ACCOUNT's credits and refuses a code that
// is not live, an account whose Plus has ended, an account out of credits, and a locked region.

import test from "node:test";
import assert from "node:assert/strict";
import { COOKIE, handleAccount } from "../worker/account-routes.mjs";
import { accountForOverlayCode, endOverlayLink, hasOverlayLink, makeOverlayLink, plusForOverlayCode } from "../worker/overlay-links.mjs";
import { deleteAccount } from "../worker/accounts.mjs";
import { handleProStatus } from "../worker/region.mjs";
import { handleTts } from "../worker/tts.mjs";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";

const SITE = "https://frills.example";
const T0 = Date.parse("2026-12-01T12:00:00Z");
const DAY = 86_400_000;
const ALICE = "aaaaaaaaaaaaaaaa";
const BOB = "bbbbbbbbbbbbbbbb";

const fresh = (extra = {}) => {
  const db = localDatabase(":memory:");
  for (const id of [ALICE, BOB]) db.raw.prepare("INSERT INTO accounts (id, email, created_at, last_login_at) VALUES (?, ?, ?, ?)").run(id, `${id}@example.com`, T0, T0);
  return { DB: db, DEV: true, ...extra };
};
const give = (env, account, { status = "active", renews = T0 + 30 * DAY, used = 0, limit = 1500 } = {}) =>
  env.DB.raw.prepare("INSERT OR REPLACE INTO plus (account_id, provider_ref, order_ref, status, renews_at, tts_used, tts_limit, period_start, updated_at) VALUES (?, '1001', '2001', ?, ?, ?, ?, ?, ?)").run(account, status, renews, used, limit, T0, T0);
const plusRow = (env, account = ALICE) => env.DB.raw.prepare("SELECT * FROM plus WHERE account_id = ?").get(account);

// ── the codes ─────────────────────────────────────────────────────────────────────────────────────────

test("a link code is 128 random bits, only its hash is kept, and it stands for one account", async () => {
  const env = fresh();
  const code = await makeOverlayLink(env.DB, ALICE, "tts", { now: T0 });
  assert.match(code, /^[0-9a-f]{32}$/);
  assert.equal(JSON.stringify(env.DB.raw.prepare("SELECT * FROM overlay_links").all()).includes(code), false, "the code itself is not stored");
  assert.equal((await accountForOverlayCode(env.DB, code)).accountId, ALICE);
  assert.equal(await hasOverlayLink(env.DB, ALICE), true);
  assert.equal(await hasOverlayLink(env.DB, BOB), false);
  assert.notEqual(await makeOverlayLink(env.DB, BOB), code, "every code is different");
});

test("a new link ends the old one at once; turning it off ends it; there is one live link per account", async () => {
  const env = fresh();
  const first = await makeOverlayLink(env.DB, ALICE);
  const second = await makeOverlayLink(env.DB, ALICE);
  assert.equal(await accountForOverlayCode(env.DB, first), null, "the old code stops working");
  assert.equal((await accountForOverlayCode(env.DB, second)).accountId, ALICE);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM overlay_links WHERE account_id = ?").get(ALICE).n, 1);
  assert.equal(await endOverlayLink(env.DB, ALICE), true);
  assert.equal(await accountForOverlayCode(env.DB, second), null);
  assert.equal(await endOverlayLink(env.DB, ALICE), false, "nothing left to end");
  await assert.rejects(() => makeOverlayLink(env.DB, ALICE, "chat"), "only the kinds that exist");
});

test("anything that is not a live code finds nothing, and a code for an account without Plus finds nothing for the voice route", async () => {
  const env = fresh();
  const code = await makeOverlayLink(env.DB, ALICE);
  for (const bad of [undefined, null, "", "nope", "0".repeat(32), code.toUpperCase(), code + "0", code.slice(1), " ".repeat(32)]) assert.equal(await accountForOverlayCode(env.DB, bad), null, String(bad));
  assert.equal(await plusForOverlayCode(env.DB, code, { now: T0 }), null, "no Plus bought");
  give(env, ALICE);
  assert.equal((await plusForOverlayCode(env.DB, code, { now: T0 })).accountId, ALICE);
  env.DB.raw.prepare("UPDATE plus SET status = 'expired'").run();
  assert.equal(await plusForOverlayCode(env.DB, code, { now: T0 }), null, "Plus ended");
});

test("deleting an account ends its link, and nobody else's", async () => {
  const env = fresh();
  const mine = await makeOverlayLink(env.DB, ALICE);
  const theirs = await makeOverlayLink(env.DB, BOB);
  await deleteAccount(env.DB, ALICE);
  assert.equal(await accountForOverlayCode(env.DB, mine), null);
  assert.notEqual(await accountForOverlayCode(env.DB, theirs), null);
});

// ── the routes ────────────────────────────────────────────────────────────────────────────────────────

async function signedIn(env, email = "streamer@example.com") {
  const sent = [];
  const mailer = { send: async (m) => { sent.push(m); return { ok: true }; } };
  const asked = await handleAccount(new Request(`${SITE}/api/account/login`, { method: "POST", headers: { origin: SITE, "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify({ email }) }), env, { now: T0, mailer });
  assert.equal(asked.status, 200);
  const token = /#([A-Za-z0-9_-]{43})/.exec(sent[0].text)[1];
  const verified = await handleAccount(new Request(`${SITE}/api/account/verify`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: JSON.stringify({ token }) }), env, { now: T0 + 1000 });
  return { cookie: `${COOKIE}=${/frills_session=([^;]*)/.exec(verified.headers.get("set-cookie"))[1]}`, id: env.DB.raw.prepare("SELECT id FROM accounts WHERE email = ?").get(email).id };
}
const account = async (env, action, { method = "POST", cookie = "", origin = SITE, now = T0 + 5000 } = {}) => {
  const res = await handleAccount(new Request(`${SITE}/api/account/${action}`, { method, headers: { ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}), "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" }), env, { now });
  return { status: res.status, body: await res.json() };
};

test("only a signed-in account with Plus can make a link; making another replaces it; turning it off works; the page is told whether one exists", async () => {
  const env = fresh();
  const me = await signedIn(env);
  assert.deepEqual((await account(env, "overlay-link")).body, { ok: false, error: "sign_in_first" });
  assert.deepEqual((await account(env, "overlay-link", { cookie: me.cookie })).body, { ok: false, error: "plus_required" }, "signed in but nothing bought");
  give(env, me.id);
  assert.equal((await account(env, "me", { method: "GET", cookie: me.cookie })).body.overlayLink, false);
  const one = (await account(env, "overlay-link", { cookie: me.cookie })).body;
  assert.equal(one.ok, true);
  assert.match(one.code, /^[0-9a-f]{32}$/);
  assert.equal((await account(env, "me", { method: "GET", cookie: me.cookie })).body.overlayLink, true);
  const two = (await account(env, "overlay-link", { cookie: me.cookie })).body;
  assert.notEqual(two.code, one.code);
  assert.equal(await accountForOverlayCode(env.DB, one.code), null, "replaced");
  assert.equal((await account(env, "overlay-link-off", { cookie: me.cookie })).status, 200);
  assert.equal(await accountForOverlayCode(env.DB, two.code), null, "turned off");
  assert.equal((await account(env, "me", { method: "GET", cookie: me.cookie })).body.overlayLink, false);
  assert.equal((await account(env, "overlay-link", { cookie: me.cookie, origin: "https://evil.example" })).status, 403, "another site cannot make one");
  assert.equal((await account(env, "overlay-link", { cookie: me.cookie, method: "GET" })).status, 405);
  env.DB.raw.prepare("UPDATE plus SET status = 'expired'").run();
  assert.equal((await account(env, "overlay-link", { cookie: me.cookie })).body.error, "plus_required", "Plus ended: no new link");
});

// ── the voice route ───────────────────────────────────────────────────────────────────────────────────

const speech = new Uint8Array([1, 2, 3, 4]);
const provider = async () => new Response(speech, { status: 200, headers: { "content-type": "audio/mpeg" } });
const tts = async (env, { code, country, now = T0 + 5000, viaBody = false } = {}) => {
  const headers = { origin: SITE, "content-type": "application/json", ...(country ? { "x-frills-country": country } : {}), ...(code && !viaBody ? { "x-overlay": code } : {}) };
  const res = await handleTts(new Request(`${SITE}/api/tts`, { method: "POST", headers, body: JSON.stringify({ text: "hello pond", voice: "nova", ...(code && viaBody ? { overlay: code } : {}) }) }), env, { fetchFn: provider, now });
  return { status: res.status, headers: res.headers, json: res.headers.get("content-type")?.includes("json") ? await res.json() : null };
};
const ready = () => fresh({ OPENAI_TTS_KEY: "sk-test", REQUIRE_PRO_PASS: "1" });

test("a live code with Plus speaks, and the credit comes out of the account's own month", async () => {
  const env = ready();
  give(env, ALICE, { used: 10, limit: 100 });
  const code = await makeOverlayLink(env.DB, ALICE);
  const res = await tts(env, { code, country: "US" }); // ("hello pond" is 10 characters)
  assert.equal(res.status, 200);
  assert.deepEqual([res.headers.get("x-tts-used"), res.headers.get("x-tts-limit"), res.headers.get("x-tts-remaining")], ["20", "100", "80"]);
  assert.equal(plusRow(env).tts_used, 20);
  assert.equal(plusRow(env, BOB), undefined, "nobody else's");
  assert.equal((await tts(env, { code, country: "US", viaBody: true })).status, 200, "the code may also come in the request body");
  assert.equal(plusRow(env).tts_used, 30);
});

test("no code, a made-up code, an old code, a turned-off code, and a code for an account without Plus are all refused, and spend nothing", async () => {
  const env = ready();
  give(env, ALICE);
  const first = await makeOverlayLink(env.DB, ALICE);
  const second = await makeOverlayLink(env.DB, ALICE);
  assert.deepEqual([(await tts(env, { country: "US" })).status, (await tts(env, { country: "US" })).json.error], [401, "no_pass"], "a free visitor");
  assert.equal((await tts(env, { code: "f".repeat(32), country: "US" })).json.error, "invalid_pass");
  assert.equal((await tts(env, { code: first, country: "US" })).json.error, "invalid_pass", "the old link");
  await endOverlayLink(env.DB, ALICE);
  assert.equal((await tts(env, { code: second, country: "US" })).json.error, "invalid_pass", "turned off");
  const bobCode = await makeOverlayLink(env.DB, BOB);
  assert.equal((await tts(env, { code: bobCode, country: "US" })).json.error, "invalid_pass", "an account that never bought Plus");
  env.DB.raw.prepare("UPDATE plus SET status = 'expired'").run();
  const third = await makeOverlayLink(env.DB, ALICE);
  assert.equal((await tts(env, { code: third, country: "US" })).json.error, "invalid_pass", "Plus ended");
  assert.equal(plusRow(env).tts_used, 0, "nothing was spent");
});

test("an account out of credits gets 402, and a locked region gets 403", async () => {
  const env = ready();
  give(env, ALICE, { used: 5, limit: 5 });
  const code = await makeOverlayLink(env.DB, ALICE);
  const out = await tts(env, { code, country: "US" });
  assert.deepEqual([out.status, out.json.error], [402, "quota_exceeded"]);
  env.DB.raw.prepare("UPDATE plus SET tts_used = 0").run();
  const locked = await tts(env, { code, country: "PH" });
  assert.deepEqual([locked.status, locked.json.error], [403, "region_unavailable"]);
  assert.equal(plusRow(env).tts_used, 0);
});

test("a cancelled subscription still speaks until its end date; a refunded one does not", async () => {
  const env = ready();
  give(env, ALICE, { status: "canceled", renews: T0 + 10 * DAY });
  const code = await makeOverlayLink(env.DB, ALICE);
  assert.equal((await tts(env, { code, country: "US" })).status, 200);
  assert.equal((await tts(env, { code, country: "US", now: T0 + 11 * DAY })).status, 401, "after the end date");
  give(env, ALICE, { status: "refunded", renews: null });
  assert.equal((await tts(env, { code, country: "US" })).status, 401);
});

test("the status route tells an overlay what is left, for a live code only, and never shows the account", async () => {
  const env = fresh({ OPENAI_TTS_KEY: "sk-test" });
  give(env, ALICE, { used: 30, limit: 100 });
  const code = await makeOverlayLink(env.DB, ALICE);
  const ask = async (headers) => (await handleProStatus(new Request(`${SITE}/api/pro/status`, { headers: { "x-frills-country": "US", ...headers } }), env, { now: T0 + 5000 })).json();
  const good = await ask({ "x-overlay": code });
  assert.deepEqual([good.pass.valid, good.pass.used, good.pass.limit, good.pass.remaining], [true, 30, 100, 70]);
  assert.equal(JSON.stringify(good).includes(ALICE), false, "no account id in the answer");
  assert.deepEqual((await ask({ "x-overlay": "e".repeat(32) })).pass, { valid: false, error: "invalid_pass" });
  assert.equal((await ask({})).pass, undefined, "no code: no pass block");
});
