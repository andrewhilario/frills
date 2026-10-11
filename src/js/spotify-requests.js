// Song requests from chat, into the streamer's own Spotify queue (the private test for it). A viewer types "!sr song name"; the first
// matching song on Spotify goes to the end of the queue; "!next" from the streamer (or a moderator) skips. With `real` off nothing is sent
// to Spotify's queue: it only says what would have been added, so it can be tried safely (for example with the practice account).
// The client, the clock and the log are given in, so this is tested without Spotify or a LIVE.

import { SONGS, parseCommand } from "./songs.js";

const FORGET_AFTER = 10 * 60 * 1000;

export class SpotifyRequests {
  constructor(client, { channel = "", real = false, now = () => Date.now(), cooldownMs = 15000, settings = SONGS.defaults, onLog = () => {} } = {}) {
    this.client = client;
    this.channel = channel;
    this.real = real;
    this.now = now;
    this.cooldownMs = cooldownMs;
    this.settings = settings;
    this.onLog = onLog;
    this.lastBy = new Map(); // person -> when they last asked
    this.recent = new Map(); // song -> when it was queued, so one song is not queued twice in a row
    this.heard = new Set(); // message ids already handled
  }

  log(state, text) {
    const entry = { state, text, at: this.now() };
    this.onLog(entry);
    return entry;
  }

  /** One chat message ({ id, user, name, text, mod, host, login }). Returns the log entry it made, or null when it was not a command. */
  async handle(message) {
    const command = parseCommand(message?.text, this.settings);
    if (!command) return null;
    if (message.id) {
      if (this.heard.has(message.id)) return null;
      this.heard.add(message.id);
      if (this.heard.size > 300) this.heard.delete(this.heard.values().next().value);
    }
    const who = message.name || "viewer";
    if (command.kind === "next") return this.skip(message, who);
    if (command.kind !== "request") return null; // !wrongsong is for the on-screen queue; Spotify's queue cannot take one back
    const key = message.user || who;
    const since = this.now() - (this.lastBy.get(key) ?? -Infinity);
    if (since < this.cooldownMs) return this.log("info", `${who} asked again too soon, so it was ignored.`);
    this.lastBy.set(key, this.now());
    const found = await this.client.search(command.query);
    if (found.error) return this.log("error", `${who} asked for “${command.query}”: ${found.error}`);
    const song = found.results[0];
    if (!song) return this.log("info", `${who} asked for “${command.query}”: Spotify found nothing.`);
    for (const [uri, at] of this.recent) if (this.now() - at > FORGET_AFTER) this.recent.delete(uri);
    if (this.recent.has(song.uri)) return this.log("info", `${who} asked for “${song.title}”: it was queued a moment ago.`);
    const label = `“${song.title}” · ${song.artist}`;
    if (!this.real) { this.recent.set(song.uri, this.now()); return this.log("ok", `${who} asked for ${label}. (Practice: not added to your queue.)`); }
    const added = await this.client.addToQueue(song.uri);
    if (added.error) return this.log("error", `${who} asked for ${label}: ${added.error}`);
    this.recent.set(song.uri, this.now());
    return this.log("ok", `${who}: ${label} was added to your Spotify queue.`);
  }

  async skip(message, who) {
    const streamer = message.host === true || (this.channel && String(message.login ?? "").toLowerCase() === this.channel.toLowerCase());
    if (!(streamer || (this.settings.modsSkip && message.mod === true))) return this.log("info", `${who} tried !next, which only you and your moderators can use.`);
    if (!this.real) return this.log("ok", `${who} used !next. (Practice: nothing was skipped.)`);
    const skipped = await this.client.skip();
    return skipped.error ? this.log("error", `!next: ${skipped.error}`) : this.log("ok", `${who} used !next: skipped to the next song.`);
  }
}
