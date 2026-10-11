// Talking to Spotify from the browser, with nothing on a server: the "Authorization Code with PKCE" login (no secret, so it is safe in a
// page), the playback calls we need (what is playing, search, add to the queue), and plain-words explanations of what Spotify says when it
// refuses. The fetch, the storage and the clock are given in, so it is tested without Spotify.
//
// Spotify's rules (checked October 2026): an app in development mode works for at most five allowlisted people and its owner needs Premium;
// adding to the queue needs Premium and a device that is open and active; the redirect address must be https (or 127.0.0.1) and match
// exactly what is registered in the Spotify dashboard.

export const AUTH_URL = "https://accounts.spotify.com/authorize";
export const TOKEN_URL = "https://accounts.spotify.com/api/token";
export const API_URL = "https://api.spotify.com/v1";
export const SCOPES = ["user-read-currently-playing", "user-read-playback-state", "user-modify-playback-state"];
export const REDIRECT_PATH = "/spotify/callback/";

const KEYS = { session: "frills:spotify:session", tokens: "frills:spotify:tokens" };

/** Bytes -> the URL-safe base64 that PKCE uses (no +, no /, no =). */
export const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A random code verifier: 64 URL-safe characters (the standard asks for 43 to 128). */
export function makeVerifier(random = (bytes) => globalThis.crypto.getRandomValues(bytes)) {
  const bytes = new Uint8Array(48);
  random(bytes);
  return b64url(bytes);
}

/** The code challenge for a verifier: its SHA-256, in URL-safe base64. */
export async function challengeOf(verifier, subtle = globalThis.crypto?.subtle) {
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

/** The address a person is sent to, to say yes to Spotify. */
export function authorizeUrl({ clientId, redirectUri, challenge, state, scopes = SCOPES }) {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: redirectUri, scope: scopes.join(" "), code_challenge_method: "S256", code_challenge: challenge, state }).toString();
  return url.toString();
}

/** What Spotify said, in words a streamer can act on. `reason` is Spotify's own code when it gives one. */
export function describe(status, reason = "", retryAfter = 0) {
  if (status === 401) return "Your Spotify login ran out. Press Log in with Spotify again.";
  if (status === 403) return "Spotify said no. Adding to the queue needs Premium, and this Spotify account has to be on the app's allowlist in the Spotify dashboard.";
  if (status === 404 && /NO_ACTIVE_DEVICE/i.test(reason)) return "Spotify has no device to play on. Open Spotify on your phone or computer and start any song, then try again.";
  if (status === 404) return "Spotify could not find that. If you were adding to the queue, open Spotify on a device and start any song first.";
  if (status === 429) return `Spotify asks us to slow down${retryAfter ? `. Try again in ${retryAfter} seconds` : ""}.`;
  if (status >= 500) return "Spotify is having a problem on its side. Try again in a moment.";
  return `Spotify answered with an error (${status}).`;
}

const tidyTrack = (t) => ({
  id: String(t?.id ?? ""),
  uri: String(t?.uri ?? ""),
  title: String(t?.name ?? "").slice(0, 160),
  artist: (Array.isArray(t?.artists) ? t.artists.map((a) => a?.name).filter(Boolean) : []).join(", ").slice(0, 120),
  cover: String((t?.album?.images ?? []).at(-2)?.url ?? (t?.album?.images ?? []).at(-1)?.url ?? ""),
  seconds: Math.max(0, Math.round((Number(t?.duration_ms) || 0) / 1000)),
});

export class SpotifyClient {
  constructor({ clientId, redirectUri, fetchImpl = globalThis.fetch?.bind(globalThis), storage = globalThis.localStorage, now = () => Date.now() } = {}) {
    this.clientId = clientId;
    this.redirectUri = redirectUri;
    this.fetch = fetchImpl;
    this.storage = storage;
    this.now = now;
    this.refreshing = null;
    this.last = null; // the last call, for the test page's details: { method, path, status }
  }

  read(key) { try { return JSON.parse(this.storage.getItem(key) ?? "null"); } catch { return null; } }
  write(key, value) { try { value === null ? this.storage.removeItem(key) : this.storage.setItem(key, JSON.stringify(value)); } catch { /* storage can be blocked */ } }

  get tokens() { return this.read(KEYS.tokens); }
  get loggedIn() { return Boolean(this.tokens?.refresh || this.tokens?.access); }
  logout() { this.write(KEYS.tokens, null); this.write(KEYS.session, null); }

  /** Starts the login: remembers the secret half of the challenge, and returns where to send the person. */
  async begin(random) {
    const verifier = makeVerifier(random);
    const state = makeVerifier(random).slice(0, 24);
    this.write(KEYS.session, { verifier, state, at: this.now() });
    return authorizeUrl({ clientId: this.clientId, redirectUri: this.redirectUri, challenge: await challengeOf(verifier), state });
  }

  /** The page Spotify sent the person back to (its search part, "?code=...&state=..."). Returns { ok: true } or { error: "words" }. */
  async finish(search) {
    const params = new URLSearchParams(search);
    const session = this.read(KEYS.session);
    this.write(KEYS.session, null);
    if (params.get("error")) return { error: params.get("error") === "access_denied" ? "You said no on Spotify's page, so nothing was connected." : `Spotify stopped the login (${params.get("error")}).` };
    if (!session || !params.get("code")) return { error: "This page needs to be opened by Spotify after you log in. Go back and press Log in with Spotify." };
    if (params.get("state") !== session.state) return { error: "The login did not match the one that was started, so it was stopped for safety. Try again." };
    if (this.now() - session.at > 15 * 60 * 1000) return { error: "That login took too long. Try again." };
    const body = new URLSearchParams({ grant_type: "authorization_code", code: params.get("code"), redirect_uri: this.redirectUri, client_id: this.clientId, code_verifier: session.verifier });
    const res = await this.fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) return { error: `Spotify would not give a login (${data.error_description ?? data.error ?? res.status}). Check that the redirect address in the Spotify dashboard is exactly ${this.redirectUri}` };
    this.keep(data);
    return { ok: true };
  }

  keep(data) {
    const old = this.tokens ?? {};
    this.write(KEYS.tokens, { access: data.access_token, refresh: data.refresh_token ?? old.refresh ?? "", expires: this.now() + (Number(data.expires_in) || 3600) * 1000, scope: data.scope ?? old.scope ?? "" });
  }

  /** A login that is good for the next minute, getting a fresh one first when it is about to end. Returns "" when there is none. */
  async token() {
    const t = this.tokens;
    if (!t) return "";
    if (t.access && t.expires - this.now() > 60 * 1000) return t.access;
    if (!t.refresh) return "";
    this.refreshing ??= (async () => {
      try {
        const res = await this.fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh, client_id: this.clientId }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.access_token) { if (res.status === 400 || res.status === 401) this.write(KEYS.tokens, null); return ""; }
        this.keep(data);
        return data.access_token;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /** One call to Spotify's player and search. Returns { status, data } and, when it went wrong, { error: "words" }. */
  async call(method, path, { query, retried = false } = {}) {
    const access = await this.token();
    if (!access) return { status: 401, data: null, error: describe(401) };
    const url = `${API_URL}${path}${query ? "?" + new URLSearchParams(query) : ""}`;
    const res = await this.fetch(url, { method, headers: { authorization: `Bearer ${access}` } });
    this.last = { method, path, status: res.status };
    if (res.status === 401 && !retried) { this.write(KEYS.tokens, { ...(this.tokens ?? {}), expires: 0 }); return this.call(method, path, { query, retried: true }); }
    if (res.status === 204) return { status: 204, data: null };
    const data = await res.json().catch(() => null);
    if (res.ok) return { status: res.status, data };
    return { status: res.status, data, error: describe(res.status, data?.error?.reason ?? data?.error?.message ?? "", Number(res.headers?.get?.("retry-after")) || 0) };
  }

  /** Who is logged in: { name } or { error }. */
  async me() {
    const r = await this.call("GET", "/me");
    return r.error ? { error: r.error } : { name: String(r.data?.display_name ?? r.data?.id ?? "") };
  }

  /** What is playing: { playing: false } when nothing is, else { playing, title, artist, cover, progressMs, durationMs, uri }. */
  async nowPlaying() {
    const r = await this.call("GET", "/me/player/currently-playing", { query: { additional_types: "track" } });
    if (r.error) return { error: r.error };
    if (!r.data?.item) return { playing: false };
    const track = tidyTrack(r.data.item);
    return { playing: r.data.is_playing === true, ...track, progressMs: Number(r.data.progress_ms) || 0, durationMs: Number(r.data.item.duration_ms) || 0 };
  }

  /** Songs matching some words (Spotify gives at most 10 now): { results: [...] } or { error }. */
  async search(words) {
    const q = String(words ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
    if (q.length < 2) return { results: [] };
    const r = await this.call("GET", "/search", { query: { q, type: "track", limit: "5" } });
    return r.error ? { error: r.error } : { results: (r.data?.tracks?.items ?? []).map(tidyTrack).filter((t) => t.uri) };
  }

  /** Puts a song at the end of the person's queue: { ok: true } or { error }. */
  async addToQueue(uri) {
    if (!/^spotify:track:[A-Za-z0-9]{22}$/.test(String(uri))) return { error: "That is not a Spotify song." };
    const r = await this.call("POST", "/me/player/queue", { query: { uri } });
    return r.error ? { error: r.error } : { ok: true };
  }
}
