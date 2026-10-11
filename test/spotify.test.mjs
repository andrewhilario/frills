// Talking to Spotify: the PKCE login (checked against the standard's own example), the calls, the refreshing, and what is said when Spotify
// refuses. A pretend fetch and a pretend storage: nothing goes to Spotify.

import test from "node:test";
import assert from "node:assert/strict";
import { SCOPES, SpotifyClient, REDIRECT_PATH, authorizeUrl, b64url, challengeOf, describe, makeVerifier } from "../src/js/spotify.js";

const REDIRECT = "https://frills.example" + REDIRECT_PATH;
const memory = () => { const data = new Map(); return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k), data }; };
const reply = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (name) => headers[name.toLowerCase()] ?? null }, json: async () => { if (body === undefined) throw new Error("no body"); return body; } });

function rig(handler, { now = 1_000_000 } = {}) {
  const calls = [];
  const clock = { t: now };
  const storage = memory();
  const client = new SpotifyClient({ clientId: "abc123", redirectUri: REDIRECT, storage, now: () => clock.t, fetchImpl: async (url, init = {}) => { calls.push({ url: String(url), method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body ? String(init.body) : "" }); return handler(String(url), init, calls); } });
  return { client, calls, storage, clock };
}
const login = (client, over = {}) => client.keep({ access_token: "ACCESS", refresh_token: "REFRESH", expires_in: 3600, scope: SCOPES.join(" "), ...over });

test("the code challenge is the standard's SHA-256 of the verifier, in URL-safe base64 (the example from RFC 7636)", async () => {
  assert.equal(await challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  assert.equal(b64url(new Uint8Array([251, 255, 254])), "-__-", "+ and / become - and _, and there is no =");
});

test("a verifier is 64 URL-safe characters, and every one is different", () => {
  const a = makeVerifier();
  const b = makeVerifier();
  assert.match(a, /^[A-Za-z0-9_-]{64}$/);
  assert.notEqual(a, b);
});

test("the login address carries the app, the redirect, the scopes, the challenge and the state, and no secret", () => {
  const url = new URL(authorizeUrl({ clientId: "abc123", redirectUri: REDIRECT, challenge: "CHAL", state: "STATE" }));
  assert.equal(url.origin + url.pathname, "https://accounts.spotify.com/authorize");
  const p = url.searchParams;
  assert.deepEqual([p.get("client_id"), p.get("response_type"), p.get("redirect_uri"), p.get("code_challenge_method"), p.get("code_challenge"), p.get("state")], ["abc123", "code", REDIRECT, "S256", "CHAL", "STATE"]);
  assert.deepEqual(p.get("scope").split(" "), ["user-read-currently-playing", "user-read-playback-state", "user-modify-playback-state"]);
  assert.equal(url.search.includes("secret"), false);
});

test("logging in: the verifier is kept for the way back, and the code is exchanged once, for tokens that are stored", async () => {
  const { client, calls, storage } = rig((url) => reply(200, { access_token: "ACCESS", refresh_token: "REFRESH", expires_in: 3600, scope: "a b" }));
  const to = new URL(await client.begin());
  const state = to.searchParams.get("state");
  assert.ok(state.length >= 16);
  const session = JSON.parse(storage.getItem("frills:spotify:session"));
  assert.equal(to.searchParams.get("code_challenge"), await challengeOf(session.verifier), "the challenge matches the verifier that was kept");
  assert.deepEqual(await client.finish(`?code=THECODE&state=${state}`), { ok: true });
  const body = new URLSearchParams(calls[0].body);
  assert.deepEqual([calls[0].url, body.get("grant_type"), body.get("code"), body.get("client_id"), body.get("redirect_uri"), body.get("code_verifier")], ["https://accounts.spotify.com/api/token", "authorization_code", "THECODE", "abc123", REDIRECT, session.verifier]);
  assert.equal(body.has("client_secret"), false, "no secret is ever sent");
  assert.equal(client.loggedIn, true);
  assert.equal(client.tokens.access, "ACCESS");
  assert.equal(storage.getItem("frills:spotify:session"), null, "the verifier is used once and removed");
});

test("a login that went wrong says why, in words", async () => {
  const wrong = async (search, setup = true) => {
    const { client } = rig(() => reply(400, { error: "invalid_grant", error_description: "Invalid redirect URI" }));
    if (setup) await client.begin();
    return client.finish(search);
  };
  assert.match((await wrong("?error=access_denied")).error, /said no/);
  assert.match((await wrong("?code=x&state=y", false)).error, /opened by Spotify/);
  const begun = rig(() => reply(200, {}));
  await begun.client.begin();
  assert.match((await begun.client.finish("?code=x&state=not-the-same")).error, /did not match/);
  const rejected = rig(() => reply(400, { error: "invalid_grant", error_description: "Invalid redirect URI" }));
  const to = new URL(await rejected.client.begin());
  const result = await rejected.client.finish(`?code=x&state=${to.searchParams.get("state")}`);
  assert.match(result.error, /Invalid redirect URI/);
  assert.ok(result.error.includes(REDIRECT), "it says what the redirect address has to be in the dashboard");
  assert.equal(rejected.client.loggedIn, false);
  const slow = rig(() => reply(200, {}));
  const t2 = new URL(await slow.client.begin());
  slow.clock.t += 16 * 60 * 1000;
  assert.match((await slow.client.finish(`?code=x&state=${t2.searchParams.get("state")}`)).error, /too long/);
});

test("a login is renewed by itself a minute before it ends, once even when several calls ask together, and a refused renewal logs out", async () => {
  const { client, calls, clock } = rig((url) => (url.includes("/api/token") ? reply(200, { access_token: "NEW", expires_in: 3600 }) : reply(200, {})));
  login(client);
  assert.equal(await client.token(), "ACCESS", "still good: no call");
  assert.equal(calls.length, 0);
  clock.t += 3600 * 1000 - 30 * 1000;
  const got = await Promise.all([client.token(), client.token(), client.token()]);
  assert.deepEqual(got, ["NEW", "NEW", "NEW"]);
  assert.equal(calls.filter((c) => c.url.includes("/api/token")).length, 1, "asked once for all three");
  assert.equal(new URLSearchParams(calls[0].body).get("grant_type"), "refresh_token");
  assert.equal(client.tokens.refresh, "REFRESH", "the refresh key is kept when Spotify does not send a new one");
  const refused = rig(() => reply(400, { error: "invalid_grant" }));
  login(refused.client);
  refused.clock.t += 7200 * 1000;
  assert.equal(await refused.client.token(), "");
  assert.equal(refused.client.loggedIn, false, "a refused renewal means logged out, not a loop");
});

test("what is playing: a song, nothing, paused, and a login that ran out", async () => {
  const playing = { is_playing: true, progress_ms: 61000, item: { id: "t1", uri: "spotify:track:" + "a".repeat(22), name: "Blinding Lights", duration_ms: 200000, artists: [{ name: "The Weeknd" }], album: { images: [{ url: "https://i.scdn.co/big" }, { url: "https://i.scdn.co/mid" }, { url: "https://i.scdn.co/small" }] } } };
  const a = rig(() => reply(200, playing));
  login(a.client);
  const now = await a.client.nowPlaying();
  assert.deepEqual([now.playing, now.title, now.artist, now.progressMs, now.durationMs, now.cover], [true, "Blinding Lights", "The Weeknd", 61000, 200000, "https://i.scdn.co/mid"]);
  assert.match(a.calls[0].url, /\/me\/player\/currently-playing/);
  assert.equal(a.calls[0].headers.authorization, "Bearer ACCESS");
  const idle = rig(() => reply(204));
  login(idle.client);
  assert.deepEqual(await idle.client.nowPlaying(), { playing: false });
  const paused = rig(() => reply(200, { ...playing, is_playing: false }));
  login(paused.client);
  assert.equal((await paused.client.nowPlaying()).playing, false);
  const expired = rig((url) => (url.includes("/api/token") ? reply(400, { error: "invalid_grant" }) : reply(401, { error: { message: "The access token expired" } })));
  login(expired.client);
  assert.match((await expired.client.nowPlaying()).error, /login ran out/);
});

test("a 401 gets one renewal and one retry, not a loop", async () => {
  let api = 0;
  const { client, calls } = rig((url) => {
    if (url.includes("/api/token")) return reply(200, { access_token: "FRESH", expires_in: 3600 });
    api += 1;
    return api === 1 ? reply(401, { error: { message: "expired" } }) : reply(200, { display_name: "Andrew" });
  });
  login(client);
  assert.deepEqual(await client.me(), { name: "Andrew" });
  assert.equal(api, 2);
  assert.equal(calls.filter((c) => c.url.includes("/api/token")).length, 1);
  assert.equal(calls.at(-1).headers.authorization, "Bearer FRESH");
});

test("search finds at most a handful of songs and leaves out anything without a Spotify address", async () => {
  const items = [{ id: "1", uri: "spotify:track:" + "a".repeat(22), name: "One", duration_ms: 1000, artists: [{ name: "A" }, { name: "B" }], album: { images: [] } }, { id: "2", uri: "", name: "No address", artists: [], album: {} }];
  const { client, calls } = rig(() => reply(200, { tracks: { items } }));
  login(client);
  const found = await client.search("  blinding   lights  ");
  assert.equal(found.results.length, 1);
  assert.deepEqual([found.results[0].title, found.results[0].artist, found.results[0].seconds], ["One", "A, B", 1]);
  const url = new URL(calls[0].url);
  assert.deepEqual([url.searchParams.get("q"), url.searchParams.get("type"), url.searchParams.get("limit")], ["blinding lights", "track", "5"], "tidy words, tracks only, within Spotify's new limit of 10");
  assert.deepEqual(await client.search("a"), { results: [] }, "too short to search");
  assert.equal(calls.length, 1);
});

test("adding to the queue: only a real song address, and every way Spotify can say no is explained", async () => {
  const uri = "spotify:track:" + "b".repeat(22);
  const ok = rig(() => reply(204));
  login(ok.client);
  assert.deepEqual(await ok.client.addToQueue(uri), { ok: true });
  assert.equal(ok.calls[0].method, "POST");
  assert.equal(new URL(ok.calls[0].url).searchParams.get("uri"), uri);
  assert.match((await ok.client.addToQueue("spotify:album:xyz")).error, /not a Spotify song/);
  assert.match((await ok.client.addToQueue("https://evil.example")).error, /not a Spotify song/);
  assert.equal(ok.calls.length, 1, "nothing was sent for those");
  const noDevice = rig(() => reply(404, { error: { status: 404, message: "Player command failed: No active device found", reason: "NO_ACTIVE_DEVICE" } }));
  login(noDevice.client);
  assert.match((await noDevice.client.addToQueue(uri)).error, /Open Spotify on your phone or computer/);
  const premium = rig(() => reply(403, { error: { status: 403, message: "Player command failed: Premium required", reason: "PREMIUM_REQUIRED" } }));
  login(premium.client);
  assert.match((await premium.client.addToQueue(uri)).error, /Premium.*allowlist/);
  const busy = rig(() => reply(429, {}, { "retry-after": "7" }));
  login(busy.client);
  assert.match((await busy.client.addToQueue(uri)).error, /7 seconds/);
  assert.match(describe(503), /problem on its side/);
});

test("logging out forgets everything, and storage that is blocked never breaks anything", async () => {
  const { client, storage } = rig(() => reply(200, {}));
  login(client);
  assert.equal(client.loggedIn, true);
  client.logout();
  assert.equal(client.loggedIn, false);
  assert.equal(storage.data.size, 0);
  const blocked = new SpotifyClient({ clientId: "x", redirectUri: REDIRECT, storage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } }, fetchImpl: async () => reply(200, {}) });
  assert.equal(blocked.loggedIn, false);
  assert.equal(await blocked.token(), "");
  assert.match((await blocked.nowPlaying()).error, /login ran out/);
  blocked.logout();
});
