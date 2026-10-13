// Twitch follows, the streamer's side. Twitch tells only a logged-in streamer who follows them, so this does the two parts that need the login:
//   1. logging in from the browser (Twitch's "implicit" login for apps that have no server: the token comes back in the address after a #,
//      and no secret is involved), asking only to see who follows the person's own channel;
//   2. listening to Twitch's live notifications (EventSub over a WebSocket) for new followers, and coming back by itself if it drops.
// The login is kept in this browser only. Every part that touches the network, the clock or storage is handed in, so it is tested without Twitch.

export const AUTHORIZE = "https://id.twitch.tv/oauth2/authorize";
export const VALIDATE = "https://id.twitch.tv/oauth2/validate";
export const HELIX = "https://api.twitch.tv/helix";
export const EVENTSUB = "wss://eventsub.wss.twitch.tv/ws";
export const SCOPE = "moderator:read:followers"; // see who follows my channel: nothing else
export const REDIRECT_PATH = "/twitch/callback/";
const STORE = "frills:twitch:login";
const STATE_KEY = "frills:twitch:state";

const randomText = (length, random = (bytes) => globalThis.crypto.getRandomValues(bytes)) => {
  const bytes = new Uint8Array(length);
  random(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, length);
};

/** The address to send the person to, to log in to Twitch. `state` is a random text that must come back unchanged. */
export function authorizeUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "token", scope: SCOPE, state });
  return `${AUTHORIZE}?${params}`;
}

/** Starts a login: remembers a fresh random state (for this tab only) and returns the address to go to. */
export function beginLogin({ clientId, redirectUri, storage = globalThis.sessionStorage, random } = {}) {
  const state = randomText(24, random);
  try { storage.setItem(STATE_KEY, state); } catch { /* without it the login cannot be checked, and is refused when it comes back */ }
  return authorizeUrl({ clientId, redirectUri, state });
}

/**
 * What Twitch sent back, from the part of the address after the # (the token) or after the ? (an error, such as the person saying no).
 * The state must be the one we made. Returns { token } or { error } in words a person can read.
 */
export function finishLogin(hash, search, { storage = globalThis.sessionStorage } = {}) {
  const fromHash = new URLSearchParams(String(hash ?? "").replace(/^#/, ""));
  const fromQuery = new URLSearchParams(String(search ?? "").replace(/^\?/, ""));
  const get = (name) => fromHash.get(name) ?? fromQuery.get(name);
  let expected = "";
  try { expected = storage.getItem(STATE_KEY) ?? ""; storage.removeItem(STATE_KEY); } catch { /* nothing was kept */ }
  if (get("error")) return { error: get("error") === "access_denied" ? "You said no on Twitch, so nothing was connected." : `Twitch said: ${String(get("error_description") ?? get("error")).slice(0, 120)}` };
  if (!expected || get("state") !== expected) return { error: "That login did not come from this page, so it was ignored. Try again from the beginning." };
  const token = get("access_token");
  if (!token || !/^[A-Za-z0-9]{10,100}$/.test(token)) return { error: "Twitch did not send a login." };
  return { token };
}

/** Asks Twitch who a token belongs to and what it may do. Returns { login, userId, clientId, scopes, expiresIn } or { error, expired }. */
export async function validate(token, { fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
  try {
    const res = await fetchImpl(VALIDATE, { headers: { Authorization: `OAuth ${token}` } });
    if (res.status === 401) return { error: "The Twitch login has ended. Log in again.", expired: true };
    if (!res.ok) return { error: `Twitch could not check the login (${res.status}).` };
    const data = await res.json();
    return { login: String(data.login ?? ""), userId: String(data.user_id ?? ""), clientId: String(data.client_id ?? ""), scopes: Array.isArray(data.scopes) ? data.scopes : [], expiresIn: Number(data.expires_in) || 0 };
  } catch {
    return { error: "Could not reach Twitch. Check your connection." };
  }
}

/** The login kept in this browser, or null. */
export function loadLogin(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage.getItem(STORE) ?? "null");
    return saved && typeof saved.token === "string" && /^[A-Za-z0-9]{10,100}$/.test(saved.token) ? saved : null;
  } catch {
    return null;
  }
}
export function saveLogin(login, storage = globalThis.localStorage) {
  try { storage.setItem(STORE, JSON.stringify(login)); } catch { /* storage can be blocked: the login lasts until this tab closes */ }
}
export function clearLogin(storage = globalThis.localStorage) {
  try { storage.removeItem(STORE); } catch { /* nothing to forget */ }
}

/**
 * Listens for new followers of the person's own channel. `onFollow({ id, user, name })` is called once for each. `onStatus({ state, detail })`:
 * connecting, listening, reconnecting, expired (the login has ended: log in again), error, stopped. Comes back by itself with growing waits,
 * follows Twitch's own "move to this address" request without missing anything, and replaces a connection that has gone silent.
 */
export class FollowWatcher {
  constructor({ token, clientId, userId, fetchImpl = globalThis.fetch?.bind(globalThis), socketFactory = (url) => new WebSocket(url), onFollow, onStatus, now = () => Date.now(), timers = globalThis, endpoint = EVENTSUB } = {}) {
    Object.assign(this, { token, clientId, userId, fetchImpl, socketFactory, onFollow, onStatus, now, timers, endpoint });
    this.socket = null;
    this.stopped = false;
    this.attempt = 0;
    this.retry = 0;
    this.watch = 0;
    this.heard = 0;
    this.quiet = 35; // seconds of silence that mean the connection is dead; Twitch says its own number in the welcome
    this.seen = new Set(); // Twitch's message ids, because it can send a message twice
  }

  say(state, detail = "") { this.onStatus?.({ state, detail }); }

  start() {
    this.stopped = false;
    this.say("connecting");
    this.open(this.endpoint, true);
    this.watch = this.timers.setInterval(() => {
      if (!this.stopped && this.socket && this.now() - this.heard > (this.quiet + 5) * 1000) this.lost("The connection to Twitch went quiet.");
    }, 5000);
  }

  stop() {
    this.stopped = true;
    this.timers.clearTimeout(this.retry);
    this.timers.clearInterval(this.watch);
    this.drop(this.socket);
    this.socket = null;
    this.say("stopped");
  }

  drop(socket) {
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    try { socket.close(); } catch { /* already closed */ }
  }

  /** Opens a connection. `fresh` is true for a new one (which has to ask for the follow notifications) and false when Twitch asked us to move. */
  open(url, fresh) {
    let socket;
    try { socket = this.socketFactory(url); } catch { this.lost("Could not open the connection to Twitch."); return; }
    const mine = socket;
    this.heard = this.now();
    mine.onmessage = (event) => {
      if (this.stopped) return;
      this.heard = this.now();
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      this.handle(message, mine, fresh);
    };
    mine.onclose = () => { if (!this.stopped && mine === this.socket) this.lost("The connection to Twitch closed."); };
    mine.onerror = () => {}; // a close follows
    if (fresh) this.socket = mine;
    else this.pending = mine;
  }

  async handle(message, from, fresh) {
    const type = message?.metadata?.message_type;
    const id = message?.metadata?.message_id;
    if (id) {
      if (this.seen.has(id)) return;
      this.seen.add(id);
      if (this.seen.size > 200) this.seen.delete(this.seen.values().next().value);
    }
    if (type === "session_welcome") {
      const seconds = Number(message.payload?.session?.keepalive_timeout_seconds);
      if (seconds > 0) this.quiet = seconds;
      if (!fresh) { // Twitch moved us: the notifications carry over, so only the connection is swapped
        const old = this.socket;
        this.socket = from;
        this.pending = null;
        this.drop(old);
        this.say("listening");
        return;
      }
      await this.subscribe(message.payload?.session?.id);
    } else if (type === "session_reconnect") {
      const url = message.payload?.session?.reconnect_url;
      if (typeof url === "string" && url.startsWith("wss://")) this.open(url, false);
    } else if (type === "notification") {
      const event = message.payload?.event;
      if (message.payload?.subscription?.type === "channel.follow" && event?.user_login) {
        this.onFollow?.({ id: `${event.user_id}-${event.followed_at}`, user: String(event.user_login).toLowerCase(), name: String(event.user_name || event.user_login) });
      }
    } else if (type === "revocation") {
      this.stopped = true;
      this.drop(this.socket);
      this.socket = null;
      this.timers.clearInterval(this.watch);
      this.say("expired", "Twitch ended the follow notifications (the login ended). Log in again.");
    }
  }

  async subscribe(sessionId) {
    if (!sessionId) return this.lost("Twitch did not give a session.");
    let res;
    try {
      res = await this.fetchImpl(`${HELIX}/eventsub/subscriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Client-Id": this.clientId, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "channel.follow", version: "2", condition: { broadcaster_user_id: this.userId, moderator_user_id: this.userId }, transport: { method: "websocket", session_id: sessionId } }),
      });
    } catch {
      return this.lost("Could not reach Twitch to ask for follow notifications.");
    }
    if (this.stopped) return undefined;
    if (res.status === 202 || res.status === 200) {
      this.attempt = 0;
      this.say("listening");
    } else if (res.status === 401) {
      this.expire("The Twitch login has ended. Log in again.");
    } else if (res.status === 403) {
      this.expire("The Twitch login does not allow seeing followers. Log in again and say yes to that.");
    } else {
      this.lost(`Twitch would not start the follow notifications (${res.status}).`);
    }
    return undefined;
  }

  expire(detail) {
    this.stopped = true;
    this.timers.clearInterval(this.watch);
    this.timers.clearTimeout(this.retry);
    this.drop(this.socket);
    this.socket = null;
    this.say("expired", detail);
  }

  /** The connection is gone: say so, wait a little longer each time, and start a new one. */
  lost(detail) {
    if (this.stopped) return;
    this.drop(this.socket);
    this.drop(this.pending);
    this.socket = null;
    this.pending = null;
    this.say("reconnecting", detail);
    const wait = Math.min(30000, 1000 * 2 ** Math.min(this.attempt, 5)) * (0.8 + Math.random() * 0.4);
    this.attempt += 1;
    this.timers.clearTimeout(this.retry);
    this.retry = this.timers.setTimeout(() => { if (!this.stopped) this.open(this.endpoint, true); }, wait);
  }
}
