// The one gate for Frills Plus features (worker/plus-gate.mjs and plus-credential.mjs): every kind of visitor, through both things that can speak for an account (an overlay link's code, and
// being signed in on the website), over a real in-memory SQLite database with the real schema. The cases: a free visitor, a signed-in account with no Plus, Plus, credits used up, a cancelled
// subscription (still good until its end date), refunded, ended, paused, unpaid, and a locked region. Also: credits are one pool for the account whichever way it asks, and a code that is sent
// but is not live is not rescued by a cookie.

import test from "node:test";
import assert from "node:assert/strict";
import { COOKIE, handleAccount } from "../worker/account-routes.mjs";
import { resolveCredential } from "../worker/plus-credential.mjs";
import { plusGate, spendCharacters } from "../worker/plus-gate.mjs";
import { makeOverlayLink, endOverlayLink } from "../worker/overlay-links.mjs";
import { handleProStatus } from "../worker/region.mjs";
import { handleTts } from "../worker/tts.mjs";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";

const SITE = "https://frills.example";
const T0 = Date.parse("2026-12-01T12:00:00Z");
const DAY = 86_400_000;

const fresh = (extra = {}) => ({ DB: localDatabase(":memory:"), DEV: true, OPENAI_TTS_KEY: "sk-test", REQUIRE_PRO_PASS: "1", ...extra });
const give = (env, accountId, { status = "active", renews = T0 + 30 * DAY, used = 0, limit = 1500 } = {}) =>
  env.DB.raw.prepare("INSERT OR REPLACE INTO plus (account_id, provider_ref, order_ref, status, renews_at, tts_used, tts_limit, period_start, updated_at) VALUES (?, '1001', '2001', ?, ?, ?, ?, ?, ?)").run(accountId, status, renews, used, limit, T0, T0);
const used = (env, accountId) => env.DB.raw.prepare("SELECT tts_used FROM plus WHERE account_id = ?").get(accountId)?.tts_used;

/** An account that is signed in: its id and the cookie of a browser signed in as it. */
async function signedIn(env, email) {
  const sent = [];
  const mailer = { send: async (m) => { sent.push(m); return { ok: true }; } };
  await handleAccount(new Request(`${SITE}/api/account/login`, { method: "POST", headers: { origin: SITE, "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify({ email }) }), env, { now: T0, mailer });
  const verified = await handleAccount(new Request(`${SITE}/api/account/verify`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: JSON.stringify({ token: /#([A-Za-z0-9_-]{43})/.exec(sent[0].text)[1] }) }), env, { now: T0 + 1000 });
  return { id: env.DB.raw.prepare("SELECT id FROM accounts WHERE email = ?").get(email).id, cookie: `${COOKIE}=${/frills_session=([^;]*)/.exec(verified.headers.get("set-cookie"))[1]}` };
}
const request = ({ code, cookie, country = "US" } = {}) =>
  new Request(`${SITE}/api/tts`, { method: "POST", headers: { origin: SITE, "x-frills-country": country, ...(code ? { "x-overlay": code } : {}), ...(cookie ? { cookie } : {}) } });
const ask = (env, how, extra = {}) => plusGate(request({ ...how, ...extra }), env, { now: T0 + 5000 });
const refusal = (gate) => (gate.ok === false ? [gate.status, gate.error] : gate);

/** A world with one account in the wanted state, and both ways of asking as it. */
async function world(state) {
  const env = fresh();
  const me = await signedIn(env, "streamer@example.com");
  const code = await makeOverlayLink(env.DB, me.id);
  if (state) give(env, me.id, state);
  return { env, me, ways: { overlay: { code }, session: { cookie: me.cookie } } };
}

const CASES = [
  ["Plus, credits left", { used: 3, limit: 10 }, "allowed"],
  ["cancelled, before its end date", { status: "canceled", renews: T0 + 20 * DAY }, "allowed"],
  ["cancelled, after its end date", { status: "canceled", renews: T0 + 1000 }, [401, "invalid_pass"]],
  ["refunded", { status: "refunded", renews: null }, [401, "invalid_pass"]],
  ["ended", { status: "expired" }, [401, "invalid_pass"]],
  ["paused", { status: "paused" }, [401, "invalid_pass"]],
  ["unpaid", { status: "unpaid" }, [401, "invalid_pass"]],
  ["credits used up", { used: 10, limit: 10 }, [402, "quota_exceeded"]],
  ["no Plus bought", null, [401, "invalid_pass"]],
];

for (const [name, state, expected] of CASES) {
  test(`gate: an account with ${name} is ${expected === "allowed" ? "allowed" : `refused ${expected.join(" ")}`}, by its overlay link and by being signed in`, async () => {
    const { env, me, ways } = await world(state);
    for (const [way, how] of Object.entries(ways)) {
      const gate = await ask(env, how);
      if (expected === "allowed") {
        assert.deepEqual([gate.present, gate.ok, gate.kind, gate.accountId], [true, true, way, me.id], way);
      } else {
        assert.deepEqual(refusal(gate), expected, way);
      }
    }
    assert.equal(used(env, me.id), state ? state.used ?? 0 : undefined, "asking the gate spends nothing");
  });
}

test("gate: a free visitor (nothing brought, or only a stale cookie) is not 'present', so the caller can refuse them or, on a local server, allow them", async () => {
  const { env } = await world({ used: 0 });
  assert.deepEqual(await ask(env, {}), { present: false });
  assert.deepEqual(await ask(env, { cookie: `${COOKIE}=${"x".repeat(43)}` }), { present: false });
  assert.deepEqual(await plusGate(request(), { DEV: true }, { now: T0 }), { present: false }, "no database");
});

test("gate: an overlay code that is sent but is not live is refused, and a good cookie does not rescue it", async () => {
  const { env, me, ways } = await world({ used: 0 });
  const old = ways.overlay.code;
  await makeOverlayLink(env.DB, me.id); // replaces it
  assert.deepEqual(refusal(await ask(env, { code: old })), [401, "invalid_pass"], "a replaced code");
  assert.deepEqual(refusal(await ask(env, { code: old, cookie: me.cookie })), [401, "invalid_pass"], "a cookie beside it changes nothing");
  assert.deepEqual(refusal(await ask(env, { code: "f".repeat(32) })), [401, "invalid_pass"], "a made-up code");
  await endOverlayLink(env.DB, me.id);
  assert.equal((await ask(env, { cookie: me.cookie })).ok, true, "signed in on the website still works");
});

test("gate: a locked region is refused for both ways of asking, and does not matter for what the account bought", async () => {
  const { env, ways } = await world({ used: 0 });
  for (const how of Object.values(ways)) assert.deepEqual(refusal(await ask(env, how, { country: "PH" })), [403, "region_unavailable"]);
  const gate = await ask(env, ways.overlay, { country: "PH" });
  assert.equal(gate.country, "PH");
});

test("gate: nobody can use another account's Plus, by code or by cookie", async () => {
  const env = fresh();
  const alice = await signedIn(env, "alice@example.com");
  const bob = await signedIn(env, "bob@example.com");
  give(env, alice.id);
  const bobCode = await makeOverlayLink(env.DB, bob.id);
  assert.deepEqual(refusal(await ask(env, { code: bobCode })), [401, "invalid_pass"], "Bob has no Plus, and Alice's does not lend to him");
  assert.deepEqual(refusal(await ask(env, { cookie: bob.cookie })), [401, "invalid_pass"]);
  assert.equal((await ask(env, { cookie: alice.cookie })).accountId, alice.id);
});

test("credits are one pool for the account, whichever way it asks, and spending reports what is left", async () => {
  const { env, me, ways } = await world({ used: 8, limit: 10 });
  const first = await ask(env, ways.overlay);
  assert.deepEqual(await spendCharacters(env.DB, first.plus, 1), { ok: true, used: 9, limit: 10, remaining: 1, spent: 1 });
  const second = await ask(env, ways.session);
  assert.deepEqual(await spendCharacters(env.DB, second.plus, 1), { ok: true, used: 10, limit: 10, remaining: 0, spent: 1 });
  assert.equal(used(env, me.id), 10);
  for (const how of Object.values(ways)) assert.deepEqual(refusal(await ask(env, how)), [402, "quota_exceeded"]);
});

test("credential: who is asking is worked out the same everywhere, and a code beats a cookie", async () => {
  const { env, me, ways } = await world({ used: 0 });
  assert.deepEqual((await resolveCredential(request(ways.overlay), env)).kind, "overlay");
  assert.deepEqual((await resolveCredential(request(ways.session), env, { now: T0 + 5000 })).kind, "session");
  assert.equal((await resolveCredential(request({ ...ways.overlay, ...ways.session }), env, { now: T0 + 5000 })).kind, "overlay");
  assert.equal((await resolveCredential(request(), env)).kind, "none");
  assert.equal((await resolveCredential(request(), env, { overlayCode: ways.overlay.code })).accountId, me.id, "a code found in the request body counts too");
});

// ── through the real routes ───────────────────────────────────────────────────────────────────────────

const provider = async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } });
const speak = async (env, how, extra = {}) => {
  const res = await handleTts(new Request(`${SITE}/api/tts`, { method: "POST", headers: { origin: SITE, "content-type": "application/json", "x-frills-country": "US", ...(how.code ? { "x-overlay": how.code } : {}), ...(how.cookie ? { cookie: how.cookie } : {}) }, body: JSON.stringify({ text: "hello pond", voice: "nova" }) }), env, { fetchFn: provider, now: T0 + 5000, ...extra });
  return { status: res.status, headers: res.headers, error: res.headers.get("content-type")?.includes("json") ? (await res.json()).error : null };
};

test("the voice route: both ways of asking get a voice and share the account's credits; a free visitor and an account without Plus get none", async () => {
  const { env, me, ways } = await world({ used: 0, limit: 100 }); // (the line is "hello pond": 10 characters)
  const byCode = await speak(env, ways.overlay);
  const byCookie = await speak(env, ways.session);
  assert.deepEqual([byCode.status, byCookie.status], [200, 200]);
  assert.deepEqual([byCode.headers.get("x-tts-remaining"), byCookie.headers.get("x-tts-remaining")], ["90", "80"], "one pool, counted in characters");
  assert.equal(used(env, me.id), 20);
  assert.deepEqual([(await speak(env, {})).status, (await speak(env, {})).error], [401, "no_pass"], "a free visitor");
  const other = await signedIn(env, "free@example.com");
  assert.deepEqual([(await speak(env, { cookie: other.cookie })).status, (await speak(env, { cookie: other.cookie })).error], [401, "invalid_pass"], "signed in, no Plus");
  assert.equal(used(env, me.id), 20, "nothing refused spent anything");
});

test("the status route tells the editor what a signed-in account has (and an overlay what its code has), and nothing about a free visitor", async () => {
  const { env, ways } = await world({ used: 12, limit: 100 });
  const status = async (how) => (await handleProStatus(new Request(`${SITE}/api/pro/status`, { headers: { "x-frills-country": "US", ...(how.code ? { "x-overlay": how.code } : {}), ...(how.cookie ? { cookie: how.cookie } : {}) } }), env, { now: T0 + 5000 })).json();
  for (const how of Object.values(ways)) {
    const body = await status(how);
    assert.deepEqual([body.pass.valid, body.pass.used, body.pass.limit, body.pass.remaining], [true, 12, 100, 88]);
    assert.equal(body.aiReady, true);
  }
  assert.equal((await status({})).pass, undefined, "a free visitor has no pass block");
  const free = await signedIn(env, "free@example.com");
  assert.deepEqual((await status({ cookie: free.cookie })).pass, { valid: false, error: "invalid_pass" });
});
