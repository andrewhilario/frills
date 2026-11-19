// Frills Plus dedicated relay client helpers:
//   - stores/reads the account's revocable 32-hex Plus link code (`frills:plus:code`) in localStorage
//   - attaches `&code=...` to generated OBS overlay links only when the user has generated a Plus code
//   - requests short-lived signed HMAC tickets from POST /api/plus/relay-ticket (never called for free users without a Plus code)

export const PLUS_CODE_KEY = "frills:plus:code";
const CODE_RE = /^[0-9a-f]{32}$/;

export const isPlusCode = (value) => CODE_RE.test(String(value ?? "").trim());

export function savedPlusCode() {
  try {
    const raw = localStorage.getItem(PLUS_CODE_KEY);
    return isPlusCode(raw) ? raw.trim() : "";
  } catch { return ""; }
}

export function savePlusCode(code) {
  const clean = String(code ?? "").trim();
  try {
    if (isPlusCode(clean)) localStorage.setItem(PLUS_CODE_KEY, clean);
    else localStorage.removeItem(PLUS_CODE_KEY);
  } catch {}
}

export function clearPlusCode() {
  try { localStorage.removeItem(PLUS_CODE_KEY); } catch {}
}

export function plusCodeFromParams(params = new URLSearchParams(globalThis.location?.search ?? "")) {
  const raw = params?.get?.("code") ?? "";
  return isPlusCode(raw) ? raw.trim() : "";
}

/** The dedicated Plus relay URL configured on the page (matches relayForPage's same-site rule). */
export const plusRelayForPage = () => (typeof document !== "undefined" && document.body?.dataset?.plusRelay && document.body.dataset.site === location.origin ? document.body.dataset.plusRelay.replace(/\/+$/, "") : "");

/** Appends `&code=...` to an overlay URL only when a valid 32-hex Plus code is provided and not already present. */
export function appendPlusCode(url, code = savedPlusCode()) {
  if (!url || !isPlusCode(code)) return url;
  try {
    const parsed = new URL(url, globalThis.location?.origin || "https://frills.valwidgets.live");
    if (!parsed.searchParams.get("code")) parsed.searchParams.set("code", code.trim());
    return parsed.toString();
  } catch { return url; }
}

const ticketCache = new Map();

/** Asks the Worker for a short-lived HMAC ticket for the dedicated Plus relay. Returns `{ url, ticket, expiresAt }` or `null`. */
export async function requestPlusRelayTicket({ code = "", force = false, fetchFn = globalThis.fetch, now = () => Date.now() } = {}) {
  const clean = isPlusCode(code) ? code.trim() : "";
  const key = clean || "_";
  if (!force) {
    const cached = ticketCache.get(key);
    if (cached && cached.expiresAt - now() > 60_000) return cached;
  }
  const stop = typeof AbortController === "function" ? new AbortController() : null;
  const timer = stop ? setTimeout(() => stop.abort(), 5000) : 0;
  try {
    const res = await fetchFn("/api/plus/relay-ticket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(clean ? { code: clean } : {}),
      credentials: "same-origin",
      ...(stop ? { signal: stop.signal } : {}),
    });
    if (!res?.ok) { ticketCache.delete(key); return null; }
    const b = await res.json().catch(() => null);
    if (!b?.ok || typeof b.url !== "string" || typeof b.ticket !== "string") return null;
    const entry = { url: b.url.replace(/\/+$/, ""), ticket: b.ticket, expiresAt: Number(b.expiresAt) || now() + 540_000 };
    ticketCache.set(key, entry);
    return entry;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function clearRelayTicketCache() {
  ticketCache.clear();
}
