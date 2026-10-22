// The two ends of "what is playing on Spotify, on my stream": the private /spotify/ tab puts the song in the post box (worker/nowplaying.mjs)
// and the Song requests overlay reads it from there. Only the song's title, artist, cover and position travel; the Spotify login stays in
// the tab's browser. The fetch, the storage and the clock are given in, so both ends are tested without a server.

export const CODE = /^[A-Za-z0-9_-]{16}$/;
const STORE = "frills:spotify:bridge";
const BOX = "/api/nowplaying/";

/** A valid code, or "" (a made-up or damaged one is ignored). */
export const validCode = (value) => (typeof value === "string" && CODE.test(value) ? value : "");

const randomId = (length, random = (bytes) => globalThis.crypto.getRandomValues(bytes)) => {
  const bytes = new Uint8Array(length);
  random(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, length);
};

/** The code (goes in the overlay link) and the key (stays in this browser), made once and kept. */
export function bridgeIdentity(storage = globalThis.localStorage, random) {
  try {
    const saved = JSON.parse(storage.getItem(STORE) ?? "null");
    if (saved && CODE.test(saved.code) && /^[A-Za-z0-9_-]{16,64}$/.test(saved.key)) return saved;
  } catch { /* nothing usable was kept */ }
  const made = { code: randomId(16, random), key: randomId(32, random) };
  try { storage.setItem(STORE, JSON.stringify(made)); } catch { /* storage can be blocked: the code works until the tab closes */ }
  return made;
}

/** The code to put in the overlay link, when this browser is sharing what is playing (turned on in the Spotify step), else "". */
export function sharedCode(storage = globalThis.localStorage) {
  try {
    if (storage.getItem("frills:spotify:sharing") !== "1") return "";
    const saved = JSON.parse(storage.getItem(STORE) ?? "null");
    return saved && CODE.test(saved.code) ? saved.code : "";
  } catch {
    return "";
  }
}

/**
 * The tab's end. `send(now)` is called with each reading of what is playing ({ playing, title, artist, cover, progressMs, durationMs } or
 * null for nothing) and puts it in the post box only when something changed: a new song, play or pause, a jump in the position, or every
 * 20 seconds so the overlay knows the tab is still there. Returns whether it sent.
 */
export class Publisher {
  constructor({ code, key, fetchImpl = globalThis.fetch?.bind(globalThis), now = () => Date.now(), heartbeatMs = 20000, onError = () => {} } = {}) {
    this.code = code;
    this.key = key;
    this.fetch = fetchImpl;
    this.now = now;
    this.heartbeatMs = heartbeatMs;
    this.onError = onError;
    this.sent = null; // { song, at, playing, progressMs }
  }

  changed(song) {
    const last = this.sent;
    const at = this.now();
    if (!last) return true;
    if (at - last.at >= this.heartbeatMs) return true;
    if ((song?.title ?? "") !== (last.song?.title ?? "") || (song?.artist ?? "") !== (last.song?.artist ?? "")) return true;
    if ((song?.playing === true) !== (last.song?.playing === true)) return true;
    const expected = last.song?.playing ? last.song.progressMs + (at - last.at) : last.song?.progressMs ?? 0;
    return Math.abs((song?.progressMs ?? 0) - expected) > 2500; // someone skipped ahead or back
  }

  async send(song) {
    if (!this.changed(song)) return false;
    const body = { playing: song?.playing === true, title: song?.title ?? "", artist: song?.artist ?? "", cover: song?.cover ?? "", progressMs: song?.progressMs ?? 0, durationMs: song?.durationMs ?? 0 };
    try {
      const res = await this.fetch(BOX + this.code, { method: "PUT", headers: { "content-type": "application/json", "x-key": this.key }, body: JSON.stringify(body) });
      if (res.status === 429) return false; // too soon after the last one; the next reading tries again
      if (!res.ok) { this.onError(res.status); return false; }
    } catch {
      this.onError(0);
      return false;
    }
    this.sent = { song: body, at: this.now() };
    return true;
  }
}

/**
 * The overlay's end: asks the post box every few seconds and calls `onSong(song)` with { playing, title, artist, cover, durationMs,
 * progressMs, at } where `progressMs` is where the song is right now (counted forward from the reading when it is playing), or null when
 * nothing has been posted lately (the tab was closed). `at` is this page's clock, so the position can be drawn from it.
 */
export function watchSpotify(code, onSong, { fetchImpl = globalThis.fetch?.bind(globalThis), now = () => Date.now(), everyMs = 2500, staleMs = 90000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let stopped = false;
  let timer = 0;
  const poll = async () => {
    if (stopped) return;
    let song = null;
    try {
      const res = await fetchImpl(BOX + code, { cache: "no-store" });
      const body = res.ok ? await res.json() : null;
      if (body?.ok && body.data && body.now - body.updatedAt < staleMs) {
        const d = body.data;
        const since = Math.max(0, body.now - body.updatedAt); // the post box's own clock on both, so the two computers' clocks never matter
        song = { ...d, progressMs: Math.min(d.durationMs || Infinity, d.progressMs + (d.playing ? since : 0)), at: now() };
      }
    } catch { song = null; }
    if (!stopped) onSong(song);
    if (!stopped) timer = setTimer(poll, everyMs);
  };
  poll();
  return { stop() { stopped = true; clearTimer(timer); } };
}

/**
 * A clock that is not slowed down in a background tab: a worker (its address is the site's own ticker script) calls `fn` every `every` ms. If
 * workers are not allowed the page's own timer does it instead. Returns { stop() }.
 */
export function startClock(url, fn, every) {
  try {
    const worker = new Worker(url);
    worker.onmessage = fn;
    worker.postMessage({ every });
    return { stop: () => worker.terminate() };
  } catch {
    const id = setInterval(fn, every);
    return { stop: () => clearInterval(id) };
  }
}

// Where Spotify's login sends the person back to: the page they pressed "Log in" on. Only these two addresses are ever used (never one read from
// the address bar), so the callback page cannot be turned into a redirect to somewhere else.
const RETURN = "frills:spotify:return";
export const RETURN_PATHS = ["/songs/", "/spotify/"];

export function rememberReturn(path, storage = globalThis.sessionStorage) {
  try { if (RETURN_PATHS.includes(path)) storage.setItem(RETURN, path); } catch { /* storage can be blocked: the person lands on the test page instead */ }
}

/** The page to go back to after the login, once: the remembered one when it is allowed, else the test page. */
export function takeReturn(storage = globalThis.sessionStorage) {
  try {
    const path = storage.getItem(RETURN);
    storage.removeItem(RETURN);
    return RETURN_PATHS.includes(path) ? path : "/spotify/";
  } catch {
    return "/spotify/";
  }
}
