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
  constructor({ code, channel = "", settings = SONGS.defaults, fetchImpl = globalThis.fetch?.bind(globalThis), now = () => Date.now(), cooldownMs = 15000 } = {}) {
    this.code = code;
    this.channel = channel;
    this.settings = settings;
    this.fetch = fetchImpl;
    this.now = now;
    this.cooldownMs = cooldownMs;
    this.lastBy = new Map(); // person -> when they last asked
    this.heard = new Set(); // message ids already passed on
  }

  post(action, body) {
    return this.fetch(`${BASE}${this.code}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(() => true, () => false);
  }

  /** One chat message ({ id, user, name, text, mod, host, login }). Resolves to "sent" or, when it was not passed on, why not. */
  async handle(message) {
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
      return (await this.post("next", { name })) ? "sent" : "failed";
    }
    if (command.kind !== "request") return "not for Spotify"; // !wrongsong is for the on-screen queue; Spotify's queue cannot take one back
    const key = message.user || name;
    if (this.now() - (this.lastBy.get(key) ?? -Infinity) < this.cooldownMs) return "too soon";
    this.lastBy.set(key, this.now());
    if (this.lastBy.size > 500) this.lastBy.delete(this.lastBy.keys().next().value);
    return (await this.post("request", { query: command.query, name })) ? "sent" : "failed";
  }
}
