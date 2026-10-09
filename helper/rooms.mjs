// One Room per TikTok account being watched: it holds the single connection to TikTok, hands every event to all the pages that are
// listening, and keeps trying again by itself (the account may not be live yet, TikTok may drop us, the free connection may be busy).
// The Hub keeps the rooms, so two pages watching the same account (the editor's preview and OBS) share one connection.

import { mapChat, mapDelete, mapGift } from "./map.mjs";

/** What went wrong when connecting, in the three ways that need different handling. */
export function classify(err) {
  // The class name is what the library sets; our own errors set `name` on a plain Error. Either may be the one that says what it is.
  const names = [err?.constructor?.name, err?.name].map(String);
  const is = (name) => names.includes(name);
  const message = String(err?.message ?? err ?? "");
  if (is("SetupError")) return { kind: "fatal", detail: message };
  if (is("UserOfflineError")) return { kind: "offline" };
  if (is("InvalidUniqueIdError")) return { kind: "fatal", detail: "TikTok doesn't know that name. Check the spelling." };
  if (names.some((n) => /RateLimit/i.test(n)) || /\b429\b|rate.?limit/i.test(message) || err?.response?.statusCode === 429) return { kind: "limited" };
  if (is("PremiumFeatureError")) return { kind: "fatal", detail: "TikTok's free connection doesn't allow that." };
  return { kind: "failed", detail: "Couldn't reach TikTok. Trying again…" };
}

export class Room {
  constructor(user, hub) {
    this.user = user;
    this.hub = hub;
    this.clients = new Set();
    this.status = { state: "connecting", detail: "", fatal: false };
    this.conn = null;
    this.running = false;
    this.stopped = false;
    this.idleTimer = 0;
    this.sleeper = null;
    this.seen = new Set(); // ids of the latest messages, so a message is never shown twice
    this.counts = { chat: 0, gift: 0 };
    this.report = 0;
  }

  add(client) {
    clearTimeout(this.idleTimer);
    this.clients.add(client);
    client.send("status", this.status);
    if (!this.running) this.start();
  }

  remove(client) {
    this.clients.delete(client);
    if (!this.clients.size && !this.stopped) this.idleTimer = setTimeout(() => this.hub.drop(this), this.hub.opts.idleStopMs);
  }

  broadcast(event, data) {
    for (const client of [...this.clients]) {
      try {
        client.send(event, data);
      } catch {
        this.clients.delete(client); // that page went away mid-write; its own close handler tidies up the rest
      }
    }
  }

  setStatus(state, detail = "", fatal = false) {
    const now = this.status;
    if (state === now.state && detail === now.detail && fatal === now.fatal) return; // nothing new to tell anyone
    this.status = { state, detail, fatal };
    this.hub.log(`@${this.user}: ${state}${detail ? " (" + detail + ")" : ""}`);
    this.broadcast("status", this.status);
  }

  /** True the first time an id is seen. Messages without an id can't be told apart, so they always pass. */
  fresh(id) {
    if (!id) return true;
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    if (this.seen.size > 300) this.seen.delete(this.seen.values().next().value);
    return true;
  }

  wire(conn, finish) {
    conn.on("chat", (d) => {
      const m = mapChat(d);
      if (!m || !this.fresh(m.id)) return;
      this.counts.chat += 1;
      this.broadcast("chat", m);
    });
    conn.on("gift", (d) => {
      const m = mapGift(d);
      if (!m || !this.fresh(m.id)) return;
      this.counts.gift += 1;
      this.broadcast("chat", m);
    });
    conn.on("imDelete", (d) => {
      const { ids, users } = mapDelete(d);
      for (const id of ids) this.broadcast("remove", { id });
      for (const user of users) this.broadcast("clear", { user });
    });
    conn.on("streamEnd", () => finish({ kind: "offline", detail: "The LIVE ended. Waiting for the next one…", wasConnected: true }));
    conn.on("disconnected", () => finish({ kind: "dropped", wasConnected: true }));
    conn.on("error", (err) => this.hub.log(`@${this.user}: ${String(err?.constructor?.name ?? "error")} ${String(err?.message ?? "").slice(0, 120)}`));
  }

  /** One try: connect, then wait until the connection ends. Resolves with how it ended. */
  async once() {
    let conn;
    try {
      conn = await this.hub.opts.factory(this.user, { apiKey: this.hub.opts.apiKey });
    } catch (err) {
      return classify(err);
    }
    this.conn = conn;
    let finish;
    const ended = new Promise((resolve) => { finish = resolve; });
    this.wire(conn, finish);
    try {
      await conn.connect();
    } catch (err) {
      this.letGo(conn);
      return classify(err);
    }
    if (this.stopped) {
      this.letGo(conn);
      return { kind: "stopped" };
    }
    this.setStatus("connected", conn.pretend ? "Practice chat made up by Frills. Nothing comes from TikTok." : "");
    const how = await ended;
    this.letGo(conn);
    return how;
  }

  letGo(conn) {
    if (this.conn === conn) this.conn = null;
    try { conn.disconnect(); } catch { /* it was already closed */ }
  }

  sleep(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.sleeper = null; resolve(); }, ms);
      this.sleeper = () => { clearTimeout(timer); this.sleeper = null; resolve(); };
    });
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.hub.log(`@${this.user}: connecting`); // the pages are told by the status above; this is the line for the window you are watching
    this.report = setInterval(() => {
      if (this.counts.chat || this.counts.gift) this.hub.log(`@${this.user}: ${this.counts.chat} chat and ${this.counts.gift} gifts in the last minute`);
      this.counts = { chat: 0, gift: 0 };
    }, 60000);
    const { offlineWaitMs, limitedWaitMs, backoffMs } = this.hub.opts;
    let attempt = 0;
    let quiet = false; // while waiting for a LIVE to start, keep saying so instead of flickering to "connecting" at every look
    while (!this.stopped) {
      if (!quiet) this.setStatus(attempt === 0 ? "connecting" : "reconnecting");
      const how = await this.once();
      if (this.stopped || how.kind === "stopped") break;
      if (how.wasConnected) attempt = 0;
      quiet = how.kind === "offline" || how.kind === "limited";
      if (how.kind === "fatal") {
        this.setStatus("error", how.detail, true);
        break;
      } else if (how.kind === "offline") {
        this.setStatus("offline", how.detail ?? "");
        await this.sleep(offlineWaitMs);
      } else if (how.kind === "limited") {
        this.setStatus("limited");
        await this.sleep(limitedWaitMs);
      } else {
        if (how.kind === "failed") this.setStatus("error", how.detail);
        else this.setStatus("reconnecting");
        await this.sleep(backoffMs[Math.min(attempt, backoffMs.length - 1)]);
        attempt += 1;
      }
    }
    clearInterval(this.report);
    this.running = false;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.idleTimer);
    clearInterval(this.report);
    this.sleeper?.();
    if (this.conn) this.letGo(this.conn);
  }
}

/**
 * An account that is waiting for a free spot (the shared relay is full). It holds the pages that are listening, tells them their place
 * in line, and is turned into a real Room by the Hub when a spot opens.
 */
class Waiting {
  constructor(user, hub) {
    this.user = user;
    this.hub = hub;
    this.clients = new Set();
    this.leaveTimer = 0;
    this.room = null; // set when its turn comes
    this.status = { state: "queued", detail: "", fatal: false, position: 0, total: 0 };
  }

  add(client) {
    clearTimeout(this.leaveTimer);
    this.clients.add(client);
    client.send("status", this.status);
  }

  /**
   * A page left. If nobody is left, the place is kept for a short while (a page that reloads shouldn't lose its turn), then given up.
   * A page that was moved into a real Room when its turn came still holds this object, so it hands the leaving on to that Room.
   */
  remove(client) {
    if (this.room) {
      this.room.remove(client);
      return;
    }
    this.clients.delete(client);
    if (!this.clients.size) {
      this.leaveTimer = setTimeout(() => this.hub.giveUp(this), this.hub.opts.queueGraceMs);
    }
  }

  tell(position, total) {
    this.status = { state: "queued", detail: "", fatal: false, position, total };
    for (const client of [...this.clients]) {
      try {
        client.send("status", this.status);
      } catch {
        this.clients.delete(client);
      }
    }
  }
}

export class Hub {
  constructor(opts = {}) {
    this.opts = { factory: null, apiKey: "", maxRooms: 3, queue: false, queueGraceMs: 20000, idleStopMs: 30000, offlineWaitMs: 20000, limitedWaitMs: 60000, backoffMs: [3000, 6000, 12000, 30000, 60000], ...opts };
    this.log = opts.log ?? (() => {});
    this.rooms = new Map();
    this.waiting = new Map(); // accounts in line for a spot, oldest first
  }

  /** How full it is. Numbers only: no account names. */
  stats() {
    return { used: this.rooms.size, max: this.opts.maxRooms, waiting: this.waiting.size };
  }

  /**
   * Starts sending one account's events to `client` ({ send(event, data) }). Returns the room (or the place in line), or null when
   * there is no room and no line.
   */
  subscribe(user, client) {
    let room = this.rooms.get(user);
    if (!room) {
      if (this.rooms.size >= this.opts.maxRooms) {
        if (!this.opts.queue) {
          client.send("status", { state: "error", detail: `Frills is already watching ${this.opts.maxRooms} TikTok accounts. Close one first.`, fatal: true });
          return null;
        }
        let place = this.waiting.get(user);
        if (!place) {
          place = new Waiting(user, this);
          this.waiting.set(user, place);
          this.log(`a TikTok account is waiting for a spot (${this.waiting.size} in line)`);
        }
        place.add(client);
        this.tellLine();
        return place;
      }
      room = new Room(user, this);
      this.rooms.set(user, room);
    }
    room.add(client);
    return room;
  }

  /** Everyone in line hears their place. */
  tellLine() {
    let position = 0;
    for (const place of this.waiting.values()) place.tell(++position, this.waiting.size);
  }

  /** A place in line that nobody is listening to any more. */
  giveUp(place) {
    if (this.waiting.get(place.user) === place && !place.clients.size) {
      this.waiting.delete(place.user);
      this.tellLine();
    }
  }

  /** While there are free spots and people in line, the first in line gets one. */
  promote() {
    while (this.waiting.size && this.rooms.size < this.opts.maxRooms) {
      const [user, place] = this.waiting.entries().next().value;
      this.waiting.delete(user);
      clearTimeout(place.leaveTimer);
      if (!place.clients.size) continue; // nobody is there to be served
      const room = new Room(user, this);
      this.rooms.set(user, room);
      place.room = room;
      for (const client of [...place.clients]) room.add(client);
      this.log(`a waiting TikTok account got a spot (${this.waiting.size} still in line)`);
    }
    this.tellLine();
  }

  drop(room) {
    room.stop();
    if (this.rooms.get(room.user) === room) this.rooms.delete(room.user);
    this.promote();
  }

  closeAll() {
    for (const place of this.waiting.values()) clearTimeout(place.leaveTimer);
    this.waiting.clear();
    for (const room of [...this.rooms.values()]) this.drop(room);
  }
}
