// Polar.sh Merchant of Record integration (zero external SDK, native Web Crypto & fetch for Cloudflare Workers):
//   - createPolarCheckout()  -> POST /v1/checkouts/ (hosted checkout bound to our account id via external_customer_id + metadata)
//   - createPolarPortal()    -> POST /v1/customer-sessions/ (pre-authenticated Customer Portal link for Manage or cancel)
//   - verifyPolarWebhook()   -> Standard Webhooks HMAC-SHA256 verification (supports both whsec_ base64 and literal UTF-8 keys)
//   - handlePolarWebhook()   -> POST /api/webhooks/polar (subscription & order lifecycle -> D1 `plus` table)

import { plusActive } from "./accounts.mjs";

const PROD_API = "https://api.polar.sh/v1";
const SANDBOX_API = "https://sandbox-api.polar.sh/v1";
const MAX_BODY = 262_144;
const DEFAULT_LIMIT = 150_000;
const REPLAY_TOLERANCE_SEC = 300;
const ACCOUNT_ID = /^[0-9a-f]{16}$/;
const enc = new TextEncoder();

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });

const time = (iso) => { const t = Date.parse(String(iso ?? "")); return Number.isFinite(t) ? t : null; };
const limitOf = (env) => Math.max(1, Math.min(10_000_000, Math.round(Number(env?.PLUS_MONTHLY_CHARS) || DEFAULT_LIMIT)));
const applied = (extra = {}) => ({ result: "applied", ...extra });
const ignored = (reason) => ({ result: "ignored", reason });

const cleanSecret = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "").trim();
const cleanToken = (v) => cleanSecret(v).replace(/^Bearer\s+/i, "").trim();

/** Returns true only when POLAR_SANDBOX is explicitly "1" or "true"; "0", "false", or unset runs Production. */
export const polarIsSandbox = (env) => ["1", "true"].includes(cleanSecret(env?.POLAR_SANDBOX).toLowerCase());

/**
 * Resolves active Polar credentials & endpoint based on POLAR_SANDBOX:
 *   - POLAR_SANDBOX=1 -> sandbox-api.polar.sh + POLAR_SANDBOX_* secrets (falling back to POLAR_* if dedicated sandbox secrets are not set)
 *   - POLAR_SANDBOX=0 (or unset) -> api.polar.sh + live POLAR_* secrets
 */
export function polarConfig(env) {
  const sandbox = polarIsSandbox(env);
  if (sandbox) {
    return {
      sandbox: true,
      apiBase: SANDBOX_API,
      token: cleanToken(env?.POLAR_SANDBOX_ACCESS_TOKEN) || cleanToken(env?.POLAR_ACCESS_TOKEN),
      productId: cleanSecret(env?.POLAR_SANDBOX_PRODUCT_ID) || cleanSecret(env?.POLAR_PRODUCT_ID),
      webhookSecret: cleanSecret(env?.POLAR_SANDBOX_WEBHOOK_SECRET) || cleanSecret(env?.POLAR_WEBHOOK_SECRET),
    };
  }
  return {
    sandbox: false,
    apiBase: PROD_API,
    token: cleanToken(env?.POLAR_ACCESS_TOKEN),
    productId: cleanSecret(env?.POLAR_PRODUCT_ID),
    webhookSecret: cleanSecret(env?.POLAR_WEBHOOK_SECRET),
  };
}

export const polarApiBase = (env) => polarConfig(env).apiBase;

/** Accepts only https URLs on polar.sh / *.polar.sh (or plain http localhost in local dev). */
export function acceptablePolarUrl(raw, dev = false) {
  let url;
  try { url = new URL(String(raw ?? "").trim()); } catch { return null; }
  if (url.username || url.password) return null;
  const polar = url.protocol === "https:" && (url.hostname === "polar.sh" || url.hostname.endsWith(".polar.sh"));
  const local = dev && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  return polar || local ? url.toString() : null;
}

export const polarCheckoutReady = (env) => {
  const cfg = polarConfig(env);
  return Boolean(cfg.token && cfg.productId);
};
export const polarPortalReady = (env) => Boolean(polarConfig(env).token);

/** Creates a hosted Polar Checkout session pre-filled with the account's email and bound by external_customer_id + metadata. */
export async function createPolarCheckout(env, { email, accountId, successUrl, returnUrl }, fetchFn = globalThis.fetch) {
  const { token, productId, apiBase } = polarConfig(env);
  if (!token || !productId) return { ok: false, error: "checkout_off" };
  const dev = Boolean(env?.DEV);
  const endpoint = `${apiBase}/checkouts/`;
  try {
    const init = {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": "frills-worker",
      },
      body: JSON.stringify({
        products: [productId],
        customer_email: email,
        external_customer_id: accountId,
        metadata: { account_id: accountId },
        ...(successUrl ? { success_url: successUrl } : {}),
        ...(returnUrl ? { return_url: returnUrl } : {}),
      }),
    };
    if (typeof AbortSignal?.timeout === "function") init.signal = AbortSignal.timeout(8000);
    const res = await fetchFn(endpoint, init);
    if (!res?.ok) {
      const detail = await res?.text?.().catch(() => "") ?? "";
      console.error("polar_checkout_failed", { endpoint, status: res?.status ?? 0, detail: detail.slice(0, 300) });
      return { ok: false, error: "provider_error", providerStatus: Number(res?.status ?? 0) };
    }
    const body = await res.json().catch(() => null);
    const url = acceptablePolarUrl(body?.url, dev);
    if (!url) {
      console.error("polar_checkout_bad_url", { endpoint, host: (() => { try { return new URL(String(body?.url ?? "")).hostname; } catch { return ""; } })() });
      return { ok: false, error: "provider_error", providerStatus: 502 };
    }
    return { ok: true, url };
  } catch (err) {
    console.error("polar_checkout_throw", { endpoint, message: String(err?.message ?? err).slice(0, 200) });
    return { ok: false, error: "provider_error", providerStatus: 0 };
  }
}

/** Creates a fresh pre-authenticated Polar Customer Portal session URL for the account's external_customer_id. */
export async function createPolarPortal(env, { accountId, returnUrl }, fetchFn = globalThis.fetch) {
  const { token, apiBase } = polarConfig(env);
  if (!token) return { ok: false, error: "portal_off" };
  const dev = Boolean(env?.DEV);
  const endpoint = `${apiBase}/customer-sessions/`;
  try {
    const init = {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": "frills-worker",
      },
      body: JSON.stringify({
        external_customer_id: accountId,
        ...(returnUrl ? { return_url: returnUrl } : {}),
      }),
    };
    if (typeof AbortSignal?.timeout === "function") init.signal = AbortSignal.timeout(8000);
    const res = await fetchFn(endpoint, init);
    if (!res?.ok) {
      const detail = await res?.text?.().catch(() => "") ?? "";
      console.error("polar_portal_failed", { endpoint, status: res?.status ?? 0, detail: detail.slice(0, 300) });
      return { ok: false, error: "provider_error", providerStatus: Number(res?.status ?? 0) };
    }
    const body = await res.json().catch(() => null);
    const url = acceptablePolarUrl(body?.customer_portal_url, dev);
    if (!url) {
      console.error("polar_portal_bad_url", { endpoint });
      return { ok: false, error: "provider_error", providerStatus: 502 };
    }
    return { ok: true, url };
  } catch (err) {
    console.error("polar_portal_throw", { endpoint, message: String(err?.message ?? err).slice(0, 200) });
    return { ok: false, error: "provider_error", providerStatus: 0 };
  }
}

// ── Standard Webhooks HMAC-SHA256 verification ──────────────────────────────────────────────────────────

function decodeBase64(b64) {
  try {
    const clean = String(b64).trim();
    if (!clean || !/^[A-Za-z0-9+/]+=*$/.test(clean)) return null;
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function timingSafeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Polar supports both Standard Webhooks base64-encoded secrets (`whsec_...`, Sept 2026+) and legacy UTF-8 literal `polar_whs_...` secrets.
 * Testing both key derivations matches Polar's official SDK behavior with zero external dependencies.
 */
function secretCandidates(rawSecret) {
  const secret = String(rawSecret ?? "").trim();
  if (!secret) return [];
  const out = [];
  const stripped = secret.startsWith("whsec_") ? secret.slice(6) : secret.startsWith("polar_whs_") ? secret.slice(10) : secret;
  const decoded = decodeBase64(stripped);
  if (decoded && decoded.length >= 8) out.push(decoded);
  out.push(enc.encode(secret));
  return out;
}

/** Verifies Standard Webhooks headers (`webhook-id`, `webhook-timestamp`, `webhook-signature`) against the raw body. */
export async function verifyPolarWebhook({ raw, id, timestamp, signature, secret, now = Date.now(), toleranceSec = REPLAY_TOLERANCE_SEC }) {
  const cleanId = String(id ?? "").trim();
  const cleanTs = String(timestamp ?? "").trim();
  const cleanSig = String(signature ?? "").trim();
  if (typeof raw !== "string" || !cleanId || !/^\d{9,12}$/.test(cleanTs) || !cleanSig) return false;

  const ts = Number(cleanTs);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(now / 1000) - ts) > toleranceSec) return false;

  const givenSigs = cleanSig
    .split(/\s+/)
    .map((part) => (part.startsWith("v1,") ? decodeBase64(part.slice(3)) : null))
    .filter(Boolean);
  if (!givenSigs.length) return false;

  const signedContent = enc.encode(`${cleanId}.${cleanTs}.${raw}`);
  for (const keyBytes of secretCandidates(secret)) {
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, signedContent));
    if (givenSigs.some((sig) => timingSafeEqual(expected, sig))) return true;
  }
  return false;
}

// ── Webhook Event Handling ──────────────────────────────────────────────────────────────────────────────

const POLAR_STATUS = {
  active: "active",
  trialing: "active",
  canceled: "canceled",
  incomplete: "unpaid",
  incomplete_expired: "expired",
  unpaid: "unpaid",
  revoked: "expired",
};

function accountIdFrom(data) {
  for (const raw of [data?.customer?.external_id, data?.external_customer_id, data?.external_id, data?.metadata?.account_id, data?.customer?.metadata?.account_id]) {
    const text = String(raw ?? "").trim();
    if (ACCOUNT_ID.test(text)) return text;
  }
  return "";
}

const bySub = (db, subId) => (subId ? db.prepare("SELECT * FROM plus WHERE provider_ref = ?").bind(String(subId)).first() : null);
const byOrder = (db, orderId) => (orderId ? db.prepare("SELECT * FROM plus WHERE order_ref = ?").bind(String(orderId)).first() : null);
const byAccount = (db, accountId) => (accountId ? db.prepare("SELECT * FROM plus WHERE account_id = ?").bind(String(accountId)).first() : null);

async function applyPolarEvent(db, env, eventType, data, at, now) {
  if (["subscription.created", "subscription.active", "subscription.updated", "subscription.canceled", "subscription.uncanceled", "subscription.revoked"].includes(eventType)) {
    const subId = String(data?.id ?? "").trim();
    if (!subId) return ignored("no_subscription");

    let row = await bySub(db, subId);
    const extAccountId = accountIdFrom(data);
    if (!row && extAccountId) row = await byAccount(db, extAccountId);

    // Derive normalized Frills Plus status
    let status;
    if (eventType === "subscription.revoked") status = "expired";
    else if (eventType === "subscription.canceled") status = "canceled";
    else if (data?.cancel_at_period_end === true && (data?.status === "active" || data?.status === "trialing" || !data?.status)) status = "canceled";
    else status = POLAR_STATUS[String(data?.status ?? "")] ?? (eventType === "subscription.created" || eventType === "subscription.active" || eventType === "subscription.uncanceled" ? "active" : null);

    // `past_due` (retry in progress) leaves current status intact rather than cutting access immediately
    if (!status) return ignored("status_unchanged");

    const periodStart = time(data?.current_period_start) ?? row?.period_start ?? now;
    const until = eventType === "subscription.revoked"
      ? now
      : time(data?.current_period_end) ?? time(data?.ends_at) ?? row?.renews_at ?? null;

    if (!row) {
      if (!extAccountId) return ignored("no_account");
      if (!(await db.prepare("SELECT id FROM accounts WHERE id = ?").bind(extAccountId).first())) return ignored("no_account");
      await db.prepare(
        "INSERT INTO plus (account_id, provider_ref, order_ref, status, renews_at, tts_used, tts_limit, period_start, updated_at) VALUES (?, ?, '', ?, ?, 0, ?, ?, ?) " +
        "ON CONFLICT(account_id) DO UPDATE SET provider_ref = excluded.provider_ref, status = excluded.status, renews_at = excluded.renews_at, tts_used = 0, tts_limit = excluded.tts_limit, period_start = excluded.period_start, updated_at = excluded.updated_at",
      ).bind(extAccountId, subId, status, until, limitOf(env), periodStart, at).run();
      return applied({ accountId: extAccountId, status });
    }

    if (row.provider_ref === subId && row.updated_at > at) return ignored("stale");
    if (plusActive(row, now) && row.provider_ref && row.provider_ref !== subId) return ignored("already_plus");

    // Reset monthly AI voice character allowance when Polar advances current_period_start into a new billing cycle
    const renewed = periodStart > (row.period_start || 0) && status === "active";
    const nextUsed = renewed ? 0 : row.tts_used;
    const nextLimit = renewed ? limitOf(env) : row.tts_limit;

    await db.prepare(
      "UPDATE plus SET provider_ref = ?, status = ?, renews_at = ?, tts_used = ?, tts_limit = ?, period_start = ?, updated_at = ? WHERE account_id = ?",
    ).bind(subId, status, until, nextUsed, nextLimit, renewed ? periodStart : row.period_start, Math.max(at, row.updated_at), row.account_id).run();
    return applied({ accountId: row.account_id, status, ...(renewed ? { renewed: true } : {}) });
  }

  if (eventType === "order.paid") {
    const orderId = String(data?.id ?? "").trim();
    const subId = String(data?.subscription_id ?? "").trim();
    const extAccountId = accountIdFrom(data);
    const row = (await bySub(db, subId)) ?? (extAccountId ? await byAccount(db, extAccountId) : null);
    if (!row) return ignored("unknown_subscription");
    const isRenewal = data?.billing_reason === "subscription_cycle";
    const nextUsed = isRenewal ? 0 : row.tts_used;
    const nextPeriod = isRenewal ? at : row.period_start;
    await db.prepare(
      "UPDATE plus SET order_ref = ?, tts_used = ?, period_start = ?, updated_at = ? WHERE account_id = ?",
    ).bind(orderId || row.order_ref, nextUsed, nextPeriod, Math.max(at, row.updated_at), row.account_id).run();
    return applied({ accountId: row.account_id, orderId, ...(isRenewal ? { renewed: true } : {}) });
  }

  if (eventType === "order.refunded") {
    const orderId = String(data?.id ?? "").trim();
    const subId = String(data?.subscription_id ?? "").trim();
    const extAccountId = accountIdFrom(data);
    const orderAmount = Number(data?.net_amount ?? data?.total_amount ?? data?.amount ?? 0);
    const full = data?.status === "refunded" || (orderAmount > 0 && Number(data?.refunded_amount) >= orderAmount);
    if (!full) return ignored("partial_refund");
    const row = (await byOrder(db, orderId)) ?? (await bySub(db, subId)) ?? (extAccountId ? await byAccount(db, extAccountId) : null);
    if (!row) return ignored("unknown_order");
    await db.prepare("UPDATE plus SET status = 'refunded', renews_at = ?, updated_at = ? WHERE account_id = ?").bind(now, Math.max(at, row.updated_at), row.account_id).run();
    return applied({ accountId: row.account_id, status: "refunded" });
  }

  return ignored("unhandled_event");
}

/** POST /api/webhooks/polar */
export async function handlePolarWebhook(request, env, { now = Date.now() } = {}) {
  if (request.method !== "POST") return json(405, { ok: false, error: "method" });
  const cfg = polarConfig(env);
  if (!cfg.webhookSecret) return json(503, { ok: false, error: "webhook_off" });
  if (!env?.DB) return json(503, { ok: false, error: "not_ready" });

  const raw = await request.text();
  if (raw.length > MAX_BODY) return json(413, { ok: false, error: "too_big" });

  const valid = await verifyPolarWebhook({
    raw,
    id: request.headers.get("webhook-id"),
    timestamp: request.headers.get("webhook-timestamp"),
    signature: request.headers.get("webhook-signature"),
    secret: cfg.webhookSecret,
    now,
  });
  if (!valid) return json(401, { ok: false, error: "invalid_signature" });

  let body;
  try { body = JSON.parse(raw); } catch { return json(400, { ok: false, error: "bad_data" }); }
  const eventType = String(body?.type ?? "").trim();
  const data = body?.data;
  if (!eventType || !data || typeof data !== "object") return json(400, { ok: false, error: "bad_data" });

  if (cfg.productId && data.product_id && String(data.product_id) !== cfg.productId) {
    return json(200, { ok: true, event: eventType, ...ignored("wrong_product") });
  }

  const at = time(body.timestamp) ?? time(data.modified_at) ?? time(data.created_at) ?? now;
  try {
    return json(200, { ok: true, event: eventType, ...(await applyPolarEvent(env.DB, env, eventType, data, at, now)) });
  } catch {
    return json(500, { ok: false, error: "server" });
  }
}
