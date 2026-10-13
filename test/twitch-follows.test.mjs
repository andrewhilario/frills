// Twitch follows, the streamer's side (src/js/twitch-follows.js): the login in the browser, and the listener for new followers, with a pretend
// Twitch (a pretend WebSocket and a pretend fetch) and a pretend clock.

import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { EVENTSUB, FollowWatcher, HELIX, SCOPE, VALIDATE, authorizeUrl, beginLogin, clearLogin, finishLogin, loadLogin, saveLogin, validate } from "../src/js/twitch-follows.js";

const memory = () => { const data = new Map(); return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k), data }; };

// ── the login ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("the login address asks only to see who follows the person's own channel, and carries a state to check on the way back", () => {
  const url = new URL(authorizeUrl({ clientId: "abc123", redirectUri: "https://x.test/twitch/callback/", state: "st4te" }));
  assert.equal(url.origin + url.pathname, "https://id.twitch.tv/oauth2/authorize");
  assert.deepEqual([...url.searchParams.keys()].sort(), ["client_id", "redirect_uri", "response_type", "scope", "state"]);
  assert.equal(url.searchParams.get("response_type"), "token", "no secret is involved");
  assert.equal(url.searchParams.get("scope"), "moderator:read:followers");
  assert.equal(SCOPE, "moderator:read:followers");
  assert.equal(url.searchParams.get("redirect_uri"), "https://x.test/twitch/callback/");
});

test("coming back from Twitch: the right state gives the token; a wrong, missing or reused state, a refusal and a damaged token do not", () => {
  const go = (hash, search = "", storage) => finishLogin(hash, search, { storage });
  const session = memory();
  const address = beginLogin({ clientId: "c", redirectUri: "https://x.test/cb/", storage: session });
  const state = new URL(address).searchParams.get("state");
  assert.match(state, /^[A-Za-z0-9_-]{24}$/);
  assert.deepEqual(go(`#access_token=abcdefghij1234567890&scope=moderator%3Aread%3Afollowers&state=${state}&token_type=bearer`, "", session), { token: "abcdefghij1234567890" });
  assert.match(go(`#access_token=abcdefghij1234567890&state=${state}`, "", session).error, /did not come from this page/, "the state is good for one login only");

  const again = memory();
  const second = new URL(beginLogin({ clientId: "c", redirectUri: "https://x.test/cb/", storage: again })).searchParams.get("state");
  assert.match(go("#access_token=abcdefghij1234567890&state=someone-elses", "", again).error, /did not come from this page/, "a login somebody else made up");
  assert.match(go("#access_token=abcdefghij1234567890", "", memory()).error, /did not come from this page/, "no state kept: refused");
  const refused = memory();
  const third = new URL(beginLogin({ clientId: "c", redirectUri: "https://x.test/cb/", storage: refused })).searchParams.get("state");
  assert.match(go("", `?error=access_denied&error_description=The+user+denied+you+access&state=${third}`, refused).error, /said no/);
  const damaged = memory();
  const fourth = new URL(beginLogin({ clientId: "c", redirectUri: "https://x.test/cb/", storage: damaged })).searchParams.get("state");
  assert.match(go(`#access_token=<script>&state=${fourth}`, "", damaged).error, /did not send a login/);
  assert.ok(second);
});

test("asking Twitch who a login belongs to: the person, what it may do, an ended login, and no connection", async () => {
  const answer = (status, body) => async (url, options) => { answer.last = { url, options }; return { ok: status >= 200 && status < 300, status, json: async () => body }; };
  const ok = await validate("tok123456789", { fetchImpl: answer(200, { client_id: "cid", login: "mochi", user_id: "42", scopes: ["moderator:read:followers"], expires_in: 5000 }) });
  assert.deepEqual(ok, { login: "mochi", userId: "42", clientId: "cid", scopes: ["moderator:read:followers"], expiresIn: 5000 });
  assert.equal(answer.last.url, VALIDATE);
  assert.equal(answer.last.options.headers.Authorization, "OAuth tok123456789");
  assert.equal((await validate("t", { fetchImpl: answer(401, {}) })).expired, true);
  assert.match((await validate("t", { fetchImpl: answer(500, {}) })).error, /could not check/i);
  assert.match((await validate("t", { fetchImpl: async () => { throw new Error("offline"); } })).error, /Could not reach Twitch/);
});

test("the login kept in the browser is read back, and anything damaged is ignored", () => {
  const storage = memory();
  assert.equal(loadLogin(storage), null);
  saveLogin({ token: "abcdefghij1234567890", login: "mochi", userId: "42" }, storage);
  assert.equal(loadLogin(storage).login, "mochi");
  clearLogin(storage);
  assert.equal(loadLogin(storage), null);
  storage.setItem("frills:twitch:login", "{ not json");
  assert.equal(loadLogin(storage), null);
  storage.setItem("frills:twitch:login", JSON.stringify({ token: "<img>" }));
  assert.equal(loadLogin(storage), null, "a token that cannot be one");
  assert.doesNotThrow(() => saveLogin({ token: "x" }, { setItem() { throw new Error("blocked"); } }));
});

// ── the listener ────────────────────────────────────────────────────────────────────────────────────────────────────────────

class FakeSocket {
  constructor(url) { this.url = url; this.closed = false; FakeSocket.all.push(this); }
  close() { this.closed = true; }
  say(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
  hangUp() { this.onclose?.(); }
}
FakeSocket.all = [];

let serial = 0;
const welcome = (id, keepalive = 10) => ({ metadata: { message_id: `m${++serial}`, message_type: "session_welcome" }, payload: { session: { id, keepalive_timeout_seconds: keepalive } } });
const notice = (user, over = {}) => ({ metadata: { message_id: `m${++serial}`, message_type: "notification" }, payload: { subscription: { type: "channel.follow" }, event: { user_id: "7", user_login: user.toLowerCase(), user_name: user, followed_at: "2026-10-13T10:00:00Z", ...over } } });
const flush = () => new Promise((resolve) => setImmediate(resolve)); // lets the subscribe call finish (real time: the fake fetch answers at once)

/** A watcher on a pretend Twitch. `answers` are the statuses the subscribe call gets, one by one (then 202). */
function watching(answers = []) {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  FakeSocket.all = [];
  const calls = [];
  const follows = [];
  const states = [];
  const watcher = new FollowWatcher({
    token: "tok123456789", clientId: "cid", userId: "42",
    fetchImpl: async (url, options) => { calls.push({ url, options }); return { status: answers.shift() ?? 202 }; },
    socketFactory: (url) => new FakeSocket(url),
    onFollow: (f) => follows.push(f),
    onStatus: (s) => states.push(s.state),
  });
  watcher.start();
  return { watcher, calls, follows, states, sockets: FakeSocket.all };
}
const done = (watcher) => { watcher.stop(); mock.timers.reset(); };

test("it connects, asks Twitch for follow notifications about the person's own channel, and says it is listening", async () => {
  const { watcher, calls, states, sockets } = watching();
  try {
    assert.equal(sockets[0].url, EVENTSUB);
    sockets[0].say(welcome("session-1"));
    await flush();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${HELIX}/eventsub/subscriptions`);
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.headers.Authorization, "Bearer tok123456789");
    assert.equal(calls[0].options.headers["Client-Id"], "cid");
    assert.deepEqual(JSON.parse(calls[0].options.body), { type: "channel.follow", version: "2", condition: { broadcaster_user_id: "42", moderator_user_id: "42" }, transport: { method: "websocket", session_id: "session-1" } });
    assert.deepEqual(states, ["connecting", "listening"]);
  } finally { done(watcher); }
});

test("each new follower is passed on once, even if Twitch sends the message twice, and other notifications are ignored", async () => {
  const { watcher, follows, sockets } = watching();
  try {
    sockets[0].say(welcome("s"));
    await flush();
    const first = notice("Mochi_Bun", { user_name: "Mochi Bun" });
    sockets[0].say(first);
    sockets[0].say(first); // the same message again
    sockets[0].say(notice("Croaker"));
    sockets[0].say({ metadata: { message_id: "k1", message_type: "session_keepalive" }, payload: {} });
    sockets[0].say({ metadata: { message_id: "o1", message_type: "notification" }, payload: { subscription: { type: "channel.subscribe" }, event: { user_login: "someone" } } });
    sockets[0].onmessage({ data: "{ not json" });
    assert.deepEqual(follows.map((f) => [f.user, f.name]), [["mochi_bun", "Mochi Bun"], ["croaker", "Croaker"]]);
    assert.match(follows[0].id, /^7-2026-10-13T10:00:00Z$/);
  } finally { done(watcher); }
});

test("a connection that goes quiet is replaced, with a longer wait each time, and it resubscribes", async () => {
  const { watcher, calls, sockets, states } = watching();
  try {
    sockets[0].say(welcome("s1", 10));
    await flush();
    mock.timers.tick(14000); // keepalive is 10 seconds: up to 15 is fine
    assert.equal(sockets.length, 1);
    mock.timers.tick(7000);
    assert.equal(states.at(-1), "reconnecting");
    assert.equal(sockets[0].closed, true);
    mock.timers.tick(1500); // the first wait is about a second
    assert.equal(sockets.length, 2);
    sockets[1].say(welcome("s2"));
    await flush();
    assert.equal(calls.length, 2, "a new connection asks for the notifications again");
    assert.equal(JSON.parse(calls[1].options.body).transport.session_id, "s2");
    assert.equal(states.at(-1), "listening");
    sockets[1].hangUp(); // Twitch closes it
    assert.equal(states.at(-1), "reconnecting");
    mock.timers.tick(5000);
    assert.equal(sockets.length, 3);
  } finally { done(watcher); }
});

test("when Twitch says to move to another address, the new connection takes over without asking again and no follow is lost", async () => {
  const { watcher, calls, follows, sockets } = watching();
  try {
    sockets[0].say(welcome("s1"));
    await flush();
    sockets[0].say({ metadata: { message_id: "r1", message_type: "session_reconnect" }, payload: { session: { reconnect_url: "wss://eventsub.example.test/ws?x=1" } } });
    assert.equal(sockets.length, 2);
    assert.equal(sockets[1].url, "wss://eventsub.example.test/ws?x=1");
    sockets[0].say(notice("StillOnOld")); // the old one still delivers until the new one is ready
    sockets[1].say(welcome("s1"));
    await flush();
    assert.equal(sockets[0].closed, true, "the old connection is let go once the new one is ready");
    assert.equal(calls.length, 1, "the notifications carry over: no new subscription");
    sockets[1].say(notice("OnNew"));
    assert.deepEqual(follows.map((f) => f.user), ["stillonold", "onnew"]);
    sockets[0].hangUp();
    assert.equal(sockets.length, 2, "the old one closing is not a loss");
  } finally { done(watcher); }
});

test("a login that has ended or is not allowed to see followers stops the listener and says to log in again", async () => {
  for (const [status, words] of [[401, /login has ended/], [403, /does not allow seeing followers/]]) {
    const { watcher, sockets, states } = watching([status]);
    try {
      sockets[0].say(welcome("s"));
      await flush();
      assert.equal(states.at(-1), "expired", String(status));
      assert.equal(sockets[0].closed, true);
      mock.timers.tick(60000);
      assert.equal(sockets.length, 1, "it does not keep trying with a login that cannot work");
      void words;
    } finally { done(watcher); }
  }
  const { watcher, sockets, states } = watching();
  try {
    sockets[0].say(welcome("s"));
    await flush();
    sockets[0].say({ metadata: { message_id: "rv", message_type: "revocation" }, payload: { subscription: { type: "channel.follow" } } });
    assert.equal(states.at(-1), "expired");
  } finally { done(watcher); }
});

test("a subscribe that fails for another reason is tried again, and stop() ends everything", async () => {
  const { watcher, sockets, states } = watching([500]);
  try {
    sockets[0].say(welcome("s"));
    await flush();
    assert.equal(states.at(-1), "reconnecting");
    mock.timers.tick(2000);
    assert.equal(sockets.length, 2);
    watcher.stop();
    assert.equal(states.at(-1), "stopped");
    assert.equal(sockets[1].closed, true);
    mock.timers.tick(120000);
    assert.equal(sockets.length, 2, "nothing opens after stop");
  } finally { mock.timers.reset(); }
});
