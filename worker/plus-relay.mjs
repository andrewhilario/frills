// POST /api/plus/relay-ticket — mints a short-lived HMAC-SHA256 ticket for the dedicated Frills Plus TikTok relay (DigitalOcean).
// Accepts either a signed-in browser session cookie or a revocable Plus overlay link code (`x-overlay` header or JSON body `{ code }`).
// Unlike /api/tts, using the dedicated relay does NOT consume AI voice characters — it is included unlimited with an active Frills Plus subscription.

import { isCompPlus, plusActive } from "./accounts.mjs";
import { resolveCredential } from "./plus-credential.mjs";
import { checkProRegion, json } from "./region.mjs";
import { signRelayTicket, validTicketSecret } from "./relay-ticket.mjs";

export const DEFAULT_PLUS_RELAY_URL = "https://plus-relay.valwidgets.live";
const MAX_BODY = 512;

const sameOrigin = (request) => {
  const origin = request.headers.get("origin");
  return Boolean(origin) && origin === new URL(request.url).origin;
};

/** Validates PLUS_RELAY_URL (must be https://, or http://localhost|127.0.0.1 in local dev). */
export function resolvePlusRelayUrl(raw, { dev = false } = {}) {
  const text = String(raw ?? "").trim().replace(/\/+$/, "");
  const candidate = text || DEFAULT_PLUS_RELAY_URL;
  try {
    const parsed = new URL(candidate);
    if (parsed.username || parsed.password) return "";
    if (parsed.protocol === "https:") return parsed.origin;
    if (dev && parsed.protocol === "http:" && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")) return parsed.origin;
  } catch { /* invalid URL */ }
  return "";
}

export async function handlePlusRelayTicket(request, env, { now = Date.now() } = {}) {
  if (request.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" }, { allow: "POST" });
  if (!sameOrigin(request)) return json(403, { ok: false, error: "wrong_origin" });
  if (!env?.DB) return json(503, { ok: false, error: "not_ready" });

  const secret = String(env.PLUS_RELAY_SECRET ?? "").trim();
  const relayUrl = resolvePlusRelayUrl(env.PLUS_RELAY_URL, { dev: Boolean(env.DEV) });
  if (!validTicketSecret(secret) || !relayUrl) {
    return json(503, { ok: false, error: "plus_relay_off" });
  }

  let overlayCode = "";
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY) return json(413, { ok: false, error: "too_big" });
  if (rawBody.trim()) {
    try {
      const body = JSON.parse(rawBody);
      if (body && typeof body === "object" && typeof body.code === "string") overlayCode = body.code.trim();
    } catch {
      return json(400, { ok: false, error: "bad_data" });
    }
  }

  const who = await resolveCredential(request, env, { now, overlayCode });
  if (who.kind === "none") return json(401, { ok: false, error: "no_pass" });
  if (who.kind === "invalid" || !plusActive(who.plus, now)) return json(401, { ok: false, error: "invalid_pass" });

  if (!isCompPlus(who.plus)) {
    const region = checkProRegion(request, env);
    if (!region.eligible) return json(403, { ok: false, error: "region_unavailable", country: region.country });
  }

  const signed = await signRelayTicket(secret, { now });
  if (!signed) return json(503, { ok: false, error: "plus_relay_off" });

  return json(200, { ok: true, url: relayUrl, ticket: signed.ticket, expiresAt: signed.expiresAt });
}
