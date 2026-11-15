// Regional availability and the status answer for paid Frills Plus features (AI Talking Pet voices). Who has Plus is decided by an account (accounts.mjs, plus-gate.mjs); there is no key.
// Enforced server-side inside the Worker using Cloudflare's `request.cf.country`. Regular static pages remain globally free.

import { resolveCredential } from "./plus-credential.mjs";
import { plusActive } from "./accounts.mjs";

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

/**
 * Checks whether the current request is allowed to purchase or use paid features.
 * Allows local dev ("DEV"), the owner's override (a `x-frills-dev` header matching `PRO_DEV_KEY`/`ADMIN_KEY`, which a browser page cannot send), or a country in the allowed set.
 */
export function checkProRegion(request, env) {
  const country = regionOf(request, env);
  if (country === "DEV") return { eligible: true, country, reason: "local_dev" };

  const devHeader = request.headers.get("x-frills-dev");
  const devSecret = String(env?.PRO_DEV_KEY ?? "").trim();
  const adminSecret = String(env?.ADMIN_KEY ?? "").trim();
  if ((devSecret && devHeader === devSecret) || (adminSecret && request.headers.get("x-frills-dev") === adminSecret)) {
    return { eligible: true, country, reason: "dev_override" };
  }

  const eligible = allowedCountries(env).has(country);
  return { eligible, country, reason: eligible ? "allowed_country" : "region_unavailable" };
}

/** GET /api/pro/status — region eligibility, AI provider readiness, and (for an overlay link's code or a signed-in browser) what Frills Plus has left this month. */
export async function handleProStatus(request, env, { now = Date.now() } = {}) {
  if (request.method !== "GET") return json(405, { ok: false, error: "method_not_allowed" }, { allow: "GET" });
  const url = new URL(request.url);
  const overlayCode = String(request.headers.get("x-overlay") || url.searchParams.get("overlay") || "").trim();

  const check = checkProRegion(request, env);
  const aiReady = Boolean(env?.OPENAI_TTS_KEY || env?.GOOGLE_TTS_KEY || env?.GROQ_TTS_KEY);
  const out = { ok: true, ...check, aiReady };

  if (env?.DEV) out.dev = true;
  // A Frills Plus account (an overlay link's code, or a signed-in browser): what it has bought and what is left of this month.
  const who = await resolveCredential(request, env, { now, overlayCode });
  if (who.kind !== "none") {
    if (who.kind === "invalid" || !plusActive(who.plus, now)) out.pass = { valid: false, error: "invalid_pass" };
    else {
      const p = who.plus;
      out.pass = { valid: true, status: p.status, used: p.tts_used, limit: p.tts_limit, remaining: Math.max(0, p.tts_limit - p.tts_used), periodStart: p.period_start };
    }
  }
  return json(200, out);
}
