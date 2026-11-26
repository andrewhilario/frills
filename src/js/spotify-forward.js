// The Song requests overlay's part in "the Spotify player works with the Frills page closed". The overlay is open in the streaming app anyway and
// already reads the LIVE chat; when it has a Spotify code (the streamer connected Spotify in the editor), it passes each !sr and !next on to
// Frills' Worker (worker/spotify.mjs), which holds the streamer's Spotify login: it finds the song on Spotify and adds it to the streamer's queue,
// or skips. Whether anything is added at all is the streamer's switch in the editor, kept by the Worker, so the overlay passes every one on.
//
// The same rules the editor's older in-page version had (spotify-requests.js): a person's !sr again within 15 seconds is ignored, and !next only from
// the streamer's own account or, when that is allowed, a moderator. The Worker adds its own limits, so the overlay's link alone cannot flood a queue.
// The fetch and the clock are given in, so this is tested without a server or a LIVE.

import { SONGS, parseCommand } from "./songs.js";

const BASE = "/api/spotify/";

export class SpotifyForward {
  constructor({ code, channel = "", settings = SONGS.defaults, fetchImpl = globalThis.fetch?.bind(globalThis), now = () => Date.now(), cooldownMs = 15000, wait = (ms) => new Promise((r) => setTimeout(r, ms)), retries = 3 } = {}) {
    this.code = code;
    this.channel = channel;
    this.settings = settings;
    this.fetch = fetchImpl;
    this.now = now;
    this.cooldownMs = cooldownMs;
    this.wait = wait;
    this.retries = retries;
    this.lastBy = new Map(); // person -> when they last asked
    this.heard = new Set(); // message ids already passed on
    this.line = Promise.resolve(); // requests go one after another: Frills takes one every 2 seconds per streamer
  }

  /** One call to Frills. Resolves to { sent, data }: whether Frills answered, and what it said. */
  async send(action, body) {
    try {
      const res = await this.fetch(`${BASE}${this.code}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json?.().catch(() => null) ?? null;
      return { sent: true, status: res.status ?? 200, data, retryAfter: Number(res.headers?.get?.("retry-after")) || 0 };
    } catch {
      return { sent: false, status: 0, data: null, retryAfter: 0 };
    }
  }

  /**
   * Passes one !sr or !next on, after the ones before it. When two viewers ask within 2 seconds Frills says "too fast": this one waits its turn
   * and tries again (a few times), instead of being lost.
   */
  post(action, body) {
    const run = async () => {
      let got = await this.send(action, body);
      for (let i = 0; i < this.retries && got.status === 429 && got.data?.error === "too_fast"; i++) {
        await this.wait(Math.min(5, Math.max(2, got.retryAfter || 2)) * 1000);
        got = await this.send(action, body);
      }
      return got;
    };
    const done = this.line.then(run, run);
    this.line = done.catch(() => {});
    return done;
  }

  /** Says the overlay is open (the editor shows it). Resolves to whether Frills heard. */
  hello() { return this.send("hello", {}).then((got) => got.sent); }

  /**
   * One chat message ({ id, user, name, text, mod, host, login }). Resolves to "sent" or, when it was not passed on, why not.
   * `onAnswer(data)` is told what Frills said about a !sr (for example the song Spotify queued, or that it found nothing), so the overlay can
   * keep its own list right.
   */
  async handle(message, onAnswer) {
    const command = parseCommand(message?.text, this.settings);
    if (!command) return "not a command";
    if (message.id) {
      if (this.heard.has(message.id)) return "repeat";
      this.heard.add(message.id);
      if (this.heard.size > 300) this.heard.delete(this.heard.values().next().value);
    }
    const name = message.name || "viewer";
    if (command.kind === "next") {
      const streamer = message.host === true || (this.channel && String(message.login ?? "").toLowerCase() === this.channel.toLowerCase());
      if (!(streamer || (this.settings.modsSkip && message.mod === true))) return "not allowed";
      return (await this.post("next", { name })).sent ? "sent" : "failed";
    }
    if (command.kind !== "request") return "not for Spotify"; // !wrongsong is for the on-screen queue; Spotify's queue cannot take one back
    const key = message.user || name;
    if (this.now() - (this.lastBy.get(key) ?? -Infinity) < this.cooldownMs) return "too soon";
    this.lastBy.set(key, this.now());
    if (this.lastBy.size > 500) this.lastBy.delete(this.lastBy.keys().next().value);
    const got = await this.post("request", { query: command.query, name });
    if (got.sent) { try { onAnswer?.({ ...(got.data ?? {}), status: got.status }); } catch { /* the overlay's own list is not this one's business */ } }
    return got.sent ? "sent" : "failed";
  }
}
