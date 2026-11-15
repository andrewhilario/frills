// What Lemon Squeezy tells us when someone pays, renews, cancels, or is refunded, turned into what an account has bought (the `plus` table). Lemon Squeezy calls
// POST /api/webhooks/lemonsqueezy with a signed JSON body; anything that is not signed with our secret is refused. The event names, statuses and fields are from Lemon
// Squeezy's documentation (event types, subscription object, signing requests); see PLAN-FRILLS-PLUS.md for what was and was not checked against a real delivery.
//
// The rules, because money is involved:
//  - A payment is linked to an account by the account id we put in the checkout address (meta.custom_data.account_id), never by the email on the payment page (it can be edited).
//  - Only a new subscription may start Plus, and only for an account that does not already have it. After that, only notices about THAT subscription change it, so
//    someone cannot take away another person's Plus by paying for a subscription of their own with the other person's account id and then cancelling it.
//  - A notice older than the one already applied is ignored (they can arrive late or twice), except a refund, which always wins.
//  - A cancelled subscription keeps Plus until its end date. A refund, a pause, an unpaid or an ended subscription does not.
//  - Anything we do not use is answered "ignored" with 200, so Lemon Squeezy does not keep retrying it. A failure on our side answers 500, so it does retry.

import { plusActive } from "./accounts.mjs";

const hexToBytes = (hex) => {
  const clean = String(hex ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(clean) || clean.length % 2 !== 0) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/** Verifies Lemon Squeezy's `X-Signature` HMAC-SHA256 hex digest over the raw request body bytes. */
export async function verifyLemonSignature(rawBody, signatureHex, secret) {
  const cleanSecret = String(secret ?? "");
  const received = hexToBytes(signatureHex);
  if (!cleanSecret || !received) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(cleanSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  if (mac.length !== received.length) return false;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac[i] ^ received[i];
  return diff === 0;
}

const ACCOUNT_ID = /^[0-9a-f]{16}$/;
const MAX_BODY = 200_000;
const DEFAULT_LIMIT = 150_000; // characters of AI voice a month: a short chat line is about 50, so over 2,000 lines, and at most about $3.30 of voice cost at the dearest provider (see PLAN-FRILLS-PLUS.md)

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
const time = (iso) => { const t = Date.parse(String(iso ?? "")); return Number.isFinite(t) ? t : null; };
const applied = (extra = {}) => ({ result: "applied", ...extra });
const ignored = (reason) => ({ result: "ignored", reason });

/** Lemon Squeezy's subscription status -> ours. "past_due" (a renewal failed, they are retrying) is left out on purpose: it changes nothing. */
const STATUS = { active: "active", on_trial: "active", cancelled: "canceled", paused: "paused", unpaid: "unpaid", expired: "expired" };
const BY_EVENT = { subscription_cancelled: "canceled", subscription_expired: "expired", subscription_paused: "paused", subscription_resumed: "active", subscription_unpaused: "active" };

const limitOf = (env) => Math.max(1, Math.min(10_000_000, Math.round(Number(env?.PLUS_MONTHLY_CHARS) || DEFAULT_LIMIT)));
const byRef = (db, ref) => (ref ? db.prepare("SELECT * FROM plus WHERE provider_ref = ?").bind(ref).first() : null);

async function apply(db, env, ev, at, now) {
  const { name, id, type, attrs, custom } = ev;
  const subscription = type === "subscriptions" ? id : String(attrs.subscription_id ?? "");

  if (name === "subscription_created") {
    const accountId = String(custom?.account_id ?? "");
    if (!ACCOUNT_ID.test(accountId)) return ignored("no_account");
    if (!(await db.prepare("SELECT id FROM accounts WHERE id = ?").bind(accountId).first())) return ignored("no_account");
    const row = await db.prepare("SELECT * FROM plus WHERE account_id = ?").bind(accountId).first();
    if (row && row.provider_ref === id && row.updated_at >= at) return ignored("stale"); // the same notice again
    if (row && plusActive(row, now) && row.provider_ref !== id) return ignored("already_plus"); // a second subscription never replaces a working one
    const status = STATUS[attrs.status] ?? "active";
    const until = time(status === "canceled" ? attrs.ends_at : attrs.renews_at);
    await db.prepare(
      "INSERT INTO plus (account_id, provider_ref, order_ref, status, renews_at, tts_used, tts_limit, period_start, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?) " +
      "ON CONFLICT(account_id) DO UPDATE SET provider_ref = excluded.provider_ref, order_ref = excluded.order_ref, status = excluded.status, renews_at = excluded.renews_at, tts_used = 0, tts_limit = excluded.tts_limit, period_start = excluded.period_start, updated_at = excluded.updated_at",
    ).bind(accountId, id, String(attrs.order_id ?? ""), status, until, limitOf(env), now, at).run();
    return applied({ status });
  }

  if (name === "order_refunded") {
    if (attrs.status !== "refunded") return ignored("partial_refund"); // only a full refund takes Plus away
    const row = id ? await db.prepare("SELECT * FROM plus WHERE order_ref = ?").bind(id).first() : null;
    if (!row) return ignored("unknown_order");
    await db.prepare("UPDATE plus SET status = 'refunded', renews_at = NULL, updated_at = MAX(updated_at, ?) WHERE account_id = ?").bind(at, row.account_id).run();
    return applied({ status: "refunded" });
  }

  if (name === "subscription_payment_refunded") {
    if (attrs.status !== "refunded") return ignored("partial_refund");
    const row = await byRef(db, subscription);
    if (!row) return ignored("unknown_subscription");
    await db.prepare("UPDATE plus SET status = 'refunded', renews_at = NULL, updated_at = MAX(updated_at, ?) WHERE account_id = ?").bind(at, row.account_id).run();
    return applied({ status: "refunded" });
  }

  const isUpdate = name === "subscription_updated" || name in BY_EVENT;
  const isPaid = name === "subscription_payment_success" || name === "subscription_payment_recovered";
  if (!isUpdate && !isPaid) return ignored("not_used");

  const row = await byRef(db, subscription);
  if (!row) return ignored("unknown_subscription");
  if (row.status === "refunded") return ignored("refunded"); // a refund is final; a new purchase starts a new subscription
  if (at < row.updated_at) return ignored("stale");

  if (isPaid) {
    await db.prepare("UPDATE plus SET status = 'active', tts_used = 0, tts_limit = ?, period_start = ?, updated_at = ? WHERE account_id = ?").bind(limitOf(env), now, at, row.account_id).run();
    return applied({ status: "active", renewed: true });
  }

  const status = BY_EVENT[name] ?? STATUS[attrs.status];
  if (!status) return ignored("no_change"); // past_due, or a status we do not know
  const ending = status === "canceled" || status === "expired";
  const until = ending ? time(attrs.ends_at) ?? row.renews_at : time(attrs.renews_at) ?? row.renews_at;
  await db.prepare("UPDATE plus SET status = ?, renews_at = ?, updated_at = ? WHERE account_id = ?").bind(status, until, at, row.account_id).run();
  return applied({ status });
}

export async function handlePlusWebhook(request, env, { now = Date.now() } = {}) {
  if (request.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });
  if (!env?.LEMON_WEBHOOK_SECRET) return json(503, { ok: false, error: "webhook_off" });
  if (!env?.DB) return json(503, { ok: false, error: "not_ready" });

  const raw = await request.text();
  if (raw.length > MAX_BODY) return json(413, { ok: false, error: "too_big" });
  if (!(await verifyLemonSignature(raw, request.headers.get("x-signature") ?? "", env.LEMON_WEBHOOK_SECRET))) return json(401, { ok: false, error: "bad_signature" });

  let body;
  try { body = JSON.parse(raw); } catch { return json(400, { ok: false, error: "bad_data" }); }
  const data = body?.data;
  if (!data || typeof data !== "object") return json(400, { ok: false, error: "bad_data" });
  const name = String(request.headers.get("x-event-name") || body?.meta?.event_name || "");
  const attrs = data.attributes && typeof data.attributes === "object" ? data.attributes : {};
  const event = { name, id: String(data.id ?? ""), type: String(data.type ?? ""), attrs, custom: body?.meta?.custom_data && typeof body.meta.custom_data === "object" ? body.meta.custom_data : {} };

  // Test-mode purchases are only for a test setup: the live site ignores them unless it is told to take them.
  const test = attrs.test_mode === true || body?.meta?.test_mode === true;
  if (test && !env.DEV && env.LEMON_TEST_MODE !== "1") return json(200, { ok: true, event: name, ...ignored("test_mode") });
  if (env.LEMON_STORE_ID && attrs.store_id !== undefined && String(attrs.store_id) !== String(env.LEMON_STORE_ID)) return json(200, { ok: true, event: name, ...ignored("wrong_store") });
  if (env.LEMON_PRODUCT_ID && attrs.product_id !== undefined && String(attrs.product_id) !== String(env.LEMON_PRODUCT_ID)) return json(200, { ok: true, event: name, ...ignored("wrong_product") });

  const at = time(attrs.updated_at) ?? time(attrs.created_at) ?? now;
  try {
    return json(200, { ok: true, event: name, ...(await apply(env.DB, env, event, at, now)) });
  } catch {
    return json(500, { ok: false, error: "server" }); // Lemon Squeezy tries again later
  }
}
