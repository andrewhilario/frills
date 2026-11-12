// Lemon Squeezy billing integration: license key activation (works locally & live without tunnels)
// and HMAC-SHA256 webhook processing for renewals, expirations, and refunds.

import { checkProRegion, json, sha256 } from "./region.mjs";

const sameOrigin = (request) => {
  const origin = request.headers.get("origin");
  return Boolean(origin) && origin === new URL(request.url).origin;
};

const lsPassCode = async (licenseId) => "ls" + (await sha256(`ls:${licenseId}`)).slice(0, 14);

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

/**
 * POST /api/pro/activate — validates a Lemon Squeezy license key directly with Lemon Squeezy's License API,
 * enforces Frills Tier-1 region rules, and records/activates its Pro Pass row in D1 without resetting used credits.
 */
export async function handleActivateLicense(request, env, { fetchFn = globalThis.fetch, now = Date.now() } = {}) {
  if (request.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" }, { allow: "POST" });
  if (!sameOrigin(request)) return json(403, { ok: false, error: "wrong_origin" });
  if (!env?.DB) return json(503, { ok: false, error: "not_ready" });

  const reg = checkProRegion(request, env);
  if (!reg.eligible) return json(403, { ok: false, error: "region_unavailable", country: reg.country });

  const body = await request.json().catch(() => null);
  const licenseKey = String(body?.licenseKey ?? body?.key ?? "").trim().slice(0, 160);
  if (!licenseKey || licenseKey.length < 8) return json(400, { ok: false, error: "bad_data" });

  let res;
  try {
    res = await fetchFn("https://api.lemonsqueezy.com/v1/licenses/validate", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ license_key: licenseKey }).toString(),
    });
  } catch {
    return json(502, { ok: false, error: "provider_error" });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok && res.status >= 500) return json(502, { ok: false, error: "provider_error" });
  if (!data?.valid || data?.license_key?.status !== "active" || !data?.license_key?.id) {
    return json(402, { ok: false, error: "invalid_license", detail: data?.error || data?.license_key?.status || "inactive" });
  }

  const testMode = Boolean(data?.meta?.test_mode);
  if (testMode && !env?.DEV && env?.LEMON_TEST_MODE !== "1") {
    return json(403, { ok: false, error: "test_mode_disabled" });
  }

  if (env?.LEMON_STORE_ID && String(data?.meta?.store_id ?? "") !== String(env.LEMON_STORE_ID)) {
    return json(403, { ok: false, error: "wrong_product" });
  }
  if (env?.LEMON_PRODUCT_ID && String(data?.meta?.product_id ?? "") !== String(env.LEMON_PRODUCT_ID)) {
    return json(403, { ok: false, error: "wrong_product" });
  }

  const code = await lsPassCode(data.license_key.id);
  const passHash = await sha256(licenseKey);
  const limit = Math.max(1, Math.min(100000, Math.round(Number(env?.PRO_MONTHLY_LIMIT) || 1500)));
  const country = reg.country === "DEV" ? "US" : reg.country;

  await env.DB
    .prepare("INSERT INTO pro_passes (code, pass_hash, status, country, allow_roam, tts_used, tts_limit, period_start, created_at) VALUES (?, ?, 'active', ?, 0, 0, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET pass_hash = excluded.pass_hash, status = 'active'")
    .bind(code, passHash, country, limit, now, now)
    .run();

  if (data.meta?.order_id) {
    await env.DB
      .prepare("INSERT INTO pro_links (ref_id, pass_code, updated_at) VALUES (?, ?, ?) ON CONFLICT(ref_id) DO UPDATE SET pass_code = excluded.pass_code, updated_at = excluded.updated_at")
      .bind(`ls:order:${data.meta.order_id}`, code, now)
      .run();
  }

  const saved = await env.DB.prepare("SELECT code, status, country, allow_roam, tts_used, tts_limit, period_start FROM pro_passes WHERE code = ?").bind(code).first();
  return json(200, {
    ok: true,
    token: licenseKey,
    testMode,
    pass: {
      code: saved.code,
      status: saved.status,
      country: saved.country,
      used: saved.tts_used,
      limit: saved.tts_limit,
      remaining: Math.max(0, saved.tts_limit - saved.tts_used),
    },
  });
}

/**
 * POST /api/webhooks/lemonsqueezy — verifies Lemon Squeezy HMAC signatures and updates Pro Pass
 * activation, monthly quota renewal, expiration, and refund revocation in D1.
 */
export async function handleLemonWebhook(request, env, { now = Date.now() } = {}) {
  if (request.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" }, { allow: "POST" });
  if (!env?.LEMON_WEBHOOK_SECRET) return json(503, { ok: false, error: "webhook_off" });
  if (!env?.DB) return json(503, { ok: false, error: "not_ready" });

  const rawBody = await request.text();
  const sig = request.headers.get("x-signature") ?? "";
  if (!(await verifyLemonSignature(rawBody, sig, env.LEMON_WEBHOOK_SECRET))) {
    return json(401, { ok: false, error: "bad_signature" });
  }

  let event;
  try { event = JSON.parse(rawBody); } catch { return json(400, { ok: false, error: "bad_data" }); }

  const eventName = String(request.headers.get("x-event-name") || event?.meta?.event_name || "");
  if (event?.meta?.test_mode && !env?.DEV && env?.LEMON_TEST_MODE !== "1") {
    return json(200, { ok: true, ignored: "test_mode" });
  }
  const storeId = event?.data?.attributes?.store_id;
  if (env?.LEMON_STORE_ID && storeId !== undefined && String(storeId) !== String(env.LEMON_STORE_ID)) {
    return json(200, { ok: true, ignored: "wrong_store" });
  }

  const attrs = event?.data?.attributes ?? {};
  const dataId = event?.data?.id;

  if (eventName === "license_key_created" || eventName === "license_key_updated") {
    if (!dataId || !attrs.key) return json(400, { ok: false, error: "bad_data" });
    const code = await lsPassCode(dataId);
    const passHash = await sha256(String(attrs.key).trim());
    const status = attrs.status === "active" ? "active" : attrs.status === "inactive" ? "paused" : "canceled";
    const limit = Math.max(1, Math.min(100000, Math.round(Number(env?.PRO_MONTHLY_LIMIT) || 1500)));

    await env.DB
      .prepare("INSERT INTO pro_passes (code, pass_hash, status, country, allow_roam, tts_used, tts_limit, period_start, created_at) VALUES (?, ?, ?, 'US', 0, 0, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET pass_hash = excluded.pass_hash, status = excluded.status")
      .bind(code, passHash, status, limit, now, now)
      .run();

    if (attrs.order_id) {
      await env.DB
        .prepare("INSERT INTO pro_links (ref_id, pass_code, updated_at) VALUES (?, ?, ?) ON CONFLICT(ref_id) DO UPDATE SET pass_code = excluded.pass_code, updated_at = excluded.updated_at")
        .bind(`ls:order:${attrs.order_id}`, code, now)
        .run();
    }
    if (attrs.order_item_id) {
      await env.DB
        .prepare("INSERT INTO pro_links (ref_id, pass_code, updated_at) VALUES (?, ?, ?) ON CONFLICT(ref_id) DO UPDATE SET pass_code = excluded.pass_code, updated_at = excluded.updated_at")
        .bind(`ls:item:${attrs.order_item_id}`, code, now)
        .run();
    }
    return json(200, { ok: true, event: eventName, code, status });
  }

  const refCandidates = [
    attrs.order_id && `ls:order:${attrs.order_id}`,
    dataId && eventName.startsWith("order") && `ls:order:${dataId}`,
    attrs.subscription_id && `ls:sub:${attrs.subscription_id}`,
    dataId && eventName.startsWith("subscription") && `ls:sub:${dataId}`,
    attrs.first_subscription_item?.id && `ls:item:${attrs.first_subscription_item.id}`,
  ].filter(Boolean);

  let passCode = null;
  for (const ref of refCandidates) {
    const row = await env.DB.prepare("SELECT pass_code FROM pro_links WHERE ref_id = ?").bind(ref).first();
    if (row?.pass_code) { passCode = row.pass_code; break; }
  }

  if (passCode && attrs.subscription_id) {
    await env.DB
      .prepare("INSERT INTO pro_links (ref_id, pass_code, updated_at) VALUES (?, ?, ?) ON CONFLICT(ref_id) DO UPDATE SET pass_code = excluded.pass_code, updated_at = excluded.updated_at")
      .bind(`ls:sub:${attrs.subscription_id}`, passCode, now)
      .run();
  }

  if (passCode && eventName === "subscription_payment_success") {
    await env.DB.prepare("UPDATE pro_passes SET status = 'active', tts_used = 0, period_start = ? WHERE code = ?").bind(now, passCode).run();
    return json(200, { ok: true, event: eventName, code: passCode, renewed: true });
  }

  if (passCode && (eventName === "order_refunded" || eventName === "subscription_cancelled" || eventName === "subscription_expired")) {
    await env.DB.prepare("UPDATE pro_passes SET status = 'canceled' WHERE code = ?").bind(passCode).run();
    return json(200, { ok: true, event: eventName, code: passCode, canceled: true });
  }

  return json(200, { ok: true, event: eventName || "unknown", ignored: true });
}
