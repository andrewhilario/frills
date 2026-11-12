// Regional availability, Pro Pass storage/verification, and dev bypasses for paid Frills features (AI Talking Pet TTS).
// Enforced server-side inside the Worker using Cloudflare's `request.cf.country`. Regular static pages remain globally free.

export const PASS_WINDOW_MS = 30 * 86400 * 1000;

export const DEFAULT_PRO_COUNTRIES = new Set([
  // North America & Oceania
  "US", "CA", "AU", "NZ",
  // UK & Ireland
  "GB", "IE",
  // EU-27 + EFTA
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
  "DE", "GR", "HU", "IS", "IT", "LV", "LI", "LT", "LU", "MT",
  "NL", "NO", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "CH",
]);

export const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    },
  });

export const sha256 = async (text) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");

const randHex = (bytes) => {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
};

/** Returns the visitor's 2-letter uppercase country code from Cloudflare, or "DEV" on localhost/test harness. */
export function regionOf(request, env) {
  const raw = request.cf?.country;
  if (typeof raw === "string" && /^[A-Za-z]{2}$/.test(raw.trim())) return raw.trim().toUpperCase();

  // Only local dev servers (`env.DEV === true`) accept a simulated country override for paywall/region testing.
  if (env?.DEV) {
    try {
      const url = new URL(request.url);
      const sim = request.headers.get("x-frills-country") || url.searchParams.get("country") || "";
      const clean = String(sim).trim().toUpperCase();
      if (clean === "DEV") return "DEV";
      if (/^[A-Z]{2}$/.test(clean)) return clean;
    } catch { /* ignore malformed url */ }
  }

  try {
    const host = new URL(request.url).hostname;
    if (host === "127.0.0.1" || host === "localhost") return "DEV";
  } catch { /* malformed url */ }
  return "XX";
}

/** Parses optional comma-separated PRO_COUNTRIES override, falling back to DEFAULT_PRO_COUNTRIES. */
export function allowedCountries(env) {
  const raw = String(env?.PRO_COUNTRIES ?? "").trim();
  if (!raw) return DEFAULT_PRO_COUNTRIES;
  return new Set(raw.split(",").map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)));
}

/** Looks up a hashed Pro Pass token in D1 and optionally resets its 30-day usage counter when elapsed. */
export async function lookupProPass(db, passToken, { now = Date.now(), resetExpired = false } = {}) {
  const token = String(passToken ?? "").trim();
  if (!db || !token) return null;
  const hash = await sha256(token);
  const row = await db
    .prepare("SELECT code, status, country, allow_roam, tts_used, tts_limit, period_start FROM pro_passes WHERE pass_hash = ?")
    .bind(hash)
    .first();
  if (!row) return null;
  if (resetExpired && row.status === "active" && now - row.period_start >= PASS_WINDOW_MS) {
    await db.prepare("UPDATE pro_passes SET tts_used = 0, period_start = ? WHERE code = ?").bind(now, row.code).run();
    row.tts_used = 0;
    row.period_start = now;
  }
  return row;
}

/** Creates a new Pro Pass row in D1 and returns its one-time bearer token alongside safe metadata. */
export async function issueProPass(db, { country = "US", limit = 1500, allowRoam = false, now = Date.now() } = {}) {
  if (!db) throw new Error("db_required");
  const cleanCountry = /^[A-Za-z]{2}$/.test(String(country).trim()) ? String(country).trim().toUpperCase() : "US";
  const cleanLimit = Math.max(1, Math.min(100000, Math.round(Number(limit) || 1500)));
  const roamInt = allowRoam ? 1 : 0;
  const code = randHex(8); // 16 hex chars
  const token = `frills_pro_${randHex(16)}`;
  const hash = await sha256(token);

  await db
    .prepare("INSERT INTO pro_passes (code, pass_hash, status, country, allow_roam, tts_used, tts_limit, period_start, created_at) VALUES (?, ?, 'active', ?, ?, 0, ?, ?, ?)")
    .bind(code, hash, cleanCountry, roamInt, cleanLimit, now, now)
    .run();

  return { code, token, country: cleanCountry, allowRoam: Boolean(roamInt), used: 0, limit: cleanLimit, periodStart: now };
}

/**
 * Checks whether the current request is allowed to purchase or use paid features.
 * Allows local dev ("DEV"), owner bypass (`x-frills-dev` matching `PRO_DEV_KEY`/`ADMIN_KEY`),
 * an active pass with `allow_roam = 1`, or a country in the allowed set.
 */
export function checkProRegion(request, env, { allowRoam = false, passToken = "" } = {}) {
  const country = regionOf(request, env);
  if (country === "DEV") return { eligible: true, country, reason: "local_dev" };

  const devHeader = request.headers.get("x-frills-dev") || passToken;
  const devSecret = String(env?.PRO_DEV_KEY ?? "").trim();
  const adminSecret = String(env?.ADMIN_KEY ?? "").trim();
  if ((devSecret && devHeader === devSecret) || (adminSecret && request.headers.get("x-frills-dev") === adminSecret)) {
    return { eligible: true, country, reason: "dev_override" };
  }

  if (allowRoam) return { eligible: true, country, reason: "roam_allowed" };

  const eligible = allowedCountries(env).has(country);
  return { eligible, country, reason: eligible ? "allowed_country" : "region_unavailable" };
}

/** GET /api/pro/status — checks region eligibility, AI provider readiness, and optional Pro Pass quota. */
export async function handleProStatus(request, env, { now = Date.now() } = {}) {
  if (request.method !== "GET") return json(405, { ok: false, error: "method_not_allowed" }, { allow: "GET" });
  const url = new URL(request.url);
  const passToken = String(request.headers.get("x-pass") || url.searchParams.get("pass") || "").trim();
  const passRow = passToken && env?.DB ? await lookupProPass(env.DB, passToken, { now, resetExpired: false }) : null;

  const check = checkProRegion(request, env, { allowRoam: passRow?.allow_roam === 1, passToken });
  const aiReady = Boolean(env?.OPENAI_TTS_KEY || env?.GOOGLE_TTS_KEY || env?.GROQ_TTS_KEY);
  const out = { ok: true, ...check, aiReady };

  const checkoutUrl = String(env?.LEMON_CHECKOUT_URL ?? "").trim();
  if (checkoutUrl.startsWith("https://")) out.checkoutUrl = checkoutUrl;
  if (env?.DEV) out.dev = true;
  if (passToken) {
    if (!env?.DB) {
      out.pass = { valid: false, error: "not_ready" };
    } else if (!passRow) {
      out.pass = { valid: false, error: "invalid_pass" };
    } else {
      const expired = passRow.status === "active" && now - passRow.period_start >= PASS_WINDOW_MS;
      const used = expired ? 0 : passRow.tts_used;
      out.pass = {
        valid: passRow.status === "active",
        code: passRow.code,
        status: passRow.status,
        country: passRow.country,
        allowRoam: passRow.allow_roam === 1,
        used,
        limit: passRow.tts_limit,
        remaining: Math.max(0, passRow.tts_limit - used),
        periodStart: expired ? now : passRow.period_start,
      };
    }
  }
  return json(200, out);
}
