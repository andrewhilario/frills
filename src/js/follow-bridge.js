// The two ends of "Twitch follows, on my stream": the private /twitch/ tab puts each new follower in the post box (worker/follows.mjs) and the
// alerts overlay reads them from there. Only a follower's name travels; the Twitch login stays in the tab's browser. The fetch, the storage,
// the clock and the timers are given in, so both ends are tested without a server.

export const CODE = /^[A-Za-z0-9_-]{16}$/;
const KEY = /^[A-Za-z0-9_-]{16,64}$/;
const STORE = "frills:twitch:bridge";
const SHARING = "frills:twitch:follows";
const BOX = "/api/follows/";

/** A valid code, or "" (a made-up or damaged one is ignored). */
export const validCode = (value) => (typeof value === "string" && CODE.test(value) ? value : "");

const randomId = (length, random = (bytes) => globalThis.crypto.getRandomValues(bytes)) => {
  const bytes = new Uint8Array(length);
  random(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, length);
};

/** The code (goes in the overlay link) and the key (stays in this browser), made once and kept. */
export function followIdentity(storage = globalThis.localStorage, random) {
  try {
    const saved = JSON.parse(storage.getItem(STORE) ?? "null");
    if (saved && CODE.test(saved.code) && KEY.test(saved.key)) return saved;
  } catch { /* nothing usable was kept */ }
  const made = { code: randomId(16, random), key: randomId(32, random) };
  try { storage.setItem(STORE, JSON.stringify(made)); } catch { /* storage can be blocked: the code works until the tab closes */ }
  return made;
}

/** Whether this browser is set to put its follows in the alerts link (turned on in the alerts editor). */
export function followsOn(storage = globalThis.localStorage) {
  try { return storage.getItem(SHARING) === "1"; } catch { return false; }
}
export function setFollowsOn(on, storage = globalThis.localStorage) {
  try { storage.setItem(SHARING, on ? "1" : "0"); } catch { /* the choice lasts until this tab closes */ }
}

/**
 * The tab's end. `send(follow)` puts a follower ({ id, user, name }) in the post box; one that could not be sent (no connection, or the
 * server too busy for a moment) is kept and tried again with the next call, up to 20 of them. `ping()` says "this tab is still here", so the
 * alerts editor can tell whether anything is listening. Returns whether the call reached the box.
 */
export class FollowPublisher {
  constructor({ code, key, fetchImpl = globalThis.fetch?.bind(globalThis), onError = () => {} } = {}) {
    this.code = code;
    this.key = key;
    this.fetch = fetchImpl;
    this.onError = onError;
    this.waiting = [];
  }

  async post(body) {
    try {
      const res = await this.fetch(BOX + this.code, { method: "POST", headers: { "content-type": "application/json", "x-key": this.key }, body: JSON.stringify(body) });
      if (res.ok) return true;
      this.onError(res.status);
      return res.status === 400; // a follow the server refuses is not worth trying again
    } catch {
      this.onError(0);
      return false;
    }
  }

  /** Tries every follow that is waiting, oldest first, and stops at the first one that still cannot be sent. */
  async flush() {
    while (this.waiting.length) {
      if (!(await this.post(this.waiting[0]))) return false;
      this.waiting.shift();
    }
    return true;
  }

  async send(follow) {
    this.waiting.push({ id: follow.id, user: follow.user, name: follow.name });
    if (this.waiting.length > 20) this.waiting.shift();
    return this.flush();
  }

  async ping() {
    if (this.waiting.length && !(await this.flush())) return false;
    return this.post({ ping: true });
  }
}

/**
 * The overlay's end: asks the post box every few seconds whether there is anything after the number it knows, and calls `onFollow` once for
 * each new follower. The first answer only says where the line is now, so a page that loads never replays follows from before.
 * `onState({ alive })` says whether the tab has been seen lately (it posts "still here" about every 30 seconds).
 */
export class FollowReader {
  constructor({ code, fetchImpl = globalThis.fetch?.bind(globalThis), onFollow, onState, timers = globalThis, everyMs = 5000 } = {}) {
    Object.assign(this, { code, fetch: fetchImpl, onFollow, onState, timers, everyMs });
    this.after = null; // the number of the last follow seen; null until the first answer
    this.timer = 0;
    this.stopped = false;
    this.busy = false;
  }

  start() {
    this.stopped = false;
    this.tick();
    this.timer = this.timers.setInterval(() => this.tick(), this.everyMs);
    return this;
  }

  stop() {
    this.stopped = true;
    this.timers.clearInterval(this.timer);
  }

  async tick() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      const res = await this.fetch(`${BOX}${this.code}${this.after === null ? "" : `?after=${this.after}`}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (this.stopped) return;
      this.onState?.({ alive: data.updatedAt > 0 && data.now - data.updatedAt < 180000 });
      if (this.after === null) { this.after = Number(data.seq) || 0; return; }
      for (const item of Array.isArray(data.items) ? data.items : []) {
        if (!(item.seq > this.after)) continue;
        this.after = item.seq;
        this.onFollow?.({ id: String(item.id), user: String(item.user ?? ""), name: String(item.name) });
      }
    } catch { /* no answer this time: the next one asks again from the same number */ } finally {
      this.busy = false;
    }
  }
}
