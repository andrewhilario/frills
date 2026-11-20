// Stateless HMAC-SHA256 tickets for the dedicated Frills Plus TikTok relay (DigitalOcean).
// Shared between the Cloudflare Worker (mints short-lived tickets for active Plus subscribers) and helper/server.mjs (verifies tickets in memory with zero DB lookups).
// Uses Web Crypto (`crypto.subtle`) so the exact same code runs in both Cloudflare Workers and Node 22.

export const DEFAULT_TICKET_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const MIN_SECRET_LENGTH = 16;

const TICKET_PATTERN = /^([0-9a-f]{8,16})\.([0-9a-f]{16})\.([0-9a-f]{64})$/;
const enc = new TextEncoder();

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

const fromHex = (hex) => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

const timingSafeEqual = (a, b) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
};

async function signBytes(secret, payload) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

/** True when a configured shared secret is strong enough to sign and verify tickets. */
export function validTicketSecret(raw) {
  return String(raw ?? "").trim().length >= MIN_SECRET_LENGTH;
}

/** Mints a short-lived signed relay ticket: `<expHex>.<nonceHex>.<sigHex>`. Returns null if the secret is missing or too short. */
export async function signRelayTicket(rawSecret, { now = Date.now(), ttlMs = DEFAULT_TICKET_TTL_MS } = {}) {
  const secret = String(rawSecret ?? "").trim();
  if (!validTicketSecret(secret)) return null;
  const ttl = Math.max(10_000, Math.min(3_600_000, Math.round(Number(ttlMs) || DEFAULT_TICKET_TTL_MS)));
  const expiresAt = Math.floor(now) + ttl;
  const expHex = expiresAt.toString(16);
  const nonceHex = toHex(crypto.getRandomValues(new Uint8Array(8)));
  const payload = `${expHex}.${nonceHex}`;
  const sigHex = toHex(await signBytes(secret, payload));
  return { ticket: `${payload}.${sigHex}`, expiresAt };
}

/** Verifies a ticket in constant time. Returns `{ ok: true, expiresAt }` or `{ ok: false, error }`. */
export async function verifyRelayTicket(rawTicket, rawSecret, { now = Date.now() } = {}) {
  const secret = String(rawSecret ?? "").trim();
  if (!validTicketSecret(secret)) return { ok: false, error: "not_configured" };
  const text = String(rawTicket ?? "").trim();
  if (!text) return { ok: false, error: "missing" };
  const match = TICKET_PATTERN.exec(text);
  if (!match) return { ok: false, error: "bad_format" };
  const [, expHex, nonceHex, sigHex] = match;
  const expiresAt = Number.parseInt(expHex, 16);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) return { ok: false, error: "bad_format" };
  const expected = await signBytes(secret, `${expHex}.${nonceHex}`);
  const actual = fromHex(sigHex);
  if (!timingSafeEqual(expected, actual)) return { ok: false, error: "bad_sig" };
  if (expiresAt <= now) return { ok: false, error: "expired" };
  return { ok: true, expiresAt };
}
