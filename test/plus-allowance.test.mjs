// The AI voice allowance of Frills Plus, counted in CHARACTERS (worker/plus-gate.mjs spendCharacters / giveBackCharacters, worker/tts.mjs, the allowance set in worker/plus-webhook.mjs), over a
// real in-memory SQLite database with the real schema. What this protects is money: the voice companies charge per character, so the most a month can cost has to be bounded.
//   - the count is of the words actually spoken (after cleaning, at most 220), in whole characters (an emoji is one), and shown in the answer's headers;
//   - the characters are taken BEFORE the voice is made, in one step, so a burst of requests at once cannot all slip through and each cost money;
//   - a voice that could not be made costs nothing (the characters go back); a refusal costs nothing, and the voice company is not even asked;
//   - a line longer than what is left is still spoken, once (the month then reads all used, never more), and after that every request is refused (402);
//   - a whole month of the longest lines, one after another, never sends more than the allowance plus one line to the voice company, and that is under the cost the plan relies on;
//   - a renewal payment gives the month back; the allowance a new subscription starts with is 150,000 characters.

import test from "node:test";
import assert from "node:assert/strict";
import { COOKIE, handleAccount } from "../worker/account-routes.mjs";
import { handleTts, TTS_LIMITS } from "../worker/tts.mjs";
import { giveBackCharacters, spendCharacters } from "../worker/plus-gate.mjs";
import { makeOverlayLink } from "../worker/overlay-links.mjs";
import { handlePlusWebhook } from "../worker/plus-webhook.mjs";
import { signedDelivery } from "../scripts/lib/lemon-fake.mjs";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";

const SITE = "https://frills.example";
const T0 = Date.parse("2026-12-01T12:00:00Z");
const DAY = 86_400_000;
const NOW = T0 + 5000;
const SECRET = "whsec-for-tests";

const fresh = () => ({ DB: localDatabase(":memory:"), DEV: true, OPENAI_TTS_KEY: "sk-test", REQUIRE_PRO_PASS: "1", LEMON_WEBHOOK_SECRET: SECRET, LEMON_TEST_MODE: "1" });

/** A signed-in account with Plus (`limit` characters, `used` already used) and a live overlay link code. */
async function account(env, { limit = 100, used = 0 } = {}) {
  const sent = [];
  const mailer = { send: async (m) => { sent.push(m); return { ok: true }; } };
  await handleAccount(new Request(`${SITE}/api/account/login`, { method: "POST", headers: { origin: SITE, "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify({ email: "streamer@example.com" }) }), env, { now: T0, mailer });
  const verified = await handleAccount(new Request(`${SITE}/api/account/verify`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: JSON.stringify({ token: /#([A-Za-z0-9_-]{43})/.exec(sent[0].text)[1] }) }), env, { now: T0 + 1000 });
  const id = env.DB.raw.prepare("SELECT id FROM accounts WHERE email = 'streamer@example.com'").get().id;
  env.DB.raw.prepare("INSERT INTO plus (account_id, provider_ref, order_ref, status, renews_at, tts_used, tts_limit, period_start, updated_at) VALUES (?, '1001', '2001', 'active', ?, ?, ?, ?, ?)").run(id, T0 + 30 * DAY, used, limit, T0, T0);
  return { id, cookie: `${COOKIE}=${/frills_session=([^;]*)/.exec(verified.headers.get("set-cookie"))[1]}`, code: await makeOverlayLink(env.DB, id) };
}
const row = (env, id) => ({ ...env.DB.raw.prepare("SELECT tts_used, tts_limit FROM plus WHERE account_id = ?").get(id) });

/** A voice company that counts what it was asked to say, and can be made to fail. */
function voiceCompany({ fail = false, throws = false } = {}) {
  const asked = [];
  const fetchFn = async (url, init) => {
    asked.push([...JSON.parse(init.body).input].length);
    if (throws) throw new Error("network down");
    return fail ? new Response("{}", { status: 500 }) : new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } });
  };
  return { asked, fetchFn, total: () => asked.reduce((a, n) => a + n, 0) };
}
const speak = (env, who, text, company, how = "overlay") => handleTts(
  new Request(`${SITE}/api/tts`, { method: "POST", headers: { origin: SITE, "content-type": "application/json", "x-frills-country": "US", ...(how === "overlay" ? { "x-overlay": who.code } : { cookie: who.cookie }) }, body: JSON.stringify({ text, voice: "nova" }) }),
  env, { fetchFn: company.fetchFn, now: NOW },
);

test("what is counted is the words actually spoken: cleaned up, at most 220, whole characters (an emoji is one), and the answer says what it took", async () => {
  const env = fresh();
  const me = await account(env, { limit: 1000 });
  const company = voiceCompany();
  const spokenAs = async (text) => { const res = await speak(env, me, text, company); return [res.status, res.headers.get("x-tts-spent")]; };
  assert.deepEqual(await spokenAs("hello pond"), [200, "10"]);
  assert.deepEqual(await spokenAs("  hello \n\n   pond \t "), [200, "10"], "spaces and line breaks are cleaned before counting");
  assert.deepEqual(await spokenAs("hi \u{1F600}"), [200, "4"], "an emoji is one character, not two");
  assert.deepEqual(await spokenAs("x".repeat(500)), [200, String(TTS_LIMITS.maxChars)], "a long line is cut to 220 first");
  assert.deepEqual(company.asked, [10, 10, 4, 220], "and the voice company was asked for exactly what was counted");
  assert.equal(row(env, me.id).tts_used, 10 + 10 + 4 + 220);
  const last = await speak(env, me, "a", company, "session");
  assert.deepEqual([last.headers.get("x-tts-used"), last.headers.get("x-tts-limit"), last.headers.get("x-tts-remaining"), last.headers.get("x-tts-spent")], ["245", "1000", "755", "1"], "the same pool by the signed-in way");
});

test("a burst of requests at once cannot get past the limit: the characters are taken in one step, and only the voices that were paid for are made", async () => {
  const env = fresh();
  const me = await account(env, { limit: 100 });
  const company = voiceCompany();
  const line = "x".repeat(30);
  const answers = await Promise.all(Array.from({ length: 20 }, () => speak(env, me, line, company)));
  const statuses = answers.map((a) => a.status).sort();
  assert.deepEqual([statuses.filter((s) => s === 200).length, statuses.filter((s) => s === 402).length], [4, 16], "30, 60, 90, then one that crosses 100: four voices, sixteen refused");
  assert.equal(company.asked.length, 4, "the voice company was asked four times, not twenty");
  assert.equal(row(env, me.id).tts_used, 100, "the month reads all used, not 120");
});

test("with nothing left, the voice company is not asked and nothing changes; a line longer than what is left is spoken once, and then it stops", async () => {
  const env = fresh();
  const me = await account(env, { limit: 50, used: 50 });
  const company = voiceCompany();
  const none = await speak(env, me, "hello", company);
  assert.deepEqual([none.status, (await none.json()).error], [402, "quota_exceeded"]);
  assert.equal(company.asked.length, 0);
  assert.equal(row(env, me.id).tts_used, 50);

  const env2 = fresh();
  const me2 = await account(env2, { limit: 50, used: 45 });
  const long = await speak(env2, me2, "this line is much longer than the five characters left", company);
  assert.deepEqual([long.status, long.headers.get("x-tts-used"), long.headers.get("x-tts-remaining")], [200, "50", "0"], "spoken, and the month reads all used");
  assert.equal(row(env2, me2.id).tts_used, 50, "never more than the limit");
  assert.equal((await speak(env2, me2, "one more", company)).status, 402);
  assert.equal(company.asked.length, 1);
});

test("a voice that could not be made costs nothing, whether the company said no or could not be reached", async () => {
  for (const options of [{ fail: true }, { throws: true }]) {
    const env = fresh();
    const me = await account(env, { limit: 100, used: 20 });
    const company = voiceCompany(options);
    const res = await speak(env, me, "hello pond", company);
    assert.deepEqual([res.status, (await res.json()).error], [502, "provider_error"], JSON.stringify(options));
    assert.equal(company.asked.length, 1, "it was tried");
    assert.equal(row(env, me.id).tts_used, 20, "and the 10 characters went back");
  }
});

test("spendCharacters and giveBackCharacters on their own: exact, capped at the limit, never below nothing, and a refusal says the limit", async () => {
  const env = fresh();
  const me = await account(env, { limit: 100, used: 90 });
  const plus = { account_id: me.id, tts_used: 90, tts_limit: 100 };
  assert.deepEqual(await spendCharacters(env.DB, plus, 4), { ok: true, used: 94, limit: 100, remaining: 6, spent: 4 });
  assert.deepEqual(await spendCharacters(env.DB, plus, 50), { ok: true, used: 100, limit: 100, remaining: 0, spent: 50 }, "crossing the limit is allowed once and capped");
  assert.deepEqual(await spendCharacters(env.DB, plus, 1), { ok: false, limit: 100 });
  await giveBackCharacters(env.DB, plus, 30);
  assert.equal(row(env, me.id).tts_used, 70);
  await giveBackCharacters(env.DB, plus, 5000);
  assert.equal(row(env, me.id).tts_used, 0, "never below nothing used");
  await giveBackCharacters(env.DB, plus, -3);
  await giveBackCharacters(env.DB, plus, "nonsense");
  assert.equal(row(env, me.id).tts_used, 0);
  assert.equal((await spendCharacters(env.DB, plus, 0)).spent, 1, "an empty or odd amount counts as one, so a request is never free");
});

test("a whole month of the longest lines, one after another, sends the voice company no more than the allowance plus one line, and that costs less than the plan relies on", async () => {
  const env = fresh();
  const me = await account(env, { limit: 150_000 });
  const company = voiceCompany();
  const long = "x".repeat(TTS_LIMITS.maxChars);
  let spoken = 0;
  let refused = 0;
  for (let i = 0; i < 700; i += 1) {
    const res = await speak(env, me, long, company, i % 2 ? "overlay" : "session");
    if (res.status === 200) spoken += 1; else { refused += 1; assert.equal(res.status, 402); }
  }
  assert.equal(spoken, 682, "150,000 / 220 = 681.8: the 682nd line crosses the limit and is the last");
  assert.equal(refused, 18);
  assert.ok(company.total() <= 150_000 + TTS_LIMITS.maxChars - 1, `the voice company was asked for ${company.total()} characters`);
  assert.ok(company.total() >= 150_000, "and the allowance really is all there to use");
  assert.ok((company.total() / 1_000_000) * 22 < 3.4, "at the dearest voice price in the plan ($22 per million characters) the worst month costs under $3.40");
  assert.equal(row(env, me.id).tts_used, 150_000);
});

test("a renewal payment gives the month back, so a used-up account speaks again; and a new subscription starts with 150,000 characters", async () => {
  const env = fresh();
  const id = "aaaaaaaaaaaaaaaa";
  env.DB.raw.prepare("INSERT INTO accounts (id, email, created_at, last_login_at) VALUES (?, 'a@example.com', ?, ?)").run(id, T0, T0);
  const notice = async (options, at) => {
    const { headers, body } = signedDelivery({ account: id, at, ...options }, SECRET);
    return (await handlePlusWebhook(new Request(`${SITE}/api/webhooks/lemonsqueezy`, { method: "POST", headers, body }), env, { now: at })).status;
  };
  assert.equal(await notice({ name: "subscription_created" }, T0), 200);
  assert.deepEqual(row(env, id), { tts_used: 0, tts_limit: 150_000 });
  const code = await makeOverlayLink(env.DB, id);
  const company = voiceCompany();
  env.DB.raw.prepare("UPDATE plus SET tts_used = tts_limit").run();
  const out = await speak(env, { code }, "hello", company);
  assert.equal(out.status, 402, "all used");
  assert.equal(await notice({ name: "subscription_payment_success", billingReason: "renewal" }, T0 + 30 * DAY), 200);
  assert.deepEqual(row(env, id), { tts_used: 0, tts_limit: 150_000 });
  const again = await handleTts(new Request(`${SITE}/api/tts`, { method: "POST", headers: { origin: SITE, "content-type": "application/json", "x-frills-country": "US", "x-overlay": code }, body: JSON.stringify({ text: "hello", voice: "nova" }) }), env, { fetchFn: company.fetchFn, now: T0 + 30 * DAY + 5000 });
  assert.equal(again.status, 200, "a new month, a voice again");
});
