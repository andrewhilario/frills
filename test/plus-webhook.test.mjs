// The Frills Plus payment notices (worker/plus-webhook.mjs) over a real in-memory SQLite database with the real schema, with made-up Lemon Squeezy deliveries signed the way
// they sign them: only a correctly signed notice counts, a payment is linked by the account id (not the email), renewals, cancellations, expiries and refunds do the right thing,
// late and repeated notices are harmless, and nobody can take away another person's Plus by buying a subscription with that person's account id.

import test from "node:test";
import assert from "node:assert/strict";
import { handlePlusWebhook } from "../worker/plus-webhook.mjs";
import { PLUS_GRACE_MS, plusActive } from "../worker/accounts.mjs";
import worker from "../worker/index.mjs";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";
import { fakeDelivery, signBody, signedDelivery } from "../scripts/lib/lemon-fake.mjs";

const SITE = "https://frills.example";
const SECRET = "whsec-for-tests";
const T0 = Date.parse("2026-12-01T12:00:00Z");
const DAY = 86_400_000;
const ALICE = "aaaaaaaaaaaaaaaa";
const BOB = "bbbbbbbbbbbbbbbb";

const fresh = (extra = {}) => {
  const db = localDatabase(":memory:");
  for (const id of [ALICE, BOB]) db.raw.prepare("INSERT INTO accounts (id, email, created_at, last_login_at) VALUES (?, ?, ?, ?)").run(id, `${id}@example.com`, T0, T0);
  return { DB: db, LEMON_WEBHOOK_SECRET: SECRET, LEMON_TEST_MODE: "1", ...extra };
};
const row = (env, account = ALICE) => env.DB.raw.prepare("SELECT * FROM plus WHERE account_id = ?").get(account) ?? null;

async function send(env, options, { secret = SECRET, now = T0, method = "POST", mutate } = {}) {
  const { headers, body } = signedDelivery({ at: now, ...options }, secret);
  const sent = mutate ? mutate(body) : body; // (a changed body keeps the old signature)
  const res = await handlePlusWebhook(new Request(`${SITE}/api/webhooks/lemonsqueezy`, { method, headers, body: method === "GET" ? undefined : sent }), env, { now });
  return { status: res.status, body: await res.json() };
}
const buy = (env, extra = {}, at = T0) => send(env, { name: "subscription_created", account: ALICE, at, ...extra }, { now: at });

test("only a notice signed with our secret counts, and the right way of asking", async () => {
  const env = fresh();
  const options = { name: "subscription_created", account: ALICE };
  assert.equal((await send(env, options, { secret: "someone-elses-secret" })).status, 401, "signed with another secret");
  assert.equal((await send(env, options, { mutate: (b) => b.replace(ALICE, BOB) })).status, 401, "the body was changed after signing");
  const { headers, body } = fakeDelivery({ ...options, at: T0 });
  assert.equal((await handlePlusWebhook(new Request(`${SITE}/x`, { method: "POST", headers, body }), env, { now: T0 })).status, 401, "no signature");
  assert.equal((await handlePlusWebhook(new Request(`${SITE}/x`, { method: "POST", headers: { ...headers, "x-signature": "zz" }, body }), env, { now: T0 })).status, 401, "a damaged signature");
  assert.equal((await send(env, options, { method: "GET" })).status, 405);
  assert.equal(row(env), null, "nothing refused changed anything");
  assert.equal((await send({ ...env, LEMON_WEBHOOK_SECRET: "" }, options)).body.error, "webhook_off", "no secret set: off, never open");
  assert.equal((await handlePlusWebhook(new Request(`${SITE}/x`, { method: "POST", body: "{}" }), { LEMON_WEBHOOK_SECRET: SECRET })).status, 503, "no database");
  const garbage = "{ not json";
  assert.equal((await handlePlusWebhook(new Request(`${SITE}/x`, { method: "POST", headers: { "x-signature": signBody(garbage, SECRET) }, body: garbage }), env)).status, 400, "signed, but not JSON");
  const big = JSON.stringify({ pad: "x".repeat(250000) });
  assert.equal((await handlePlusWebhook(new Request(`${SITE}/x`, { method: "POST", headers: { "x-signature": signBody(big, SECRET) }, body: big }), env)).status, 413);
});

test("a new subscription starts Plus for the account in the checkout address: active, with its renewal date, a full month of credits and the provider's ids", async () => {
  const env = fresh();
  const res = await buy(env, { subscription: "1001", order: "2001", renewsInDays: 30 });
  assert.deepEqual([res.status, res.body.result, res.body.status], [200, "applied", "active"]);
  const r = row(env);
  assert.deepEqual([r.status, r.provider_ref, r.order_ref, r.tts_used, r.tts_limit, r.period_start], ["active", "1001", "2001", 0, 1500, T0]);
  assert.equal(r.renews_at, T0 + 30 * DAY);
  assert.equal(plusActive(r, T0 + DAY), true);
  assert.equal(row(env, BOB), null, "nobody else got it");
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM plus").get().n, 1);
});

test("the monthly credits can be set", async () => {
  assert.equal(row((await (async () => { const e = fresh({ PLUS_MONTHLY_LIMIT: "300" }); await buy(e); return e; })())).tts_limit, 300);
});

test("a payment is linked by the account id, not the email on the payment page", async () => {
  const env = fresh();
  await buy(env, { email: "a.different.person@example.org" });
  assert.equal(row(env).account_id, ALICE);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM plus WHERE account_id = ?").get(BOB).n, 0);
});

test("a payment with no account id, a damaged one, or one that is not an account does nothing", async () => {
  const env = fresh();
  for (const account of [undefined, "", "not-an-id", "cccccccccccccccc", "AAAAAAAAAAAAAAAA"]) {
    const res = await send(env, { name: "subscription_created", account });
    assert.deepEqual([res.status, res.body.reason], [200, "no_account"], String(account));
  }
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM plus").get().n, 0);
});

test("the same notice twice, or an older one arriving late, changes nothing", async () => {
  const env = fresh();
  await buy(env);
  assert.equal((await buy(env)).body.reason, "stale", "the same delivery again");
  await send(env, { name: "subscription_updated", subscription: "1001", status: "paused" }, { now: T0 + 5 * DAY, });
  const before = row(env);
  const late = await send(env, { name: "subscription_updated", subscription: "1001", status: "active", at: T0 + DAY }, { now: T0 + 6 * DAY });
  assert.deepEqual([late.body.result, late.body.reason], ["ignored", "stale"]);
  assert.equal(row(env).status, before.status, "still paused: the later notice wins");
});

test("a renewal payment gives a new month of credits and keeps Plus on", async () => {
  const env = fresh();
  await buy(env);
  env.DB.raw.prepare("UPDATE plus SET tts_used = 1234").run();
  const res = await send(env, { name: "subscription_payment_success", subscription: "1001", billingReason: "renewal" }, { now: T0 + 30 * DAY });
  assert.deepEqual([res.body.result, res.body.renewed], ["applied", true]);
  const r = row(env);
  assert.deepEqual([r.status, r.tts_used, r.period_start], ["active", 0, T0 + 30 * DAY]);
  await send(env, { name: "subscription_updated", subscription: "1001", status: "active", renewsInDays: 30 }, { now: T0 + 30 * DAY + 1000 });
  assert.equal(row(env).renews_at, T0 + 30 * DAY + 1000 + 30 * DAY, "the next renewal date moves on");
  assert.equal(row(env).tts_used, 0, "an update alone does not hand out credits");
});

test("a payment notice works by the subscription even when it carries no account id", async () => {
  const env = fresh();
  await buy(env);
  env.DB.raw.prepare("UPDATE plus SET tts_used = 50").run();
  const res = await send(env, { name: "subscription_payment_success", subscription: "1001", account: undefined }, { now: T0 + DAY });
  assert.equal(res.body.result, "applied");
  assert.equal(row(env).tts_used, 0);
});

test("a cancelled subscription keeps Plus until its end date, and not after", async () => {
  const env = fresh();
  await buy(env);
  const res = await send(env, { name: "subscription_cancelled", subscription: "1001", status: "cancelled", endsInDays: 10 }, { now: T0 + 5 * DAY });
  assert.deepEqual([res.body.result, res.body.status], ["applied", "canceled"]);
  const r = row(env);
  assert.equal(r.status, "canceled");
  assert.equal(r.renews_at, T0 + 5 * DAY + 10 * DAY);
  assert.equal(plusActive(r, T0 + 14 * DAY), true, "paid until the end date");
  assert.equal(plusActive(r, T0 + 15 * DAY), false, "and not at the moment it ends");
  const ended = await send(env, { name: "subscription_expired", subscription: "1001", status: "expired", endsInDays: 0 }, { now: T0 + 15 * DAY });
  assert.equal(row(env).status, "expired");
  assert.equal(plusActive(row(env), T0 + 15 * DAY), false);
  assert.equal(ended.body.result, "applied");
});

test("a pause or an unpaid subscription switches Plus off at once, and resuming switches it on", async () => {
  const env = fresh();
  await buy(env);
  await send(env, { name: "subscription_paused", subscription: "1001", status: "paused" }, { now: T0 + DAY });
  assert.equal(plusActive(row(env), T0 + DAY), false);
  await send(env, { name: "subscription_unpaused", subscription: "1001", status: "active" }, { now: T0 + 2 * DAY });
  assert.equal(plusActive(row(env), T0 + 2 * DAY), true);
  await send(env, { name: "subscription_updated", subscription: "1001", status: "unpaid" }, { now: T0 + 3 * DAY });
  assert.equal(row(env).status, "unpaid");
  assert.equal(plusActive(row(env), T0 + 3 * DAY), false);
  await send(env, { name: "subscription_payment_recovered", subscription: "1001" }, { now: T0 + 4 * DAY });
  assert.equal(plusActive(row(env), T0 + 4 * DAY), true, "a recovered payment brings it back");
});

test("a renewal that failed (past_due) changes nothing: Lemon Squeezy is still trying", async () => {
  const env = fresh();
  await buy(env);
  const failed = await send(env, { name: "subscription_payment_failed", subscription: "1001", invoiceStatus: "pending" }, { now: T0 + 30 * DAY });
  assert.equal(failed.body.reason, "not_used");
  const late = await send(env, { name: "subscription_updated", subscription: "1001", status: "past_due" }, { now: T0 + 30 * DAY + 1000 });
  assert.deepEqual([late.body.result, late.body.reason], ["ignored", "no_change"]);
  assert.equal(row(env).status, "active");
});

test("a full refund switches Plus off for good; a partial refund does not; a late 'active' cannot bring it back", async () => {
  const env = fresh();
  await buy(env, { order: "2001" });
  const partial = await send(env, { name: "order_refunded", order: "2001", orderStatus: "partial_refund" }, { now: T0 + DAY });
  assert.deepEqual([partial.body.result, partial.body.reason], ["ignored", "partial_refund"]);
  assert.equal(plusActive(row(env), T0 + DAY), true);
  const full = await send(env, { name: "order_refunded", order: "2001", orderStatus: "refunded" }, { now: T0 + 2 * DAY });
  assert.deepEqual([full.body.result, full.body.status], ["applied", "refunded"]);
  assert.equal(row(env).renews_at, null);
  assert.equal(plusActive(row(env), T0 + 2 * DAY), false);
  const revive = await send(env, { name: "subscription_updated", subscription: "1001", status: "active" }, { now: T0 + 3 * DAY });
  assert.equal(revive.body.reason, "refunded");
  assert.equal((await send(env, { name: "subscription_payment_success", subscription: "1001" }, { now: T0 + 4 * DAY })).body.reason, "refunded");
  assert.equal(plusActive(row(env), T0 + 4 * DAY), false);
  assert.equal((await send(env, { name: "order_refunded", order: "9999", orderStatus: "refunded" }, { now: T0 + 5 * DAY })).body.reason, "unknown_order");
});

test("a refunded subscription payment also switches Plus off, by the subscription", async () => {
  const env = fresh();
  await buy(env);
  await send(env, { name: "subscription_payment_refunded", subscription: "1001", invoiceStatus: "refunded", account: undefined }, { now: T0 + DAY });
  assert.equal(row(env).status, "refunded");
});

test("after Plus has ended, buying again starts a new subscription with fresh credits", async () => {
  const env = fresh();
  await buy(env, { subscription: "1001", order: "2001" });
  await send(env, { name: "subscription_expired", subscription: "1001", status: "expired", endsInDays: 0 }, { now: T0 + 31 * DAY });
  env.DB.raw.prepare("UPDATE plus SET tts_used = 700").run();
  const again = await send(env, { name: "subscription_created", account: ALICE, subscription: "1002", order: "2002" }, { now: T0 + 40 * DAY });
  assert.equal(again.body.result, "applied");
  const r = row(env);
  assert.deepEqual([r.status, r.provider_ref, r.order_ref, r.tts_used], ["active", "1002", "2002", 0]);
  const afterRefund = fresh();
  await buy(afterRefund, { order: "2001" });
  await send(afterRefund, { name: "order_refunded", order: "2001", orderStatus: "refunded" }, { now: T0 + DAY });
  assert.equal((await send(afterRefund, { name: "subscription_created", account: ALICE, subscription: "1002", order: "2002" }, { now: T0 + 2 * DAY })).body.result, "applied", "a refunded person may buy again");
});

test("someone cannot take away another person's Plus by buying a subscription with that person's account id and then cancelling it", async () => {
  const env = fresh();
  await buy(env, { subscription: "1001", order: "2001" });
  const attack = await send(env, { name: "subscription_created", account: ALICE, subscription: "6666", order: "7777" }, { now: T0 + DAY });
  assert.deepEqual([attack.body.result, attack.body.reason], ["ignored", "already_plus"], "a second subscription never replaces a working one");
  for (const name of ["subscription_cancelled", "subscription_expired", "subscription_paused"]) {
    const res = await send(env, { name, subscription: "6666", account: ALICE, status: "expired", endsInDays: 0 }, { now: T0 + 2 * DAY });
    assert.equal(res.body.reason, "unknown_subscription", name);
  }
  assert.equal((await send(env, { name: "order_refunded", order: "7777", orderStatus: "refunded" }, { now: T0 + 3 * DAY })).body.reason, "unknown_order", "nor can their refund");
  const r = row(env);
  assert.deepEqual([r.status, r.provider_ref, r.order_ref], ["active", "1001", "2001"]);
  assert.equal(plusActive(r, T0 + 3 * DAY), true);
});

test("notices we do not use are answered 200 and ignored, so Lemon Squeezy does not keep retrying", async () => {
  const env = fresh();
  for (const name of ["order_created", "customer_updated", "license_key_created", "license_key_updated", "affiliate_activated", "something_new"]) {
    const res = await send(env, { name, account: ALICE });
    assert.deepEqual([res.status, res.body.result, res.body.reason], [200, "ignored", "not_used"], name);
  }
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM plus").get().n, 0);
});

test("test-mode purchases count only on a test setup, and another store's or product's notices never count", async () => {
  const live = fresh({ LEMON_TEST_MODE: "" });
  assert.equal((await buy(live, { testMode: true })).body.reason, "test_mode");
  assert.equal(row(live), null);
  assert.equal((await buy(live, { testMode: false })).body.result, "applied", "a real purchase counts");
  const dev = fresh({ LEMON_TEST_MODE: "", DEV: true });
  assert.equal((await buy(dev, { testMode: true })).body.result, "applied", "a local development server takes test purchases");
  const store = fresh({ LEMON_STORE_ID: "42", LEMON_PRODUCT_ID: "7" });
  assert.equal((await buy(store, { storeId: 41 })).body.reason, "wrong_store");
  assert.equal((await buy(store, { storeId: 42, productId: 8 })).body.reason, "wrong_product");
  assert.equal(row(store), null);
  assert.equal((await buy(store, { storeId: 42, productId: 7 })).body.result, "applied");
});

test("if our database fails the answer is 500, so Lemon Squeezy tries again later", async () => {
  const env = fresh();
  const broken = { ...env, DB: { prepare() { throw new Error("database down"); } } };
  const res = await send(broken, { name: "subscription_created", account: ALICE });
  assert.deepEqual([res.status, res.body.error], [500, "server"]);
});

test("an active Plus whose renewal notices stopped arriving ends three days after its renewal date; a cancelled one ends exactly at its end date", () => {
  const renews = T0 + 30 * DAY;
  const active = { status: "active", renews_at: renews };
  assert.equal(plusActive(active, renews), true);
  assert.equal(plusActive(active, renews + PLUS_GRACE_MS), true, "three days of grace");
  assert.equal(plusActive(active, renews + PLUS_GRACE_MS + 1), false);
  assert.equal(plusActive({ status: "active", renews_at: null }, T0 + 400 * DAY), true, "no date known: trust the status");
  assert.equal(plusActive({ status: "canceled", renews_at: null }, T0), false);
  for (const status of ["paused", "unpaid", "expired", "refunded", "nonsense"]) assert.equal(plusActive({ status, renews_at: renews }, T0), false, status);
  assert.equal(plusActive(null), false);
});

test("the real Worker routes the webhook address", async () => {
  const env = { ...fresh(), ASSETS: { fetch: async () => new Response("asset") } };
  const { headers, body } = signedDelivery({ name: "subscription_created", account: ALICE, at: T0 }, SECRET);
  const res = await worker.fetch(new Request(`${SITE}/api/webhooks/lemonsqueezy`, { method: "POST", headers, body }), env, { waitUntil() {} });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).result, "applied");
  assert.equal(row(env).status, "active");
});
