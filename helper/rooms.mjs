// One Room per TikTok account being watched: it holds the single connection to TikTok, hands every event to all the pages that are
// listening, and keeps trying again by itself (the account may not be live yet, TikTok may drop us, the free connection may be busy).
// The Hub keeps the rooms, so two pages watching the same account (the editor's preview and OBS) share one connection.

import { mapChat, mapDelete, mapEmoteChat, mapFollow, mapGift, mapGiftAlert, mapLike, mapShare } from "./map.mjs";

/** Turns any TikTok / Euler / network error into a concise, safe, owner-readable reason string (never leaks keys). */
export function describeError(err) {
  const names = [err?.constructor?.name, err?.name].filter(Boolean);
  const name = names[0] || "Error";
  const clean = (raw) => String(raw ?? "")
    .replace(/https?:\/\/\S+/g, (u) => {
      try { const p = new URL(u); return `${p.origin}${p.pathname}`; } catch { return "[url]"; }
    })
    .replace(/\b(euler_[A-Za-z0-9_-]{8,}|api[_-]?key=[^&\s]+)/gi, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();

  // Unpack tiktok-live-connector's InvalidResponseCompositeError (stores sub-errors in err.config.requestErrs)
  const subErrs = Array.isArray(err?.config?.requestErrs) ? err.config.requestErrs : Array.isArray(err?.errors) ? err.errors : [];
  if (subErrs.length) {
    const parts = subErrs.slice(0, 3).map((sub) => {
      const m = clean(sub?.message ?? sub);
      if (/403\b|Forbidden/i.test(m)) return "TikTok API 403 (blocked)";
      if (/429\b|rate.?limit/i.test(m)) return "Rate limited (429)";
      if (/401\b|Unauthorized|permission/i.test(m)) return "Euler auth/permission (401/403)";
      if (/SIGI_STATE|captcha/i.test(m)) return "TikTok HTML blocked";
      if (/Failed to extract Room ID from Euler/i.test(m)) return "Euler: no active room";
      return m.slice(0, 60);
    });
    return `Room lookup failed: ${parts.join(" · ")}`.slice(0, 160);
  }

  const msg = clean(err?.message ?? err);
  const status = err?.response?.statusCode ?? err?.response?.status ?? (/\bstatus(?: code)?\s+(\d{3})\b/i.exec(msg)?.[1] ? Number(/\bstatus(?: code)?\s+(\d{3})\b/i.exec(msg)[1]) : 0);
  if (/SignAPIError/i.test(name)) {
    if (status === 401 || status === 403) return `Euler rejected API key (HTTP ${status}) — check EULER_API_KEY`;
    if (status >= 500) return `Euler sign server error (HTTP ${status})`;
    if (/Empty Cookies/i.test(msg) || /No cookies/i.test(msg)) return "Euler returned no TikTok session cookies";
    return `Euler sign error${status ? ` (HTTP ${status})` : ""}: ${msg.slice(0, 90)}`.slice(0, 160);
  }
  if (/ConnectTimeoutError/i.test(name)) return "Timed out connecting to TikTok WebSocket";
  if (/SignatureMissingTokensError/i.test(name)) return "Euler returned incomplete signature tokens";
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT/i.test(msg)) return `Network error: ${msg.slice(0, 110)}`;
  if (status === 401 || status === 403) return `Upstream rejected request (HTTP ${status})`;
  return (msg ? `${name !== "Error" ? `${name}: ` : ""}${msg}` : name).slice(0, 160);
}

/** What went wrong when connecting, in the ways that need different handling. */
export function classify(err) {
  // The class name is what the library sets; our own errors set `name` on a plain Error. Either may be the one that says what it is.
  const names = [err?.constructor?.name, err?.name].map(String);
  const is = (name) => names.includes(name);
  const message = String(err?.message ?? err ?? "");
  const subErrs = Array.isArray(err?.config?.requestErrs) ? err.config.requestErrs : [];
  const subText = subErrs.map((e) => String(e?.message ?? e ?? "")).join(" ");
  if (is("SetupError")) return { kind: "fatal", detail: message, reason: message };
  if (is("UserOfflineError")) return { kind: "offline" };
  if (is("InvalidUniqueIdError") || /\b19881007\b|user_not_found/i.test(message) || /\b19881007\b|user_not_found/i.test(subText)) {
    return { kind: "fatal", detail: "TikTok doesn't know that name. Check the spelling.", reason: "TikTok user not found (check spelling)" };
  }
  if (names.some((n) => /RateLimit/i.test(n)) || /\b429\b|rate.?limit/i.test(message) || /\b429\b|rate.?limit/i.test(subText) || err?.response?.statusCode === 429) {
    return { kind: "limited", reason: describeError(err) };
  }
  if (is("PremiumFeatureError")) return { kind: "fatal", detail: "TikTok's free connection doesn't allow that.", reason: describeError(err) };
  // If Euler explicitly answered 200 with no active room (and no auth/rate-limit error), treat as offline instead of hard error
  if (is("InvalidResponseCompositeError") && /Failed to extract Room ID from Euler/i.test(subText) && !/\b(401|402|403|429)\b/.test(subText)) {
    return { kind: "offline" };
  }
  return { kind: "failed", detail: "Couldn't reach TikTok. Trying again…", reason: describeError(err) };
}

/** A wait in plain words for a page to show: "minute", "10 minutes", "30 seconds". */
export function lengthOf(ms) {
  if (ms >= 60000) {
    const minutes = Math.round(ms / 60000);
    return minutes === 1 ? "minute" : `${minutes} minutes`;
  }
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds === 1 ? "second" : `${seconds} seconds`;
}

export class Room {
  constructor(user, hub) {
    this.user = user;
    this.hub = hub;
    this.clients = new Set();
    this.since = Date.now(); // when this account was let in, for the owner's list of who is connected
    this.status = { state: "connecting", detail: "", fatal: false };
    this.conn = null;
    this.running = false;
    this.stopped = false;
    this.idleTimer = 0;
    this.sleeper = null;
    this.seen = new Set(); // ids of the latest messages, so a message is never shown twice
    this.counts = { chat: 0, gift: 0, follow: 0, share: 0 };
    this.report = 0;
    this.likes = new Map(); // person -> likes counted in the current second
    this.live = false; // TikTok's own room details say the LIVE is on (a quiet chat does not mean it is not)
    this.base = 0; // the account's follower count when we connected (0 when TikTok did not say)
    this.followed = 0; // follows seen since then, so a page that joins later is told a current number
    this.likeTimer = 0;
    this.viewers = 0; // how many are watching, as TikTok last said (0: not known yet)
    this.viewerTimer = 0;
    this.viewerSentAt = 0;
    this.lastLookAt = 0; // when we last asked TikTok whether the account is LIVE (see add)
    this.liveEndedAt = 0; // when the LIVE we were connected to ended (0: none has, since we started); the owner's list says "ended 20 min ago"
    this.lastSeenAt = 0; // when a chat line, gift, follow or share last came through, so the list can tell a busy LIVE from a quiet one
    this.emptySince = Date.now(); // when the last page left (a room with no page is only waiting out idleStopMs)
    this.lastEventAt = 0; // when anything last came from TikTok on the connection we have
    this.silentFor = 0; // how long a silence is put up with before the connection is replaced (grows after a silence that changed nothing)
    this.cachedRoomId = ""; // cached live roomId so short hiccups skip fetchRoomId()
    this.cachedRoomAt = 0;
    this.hadLive = false;
    this.lastError = ""; // concise owner-facing explanation of the most recent connection error
    this.connectMs = null; // how long the most recent connect took (ms)
    this.nextTryAt = 0; // when the next offline/retry check is scheduled (ms, 0 when connected/stopped)
    this.offlineSince = 0; // when this wait for a LIVE began (0 when not waiting offline)
    this.demoted = null; // Waiting entry if this room yielded its slot while offline (so release() still cleans up)
    const preloaded = typeof hub.consumePreloadedRoom === "function" ? hub.consumePreloadedRoom(user) : null;
    if (preloaded?.roomId) {
      this.cachedRoomId = preloaded.roomId;
      this.cachedRoomAt = preloaded.at;
      if (preloaded.followers > 0) this.base = preloaded.followers;
    }
  }

  add(client) {
    clearTimeout(this.idleTimer);
    this.clients.add(client);
    this.emptySince = 0;
    client.send("status", this.status);
    if (this.base > 0 || this.live || this.viewers > 0) client.send("info", this.info());
    if (!this.running) this.start();
    // A page that opens while the room is between two looks for a LIVE (the account is offline, and looked at less and less often the longer
    // that lasts) makes it look right now, so a streamer who just went LIVE and reloads the overlay is not made to wait. Not more than once
    // every wakeGapMs, because each look costs a request to the signing service and a page can be opened as often as anyone likes.
    else if (this.sleeper && this.status.state === "offline" && Date.now() - this.lastLookAt >= this.hub.opts.wakeGapMs) this.sleeper();
  }

  /** What the room knows about the account itself: whether it is LIVE, its follower count when TikTok gave one (0 when not), and how many are watching (only once known). */
  info() {
    return { live: this.live, followers: this.base > 0 ? this.base + this.followed : 0, ...(this.viewers > 0 ? { viewers: this.viewers } : {}) };
  }

  /**
   * TikTok says how many are watching right now every few seconds. A change is passed on to the pages, at most once every 3 seconds (a big LIVE changes it all the time),
   * and the newest number always gets there: a number that arrives too soon waits and is sent when the 3 seconds are up.
   * tiktok-live-connector 2.5 sends current viewers in `total` (whereas `totalUser` is cumulative room visits and must not be read as current viewers).
   */
  seeViewers(d) {
    const n = Math.round(Number(d?.viewerCount ?? d?.viewer_count ?? d?.total));
    if (!Number.isFinite(n) || n < 0 || n >= 1e9 || n === this.viewers) return;
    this.viewers = n;
    if (this.viewerTimer) return;
    const wait = Math.max(0, this.viewerSentAt + 3000 - Date.now());
    this.viewerTimer = setTimeout(() => {
      this.viewerTimer = 0;
      this.viewerSentAt = Date.now();
      this.broadcast("info", this.info());
    }, wait);
  }

  /** Reads the follower count and live status from TikTok's room details (falling back to our direct api-live probe if TikTok omitted fields). */
  readInfo(conn, directProbe = null) {
    let followers = 0;
    let status = 0;
    let currentViewers = 0;
    try {
      const room = (conn.roomInfo?.data ?? conn.roomInfo) ?? {};
      followers = Math.round(Number(room.owner?.follow_info?.follower_count));
      status = Number(room.status);
      currentViewers = Math.round(Number(room.user_count));
    } catch { /* no details: pages keep the number the streamer typed */ }
    if (!(Number.isFinite(followers) && followers > 0 && followers < 1e10) && directProbe?.followers > 0) {
      followers = Math.round(Number(directProbe.followers));
    }
    if (!(Number.isFinite(currentViewers) && currentViewers > 0 && currentViewers < 1e9) && directProbe?.viewers > 0) {
      currentViewers = Math.round(Number(directProbe.viewers));
    }
    this.base = Number.isFinite(followers) && followers > 0 && followers < 1e10 ? followers : 0;
    this.live = status === 2 || (status !== 4 && directProbe?.live === true);
    if (this.live) this.liveEndedAt = 0;
    if (this.live && !this.viewers && Number.isFinite(currentViewers) && currentViewers > 0 && currentViewers < 1e9) this.viewers = currentViewers;
    this.followed = 0;
    if (this.base > 0 || this.live) this.broadcast("info", this.info());
  }

  idleWindowMs() {
    const offMs = this.hub.opts.offlineIdleStopMs;
    return !this.live && Number.isFinite(offMs) && offMs > 0 ? Math.min(offMs, this.hub.opts.idleStopMs) : this.hub.opts.idleStopMs;
  }

  remove(client) {
    if (this.demoted) {
      this.demoted.remove(client);
      return;
    }
    this.clients.delete(client);
    if (!this.clients.size) this.emptySince = Date.now();
    if (!this.clients.size && !this.stopped) this.idleTimer = setTimeout(() => this.hub.drop(this), this.idleWindowMs());
  }

  /** Current client count across any demotion/promotion chain (used for logging on stream close). */
  activeClientCount() {
    let cur = this;
    const seen = new Set();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (cur.demoted) cur = cur.demoted;
      else if (cur.room) cur = cur.room;
      else break;
    }
    return cur?.clients?.size ?? 0;
  }

  broadcast(event, data) {
    for (const client of [...this.clients]) {
      // An alert goes only to pages that asked for its kind (?events=follow,gift,share); everything else goes to everyone.
      if (event === "alert" && !client.events?.has(data.kind)) continue;
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

  /** Once per account: says in the relay's own log when emotes came in a message but none could be shown, and from which picture server. */
  noteEmotes(d, m) {
    if (this.emoteNoted || !Array.isArray(d?.emotes) || !d.emotes.length || m?.pics?.length) return;
    this.emoteNoted = true;
    let host = "unknown";
    try {
      const image = d.emotes[0]?.emote?.image;
      host = new URL(image?.imageUrl ?? image?.url?.[0] ?? image?.urlList?.[0] ?? image?.mUrls?.[0]).hostname;
    } catch { /* no address to name */ }
    this.hub.log(`@${this.user}: emotes arrived but none could be shown (picture server ${host})`);
  }

  wire(conn, finish) {
    // Any sign of life from TikTok (chat, likes, viewers, raw WebSocket packets/heartbeats) shows the connection is alive.
    const heard = () => { this.lastEventAt = Date.now(); this.silentFor = this.hub.opts.silentMs; };
    for (const name of ["chat", "emote", "gift", "like", "follow", "share", "imDelete", "roomUser", "member", "social", "enterRoom", "websocketData"]) conn.on(name, heard);
    conn.on("chat", (d) => {
      const m = mapChat(d);
      this.noteEmotes(d, m);
      if (!m || !this.fresh(m.id)) return;
      this.counts.chat += 1;
      this.lastSeenAt = Date.now();
      this.broadcast("chat", m);
    });
    conn.on("emote", (d) => {
      const m = mapEmoteChat(d);
      if (!m || !this.fresh(m.id)) return;
      this.counts.chat += 1;
      this.lastSeenAt = Date.now();
      this.broadcast("chat", m);
    });
    conn.on("gift", (d) => {
      const m = mapGift(d);
      if (m && this.fresh(m.id)) this.broadcast("chat", m); // (the gift is counted once, with its alert below)
      this.alert(mapGiftAlert(d));
    });
    conn.on("like", (d) => this.like(mapLike(d)));
    conn.on("roomUser", (d) => this.seeViewers(d));
    conn.on("follow", (d) => this.alert(mapFollow(d)));
    conn.on("share", (d) => this.alert(mapShare(d)));
    conn.on("imDelete", (d) => {
      const { ids, users } = mapDelete(d);
      for (const id of ids) this.broadcast("remove", { id });
      for (const user of users) this.broadcast("clear", { user });
    });
    conn.on("streamEnd", () => {
      this.cachedRoomId = "";
      this.cachedRoomAt = 0;
      finish({ kind: "offline", detail: "The LIVE ended. Waiting for the next one…", wasConnected: true });
    });
    conn.on("disconnected", () => finish({ kind: "dropped", wasConnected: true }));
    conn.on("error", (err) => this.hub.log(`@${this.user}: ${String(err?.constructor?.name ?? "error")} ${String(err?.message ?? "").slice(0, 120)}`));
  }

  /**
   * A like. Likes arrive in large numbers, so they are added up per person and sent once a second as one line each ({ kind: "like",
   * count }), and only while some page has asked for likes. A busy LIVE sends a line per liker per second, not one per tap.
   */
  like(m) {
    if (!m || ![...this.clients].some((c) => c.events?.has("like"))) return;
    if (m.id && !this.fresh("alert:like:" + m.id)) return;
    const held = this.likes.get(m.user);
    if (held) { held.count += m.count; held.total = Math.max(held.total, m.total); }
    else this.likes.set(m.user, { ...m });
    if (this.likes.size > 500) this.flushLikes(); // never hold a crowd for long
    if (!this.likeTimer) this.likeTimer = setTimeout(() => this.flushLikes(), 1000);
  }

  flushLikes() {
    clearTimeout(this.likeTimer);
    this.likeTimer = 0;
    const held = [...this.likes.values()];
    this.likes.clear();
    for (const line of held) this.broadcast("alert", { ...line, id: "" });
  }

  /** An alert event for the pages that asked for it. Its id is kept apart from chat ids, so a gift is both a chat line and an alert. */
  alert(m) {
    if (!m || !this.fresh(m.id && `alert:${m.kind}:${m.id}`)) return;
    if (m.kind in this.counts) {
      this.counts[m.kind] += 1;
      this.lastSeenAt = Date.now();
    }
    if (m.kind === "follow") this.followed += 1;
    this.broadcast("alert", m);
  }

  /** One try: connect, then wait until the connection ends. Resolves with how it ended. */
  async once() {
    // Every attempt takes a turn first: at most a few at once, and none at all while the signing service has said "busy" (see Hub.turn).
    await this.hub.turn();
    let turn = true;
    const give = () => { if (turn) { turn = false; this.hub.release(); } };
    if (this.stopped) {
      give();
      return { kind: "stopped" };
    }
    let conn;
    const began = Date.now();
    this.lastLookAt = began;
    try {
      const apiKey = typeof this.hub.opts.apiKey === "function" ? this.hub.opts.apiKey() : this.hub.opts.apiKey;
      conn = await this.hub.opts.factory(this.user, { apiKey });
    } catch (err) {
      give();
      return classify(err);
    }
    if (this.stopped) {
      give();
      this.letGo(conn);
      return { kind: "stopped" };
    }
    const cacheTtlMs = this.hub.opts.roomIdCacheMs ?? 600000;
    let freshRoomId = this.cachedRoomId && (Date.now() - this.cachedRoomAt) <= cacheTtlMs ? this.cachedRoomId : "";
    if (!freshRoomId) {
      this.cachedRoomId = "";
      this.cachedRoomAt = 0;
    }

    // 1. Direct TikTok live pre-check (0 Euler calls!):
    //    - Paced through `hub.directTurn()` (small burst + steady spacing + shared 403 cooldown) so restarts with
    //      15+ rooms never trip TikTok's per-IP 403 WAF on /api-live/user/room/.
    //    - If `checkLiveDirect()` returns `{ live: false }`, skip `conn.connect()` & Euler completely (`offlineSaved`).
    //    - If `checkLiveDirect()` returns `{ live: true, roomId }`, pass `roomId` straight into `conn.connect(roomId)`.
    //    - If `checkLiveDirect()` gets HTTP 403, trip the shared TikTok cooldown and wait cleanly instead of
    //      falling into `conn.connect()` and compounding the 403 storm.
    let directProbe = null;
    if (!conn.pretend && !freshRoomId) {
      if (typeof conn.checkLiveDirect === "function") {
        await this.hub.directTurn();
        if (this.stopped) {
          give();
          this.letGo(conn);
          return { kind: "stopped" };
        }
        try {
          const probe = await conn.checkLiveDirect();
          this.hub.directOk();
          if (probe?.live === false) {
            give();
            this.letGo(conn);
            this.hub.opts.onOfflineSaved?.();
            return { kind: "offline" };
          }
          if (probe?.live === true) {
            directProbe = probe;
            if (probe.roomId) freshRoomId = String(probe.roomId);
          }
        } catch (err) {
          if (err?.name === "InvalidUniqueIdError" || /\b19881007\b|user_not_found/i.test(String(err?.message ?? ""))) {
            give();
            this.letGo(conn);
            return classify(err);
          }
          const status = err?.status ?? err?.response?.statusCode ?? 0;
          if (status === 403 || status === 429) {
            const waitMs = this.hub.directBlocked(status);
            give();
            this.letGo(conn);
            return {
              kind: "tiktok_busy",
              waitMs,
              detail: `TikTok paused room checks (HTTP ${status}). Resuming automatically…`,
              reason: `TikTok API ${status} cooldown (${Math.round(waitMs / 1000)} s)`,
            };
          }
          /* transient network/parse glitch — fall through to conn.connect() */
        }
      } else if (typeof conn.fetchIsLive === "function") {
        try {
          const isLive = await conn.fetchIsLive();
          if (isLive === false) {
            give();
            this.letGo(conn);
            this.hub.opts.onOfflineSaved?.();
            return { kind: "offline" };
          }
        } catch {
          /* direct check inconclusive — fall through to conn.connect() */
        }
      }
    }

    // 2. Daily Euler budget guard: avoid firing doomed 429 requests when the single account's quota is paused/reserved.
    const isPriority = this.hub.isPriority(this.user);
    if (!conn.pretend && typeof this.hub.opts.canSign === "function" && !this.hub.opts.canSign({ priority: isPriority, user: this.user })) {
      give();
      this.letGo(conn);
      this.hub.opts.onBudgetBlocked?.();
      this.hub.busy();
      return { kind: "limited", detail: "Daily TikTok signing budget reached. Waiting for quota reset…", reason: "Daily Euler budget guard paused" };
    }

    // 3. Per-minute Euler burst pacer: stays safely under Euler's 60 req/min cap during mass reconnects.
    if (!conn.pretend) {
      await this.hub.signTurn();
      if (this.stopped) {
        give();
        this.letGo(conn);
        return { kind: "stopped" };
      }
    }

    this.conn = conn;
    let finish;
    const ended = new Promise((resolve) => { finish = resolve; });
    this.wire(conn, finish);
    try {
      if (freshRoomId) {
        if (this.cachedRoomId && freshRoomId === this.cachedRoomId) this.hub.opts.onCacheHit?.();
        await conn.connect(freshRoomId);
      } else {
        await conn.connect();
      }
    } catch (err) {
      give();
      this.letGo(conn);
      if (freshRoomId) {
        this.cachedRoomId = "";
        this.cachedRoomAt = 0;
      }
      const how = classify(err);
      if (how.kind === "failed" || how.kind === "fatal") {
        this.hub.log(`@${this.user}: connect failed — ${how.reason || how.detail}`);
      }
      if (how.kind === "limited") this.hub.busy();
      return how;
    }
    give();
    if (this.stopped) {
      this.letGo(conn);
      return { kind: "stopped" };
    }
    this.lastError = "";
    this.nextTryAt = 0;
    const tookMs = Math.max(0, Date.now() - began);
    this.connectMs = tookMs;
    const resolvedRoomId = String(conn.roomId ?? conn.state?.roomId ?? "").trim();
    if (resolvedRoomId) {
      this.cachedRoomId = resolvedRoomId;
      this.cachedRoomAt = Date.now();
    }
    const isReconnect = this.hadLive;
    this.hadLive = true;
    if (!conn.pretend) this.hub.signed({ reconnect: isReconnect }); // (the practice account makes chat up: it never asked the signing service)
    this.hub.log(`@${this.user}: connected in ${(tookMs / 1000).toFixed(1)} s`);
    this.readInfo(conn, directProbe);
    this.setStatus("connected", conn.pretend ? "Practice chat made up by Frills. Nothing comes from TikTok." : "");
    const watch = this.watchSilence(finish);
    const how = await ended;
    clearInterval(watch);
    this.letGo(conn);
    // The connection is over, so the LIVE we knew about is no longer known to be on. (This flag was only ever set, never cleared: an account whose
    // LIVE had ended kept saying "LIVE" in the owner's list, and in the details a page that joined later was given.) A reconnect that finds it still on sets it again.
    if (this.live) {
      this.live = false;
      this.liveEndedAt = Date.now();
    }
    this.viewers = 0; // nobody is watching a LIVE that is over (a reconnect to a LIVE that is still on hears the number again)
    return how;
  }

  /**
   * TikTok can leave a connection open and say nothing: a dead one still looks "connected" (it did, for a LIVE that was running with people chatting). A
   * LIVE always says something every few seconds (the viewer count), so a connection that has heard nothing at all for a while is let go and a fresh
   * one is made, which asks TikTok again about the room. A silence that a fresh connection did not change is waited out for twice as long next time,
   * up to a limit, so a room that is really silent does not cost a request to the signing service every two minutes.
   */
  watchSilence(finish) {
    const base = this.hub.opts.silentMs;
    if (!(base > 0)) return 0;
    const connectedAt = Date.now();
    this.lastEventAt = connectedAt;
    this.silentFor ||= base;
    const timer = setInterval(() => {
      if (this.stopped) return;
      const limit = this.silentFor;
      if (Date.now() - this.lastEventAt <= limit) return;
      this.hub.log(`@${this.user}: nothing from TikTok for ${Math.round(limit / 1000)} s, so it connects again`);
      this.silentFor = Math.min(this.hub.opts.silentMaxMs, limit * 2);
      finish({ kind: "dropped", wasConnected: this.lastEventAt > connectedAt });
    }, Math.max(10, Math.min(10000, base / 4)));
    timer.unref?.();
    return timer;
  }

  letGo(conn) {
    if (this.conn === conn) this.conn = null;
    try { conn.disconnect(); } catch { /* it was already closed */ }
  }

  sleep(ms) {
    this.nextTryAt = ms > 0 ? Date.now() + ms : 0;
    return new Promise((resolve) => {
      const done = () => { this.sleeper = null; this.nextTryAt = 0; resolve(); };
      const timer = setTimeout(done, ms);
      this.sleeper = () => { clearTimeout(timer); done(); };
    });
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.hub.log(`@${this.user}: connecting`); // the pages are told by the status above; this is the line for the window you are watching
    this.report = setInterval(() => {
      const c = this.counts;
      if (c.chat || c.gift || c.follow || c.share) this.hub.log(`@${this.user}: ${c.chat} chat, ${c.gift} gifts, ${c.follow} follows and ${c.share} shares in the last minute`);
      this.counts = { chat: 0, gift: 0, follow: 0, share: 0 };
    }, 60000);
    const { offlineWaitMs, offlineGiveUpMs, offlineSlowSteps, backoffMs } = this.hub.opts;
    let attempt = 0;
    this.offlineSince = 0; // when this wait for a LIVE began; tracked on the Room so smart eviction can yield stale offline rooms
    let quiet = false; // while waiting for a LIVE to start, keep saying so instead of flickering to "connecting" at every look
    while (!this.stopped) {
      if (!quiet) this.setStatus(attempt === 0 ? "connecting" : "reconnecting");
      const how = await this.once();
      if (this.stopped || how.kind === "stopped") break;
      if (how.wasConnected) attempt = 0;
      if (how.kind !== "offline") this.offlineSince = 0;
      quiet = how.kind === "offline" || how.kind === "limited";
      if (how.kind === "fatal") {
        this.lastError = how.reason || how.detail || "Fatal error";
        this.setStatus("error", how.detail, true);
        break;
      } else if (how.kind === "offline") {
        this.lastError = "";
        this.offlineSince ||= Date.now();
        const waited = Date.now() - this.offlineSince;
        if (offlineGiveUpMs > 0 && waited >= offlineGiveUpMs) {
          // Stop looking. A page that connects again (or the person pressing Connect) starts the wait afresh.
          this.setStatus("offline", "Still not live after a long wait, so Frills stopped looking. Press Disconnect, then Connect again when you go LIVE.");
          break;
        }
        // The longer an account stays offline, the less often it is looked at: a page that stays open all night costs a few requests, not hundreds,
        // and it still finds the next LIVE by itself, which a relay that gave up could not do (an overlay in OBS has no button to press).
        let every = offlineWaitMs;
        for (const [after, wait] of offlineSlowSteps) if (waited >= after) every = wait;
        this.setStatus("offline", every > offlineWaitMs ? `Not live yet. Looking again every ${lengthOf(every)}. Opening this link again looks right away.` : how.detail ?? "");
        await this.sleep(every);
      } else if (how.kind === "tiktok_busy") {
        this.lastError = how.reason || how.detail || "TikTok API cooldown";
        this.setStatus("limited", how.detail ?? "");
        const left = this.hub.directCooldownLeft() || how.waitMs || 30000;
        await this.sleep(Math.min(left, 60000));
      } else if (how.kind === "limited") {
        this.lastError = how.reason || how.detail || "Rate limited";
        this.setStatus("limited", how.detail ?? "");
        if (!how.detail) this.hub.opts.onLimited?.();
        await this.sleep(Math.min(this.hub.cooldownLeft(), 1000)); // the shared pause is waited out in Hub.turn at the next attempt
      } else {
        if (how.kind === "failed") {
          this.lastError = how.reason || how.detail || "Connection failed";
          this.setStatus("error", how.detail);
        } else {
          this.setStatus("reconnecting");
        }
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
    clearTimeout(this.likeTimer);
    clearTimeout(this.viewerTimer);
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

  activeClientCount() {
    return this.room ? this.room.activeClientCount() : this.clients.size;
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
    this.opts = { factory: null, apiKey: "", maxRooms: 3, queue: false, queueGraceMs: 20000, idleStopMs: 30000, offlineIdleStopMs: null, offlineWaitMs: 20000, limitedWaitMs: 60000, limitedMaxMs: 600000, connectAtOnce: 5, offlineGiveUpMs: 0, offlineSlowSteps: [], wakeGapMs: 30000, backoffMs: [3000, 6000, 12000, 30000, 60000], silentMs: 300000, silentMaxMs: 1800000, roomIdCacheMs: 600000, directGapMs: 0, directBurst: 3, tiktokWaitMs: 30000, tiktokMaxMs: 180000, smartEvict: false, offlineEvictAfterMs: 120000, signPerMinute: 0, signBurst: 5, priorityUsers: [], ...opts };
    this.log = opts.log ?? (() => {});
    this.rooms = new Map();
    this.waiting = new Map(); // accounts in line for a spot, oldest first
    this.cooldownUntil = 0; // while it is later than now, nobody asks the signing service (it said "busy")
    this.cooldownWaiters = new Set(); // sleeping attempts waiting for cooldownUntil to expire (woken early by clearBusy)
    this.strikes = 0; // how many "busy" in a row, which sets how long the next pause is
    this.active = 0; // attempts to connect that are under way
    this.line = []; // attempts waiting for a turn
    // Shared direct TikTok api-live pacer + 403 cooldown (prevents 15+ rooms bursting /api-live/user/room/ at once)
    this.directTokens = Math.max(1, this.opts.directBurst ?? 3);
    this.directLastRefill = Date.now();
    this.directChain = Promise.resolve();
    this.directBlockedUntil = 0;
    this.directStrikes = 0;
    // Shared Euler per-minute burst pacer (prevents mass reconnects tripping Euler's 60 req/min wall)
    this.signTokens = Math.max(1, this.opts.signBurst ?? 5);
    this.signLastRefill = Date.now();
    this.signChain = Promise.resolve();
    // Priority (VIP/owner) accounts: never queued behind free traffic, never evicted
    this.priorityUsers = new Set([...(this.opts.priorityUsers ?? [])].map((u) => String(u ?? "").trim().replace(/^@+/, "").toLowerCase()).filter(Boolean));
    // Preloaded 10-min roomId restart cache (populated on boot from disk snapshot so restarts reconnect instantly)
    this.preloadedRooms = new Map();
    this.evictions = 0;
  }

  isPriority(user) {
    return this.priorityUsers.has(String(user ?? "").trim().replace(/^@+/, "").toLowerCase());
  }

  /** Dynamically updates maxRooms (e.g. RELAY_SLOTS=auto after syncing live Euler quota) without interrupting live rooms. */
  setMaxRooms(nextMax) {
    const n = Math.max(1, Math.round(Number(nextMax) || 0));
    if (!Number.isFinite(n) || n === this.opts.maxRooms) return false;
    const grew = n > this.opts.maxRooms;
    this.opts.maxRooms = n;
    if (grew) this.promote();
    return true;
  }

  /** Exports fresh active roomIds (TTL roomIdCacheMs) for fast restart recovery. Zero chat or private data. */
  exportRoomCache(now = Date.now()) {
    const ttl = this.opts.roomIdCacheMs ?? 600000;
    const out = {};
    for (const [user, entry] of this.preloadedRooms) {
      if (entry?.roomId && now - entry.at <= ttl) out[user] = { roomId: entry.roomId, at: entry.at, followers: entry.followers || 0 };
    }
    for (const room of this.rooms.values()) {
      if (room.cachedRoomId && now - room.cachedRoomAt <= ttl) {
        out[room.user] = { roomId: room.cachedRoomId, at: room.cachedRoomAt, followers: room.base || 0 };
      }
    }
    return out;
  }

  /** Imports fresh roomIds saved before a restart so reconnecting rooms skip /api-live/user/room/. */
  importRoomCache(entries, now = Date.now()) {
    if (!entries || typeof entries !== "object") return 0;
    const ttl = this.opts.roomIdCacheMs ?? 600000;
    let loaded = 0;
    for (const [user, raw] of Object.entries(entries)) {
      const clean = String(user ?? "").trim().toLowerCase();
      const roomId = String(raw?.roomId ?? "").trim();
      const at = Number(raw?.at) || 0;
      const followers = Math.max(0, Math.round(Number(raw?.followers) || 0));
      if (!clean || !/^\d{5,30}$/.test(roomId) || at <= 0 || now - at > ttl || at > now + 60000) continue;
      this.preloadedRooms.set(clean, { roomId, at, followers });
      loaded += 1;
    }
    return loaded;
  }

  consumePreloadedRoom(user, now = Date.now()) {
    const entry = this.preloadedRooms.get(user);
    if (!entry) return null;
    this.preloadedRooms.delete(user);
    const ttl = this.opts.roomIdCacheMs ?? 600000;
    return now - entry.at <= ttl ? entry : null;
  }

  /** Paces Euler-signed connects to stay safely under Euler's per-minute cap (e.g. 45/min on Euler Free's 60/min limit). */
  signTurn() {
    const rawRate = typeof this.opts.signPerMinute === "function" ? this.opts.signPerMinute() : this.opts.signPerMinute;
    const perMin = Math.max(0, Number(rawRate) || 0);
    if (perMin <= 0) return Promise.resolve();
    const gap = Math.max(10, Math.round(60000 / perMin));
    const burst = Math.max(1, Math.min(perMin, Number(this.opts.signBurst) || 5));
    const prev = this.signChain;
    let release;
    this.signChain = new Promise((r) => { release = r; });
    return (async () => {
      await prev;
      try {
        for (;;) {
          const now = Date.now();
          const gained = Math.floor((now - this.signLastRefill) / gap);
          if (gained > 0) {
            this.signTokens = Math.min(burst, this.signTokens + gained);
            this.signLastRefill += gained * gap;
          }
          if (this.signTokens >= 1) {
            this.signTokens -= 1;
            return;
          }
          const wait = Math.max(20, this.signLastRefill + gap - now);
          await new Promise((r) => { const t = setTimeout(r, wait); t.unref?.(); });
        }
      } finally {
        release();
      }
    })();
  }

  directCooldownLeft(now = Date.now()) {
    return Math.max(0, this.directBlockedUntil - now);
  }

  /** Called when a direct TikTok api-live call returns 200 OK: clears any 403 strike backoff. */
  directOk() {
    this.directStrikes = 0;
    this.directBlockedUntil = 0;
  }

  /** Called when TikTok returns HTTP 403/429 on /api-live/user/room/: pauses all rooms briefly so the IP bucket recovers. */
  directBlocked(status = 403, now = Date.now()) {
    if (now < this.directBlockedUntil) return this.directCooldownLeft(now);
    const base = Math.max(100, this.opts.tiktokWaitMs ?? 30000);
    const max = Math.max(base, this.opts.tiktokMaxMs ?? 180000);
    const wait = Math.min(max, base * 2 ** Math.min(this.directStrikes, 4));
    this.directStrikes += 1;
    this.directBlockedUntil = now + wait;
    this.directTokens = 0;
    this.directLastRefill = this.directBlockedUntil;
    this.log(`TikTok /api-live/ returned HTTP ${status}: pausing room lookups for ${Math.round(wait / 1000)} s (strike ${this.directStrikes})`);
    return wait;
  }

  /** Paces direct TikTok api-live checks (small burst, then 1 every `directGapMs`, plus waiting out any active 403 cooldown). */
  directTurn() {
    const gap = Math.max(0, Number(this.opts.directGapMs) || 0);
    const burst = Math.max(1, Number(this.opts.directBurst) || 3);
    const prev = this.directChain;
    let release;
    this.directChain = new Promise((r) => { release = r; });
    return (async () => {
      await prev;
      try {
        for (;;) {
          const blocked = this.directCooldownLeft();
          if (blocked > 0) {
            await new Promise((r) => { const t = setTimeout(r, blocked + 20); t.unref?.(); });
            continue;
          }
          if (gap <= 0) return;
          const now = Date.now();
          const gained = Math.floor((now - this.directLastRefill) / gap);
          if (gained > 0) {
            this.directTokens = Math.min(burst, this.directTokens + gained);
            this.directLastRefill += gained * gap;
          }
          if (this.directTokens >= 1) {
            this.directTokens -= 1;
            return;
          }
          const wait = Math.max(20, this.directLastRefill + gap - now);
          await new Promise((r) => { const t = setTimeout(r, wait); t.unref?.(); });
        }
      } finally {
        release();
      }
    })();
  }

  /** What is left of the pause after the signing service said "busy" (0 when there is none). */
  cooldownLeft(now = Date.now()) {
    return Math.max(0, this.cooldownUntil - now);
  }

  /** Clears an active signing backoff pause immediately (e.g. after rotating to a fresh backup Euler key). */
  clearBusy() {
    this.cooldownUntil = 0;
    this.strikes = 0;
    for (const wake of [...this.cooldownWaiters]) wake();
    this.cooldownWaiters.clear();
  }

  /**
   * The free signing service said "busy". Nobody asks it again for a while, and the while grows with each "busy" in a row (the base wait, doubled
   * each time, up to `limitedMaxMs`, with up to a quarter more so the rooms do not all come back at the same moment). Before this, every room waited
   * a minute on its own and tried again at the same moment as the others, which kept it busy. Several rooms hearing "busy" in the same burst count once.
   */
  busy(now = Date.now()) {
    if (now < this.cooldownUntil) return this.cooldownLeft(now);
    const { limitedWaitMs, limitedMaxMs } = this.opts;
    const wait = Math.min(limitedMaxMs, limitedWaitMs * 2 ** Math.min(this.strikes, 10));
    this.strikes += 1;
    this.cooldownUntil = now + wait * (1 + Math.random() * 0.25);
    this.log(`the signing service is busy: waiting about ${Math.round(wait / 1000)} s before asking it again (${this.strikes} in a row)`);
    return this.cooldownLeft(now);
  }

  /** A connection went through: the signing service is fine, so the pauses start over, and this counts as one use of it. */
  signed(info = {}) {
    this.strikes = 0;
    this.opts.onSigned?.(info);
  }

  /** Waits for a turn to connect: until any pause is over, and until fewer than `connectAtOnce` attempts are under way. Give it back with release(). */
  async turn() {
    for (;;) {
      const wait = this.cooldownLeft();
      if (wait > 0) {
        await new Promise((resolve) => {
          const done = () => { clearTimeout(t); this.cooldownWaiters.delete(done); resolve(); };
          const t = setTimeout(done, wait + 10);
          t.unref?.();
          this.cooldownWaiters.add(done);
        });
        continue;
      }
      // after a "busy" only one goes first, to find out whether the service has calmed down; the rest follow once it has (strikes back to 0)
      const room = this.strikes > 0 ? 1 : this.opts.connectAtOnce;
      if (this.active < room) {
        this.active += 1;
        return;
      }
      await new Promise((resolve) => this.line.push(resolve));
    }
  }

  release() {
    this.active = Math.max(0, this.active - 1);
    this.line.shift()?.();
  }

  /** How full it is. Numbers only: no account names. */
  stats() {
    return { used: this.rooms.size, max: this.opts.maxRooms, waiting: this.waiting.size };
  }

  /**
   * Who is connected right now, for the owner's own screen only (the status page opened on the device itself): each account with whether
   * it is LIVE, how many pages are listening, what has passed, and for how long it has been here; and the names in line. Held in memory
   * only: nothing here is written down, and the server never sends it to a page that comes from the internet.
   */
  roster(now = Date.now()) {
    const secondsSince = (at) => (at ? Math.max(0, Math.round((now - at) / 1000)) : null);
    const accounts = [...this.rooms.values()].map((room) => ({
      user: room.user,
      state: room.status.state,
      detail: room.status.detail || "",
      lastError: room.lastError || "",
      connectMs: room.connectMs,
      retryInS: room.nextTryAt > now ? Math.max(1, Math.round((room.nextTryAt - now) / 1000)) : null,
      live: room.live,
      pages: room.clients.size,
      followers: room.info().followers,
      forS: Math.max(0, Math.round((now - room.since) / 1000)),
      counts: { ...room.counts },
      endedS: secondsSince(room.liveEndedAt), // how long ago the LIVE ended (null: not since we started watching)
      lastS: secondsSince(room.lastSeenAt), // how long ago a chat line, gift, follow or share last came through (null: none yet)
      leavesInS: room.clients.size ? null : Math.max(0, Math.round((room.emptySince + room.idleWindowMs() - now) / 1000)), // no page open: when it is let go
      ...(this.isPriority(room.user) ? { priority: true } : {}),
    }));
    // In use first (LIVE with a page open), then a page waiting for a LIVE, then rooms with no page that are only waiting to be let go.
    const rank = (a) => (a.pages === 0 ? 2 : a.live ? 0 : 1);
    accounts.sort((a, b) => rank(a) - rank(b) || b.forS - a.forS);
    return { accounts, waiting: [...this.waiting.values()].map((entry) => entry.user) };
  }

  /**
   * Frees one slot when the relay is full by reclaiming:
   *  1. An abandoned room with 0 open pages (waiting out idleStopMs), oldest empty first.
   *  2. A dead fatal-error room (e.g. misspelled username that stopped retrying), oldest first.
   *  3. A long-offline room (`state === "offline"` >= `offlineEvictAfterMs`), smoothly moved to the Waiting line so its SSE stays open.
   * Never evicts LIVE/connected rooms or priority (owner/VIP) accounts.
   */
  evictOne(incomingUser, now = Date.now()) {
    const eligible = [...this.rooms.values()].filter((r) => r.user !== incomingUser && !this.isPriority(r.user));
    if (!eligible.length) return false;

    const empty = eligible.filter((r) => r.clients.size === 0).sort((a, b) => a.emptySince - b.emptySince);
    if (empty.length) {
      const victim = empty[0];
      victim.stop();
      if (this.rooms.get(victim.user) === victim) this.rooms.delete(victim.user);
      this.evictions += 1;
      this.log(`@${victim.user}: reclaimed idle spot (0 pages) for @${incomingUser}`);
      return true;
    }

    const fatal = eligible.filter((r) => r.status.fatal).sort((a, b) => a.since - b.since);
    if (fatal.length) {
      const victim = fatal[0];
      victim.stop();
      if (this.rooms.get(victim.user) === victim) this.rooms.delete(victim.user);
      this.evictions += 1;
      this.log(`@${victim.user}: reclaimed fatal-error spot for @${incomingUser}`);
      return true;
    }

    const minOfflineMs = Math.max(0, Number(this.opts.offlineEvictAfterMs) || 0);
    const offline = eligible
      .filter((r) => r.status.state === "offline" && !r.live && r.offlineSince > 0 && now - r.offlineSince >= minOfflineMs)
      .sort((a, b) => a.offlineSince - b.offlineSince);
    if (offline.length && this.opts.queue) {
      const victim = offline[0];
      victim.stop();
      if (this.rooms.get(victim.user) === victim) this.rooms.delete(victim.user);
      let place = this.waiting.get(victim.user);
      if (!place) {
        place = new Waiting(victim.user, this);
        this.waiting.set(victim.user, place);
      }
      victim.demoted = place;
      for (const client of [...victim.clients]) place.add(client);
      victim.clients.clear();
      this.evictions += 1;
      this.tellLine();
      this.log(`@${victim.user}: yielded spot while offline (moved to queue) for @${incomingUser}`);
      return true;
    }
    return false;
  }

  /**
   * Starts sending one account's events to `client` ({ send(event, data) }). Returns the room (or the place in line), or null when
   * there is no room and no line.
   */
  subscribe(user, client) {
    let room = this.rooms.get(user);
    if (!room) {
      const priority = this.isPriority(user);
      if (this.rooms.size >= this.opts.maxRooms && (this.opts.smartEvict || priority)) {
        this.evictOne(user);
      }
      if (this.rooms.size >= this.opts.maxRooms && !priority) {
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
      if (priority && this.waiting.has(user)) {
        const prev = this.waiting.get(user);
        this.waiting.delete(user);
        clearTimeout(prev.leaveTimer);
        prev.room = room;
        for (const c of [...prev.clients]) room.add(c);
        this.tellLine();
      }
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
    this.clearBusy();
    for (const place of this.waiting.values()) clearTimeout(place.leaveTimer);
    this.waiting.clear();
    for (const room of [...this.rooms.values()]) this.drop(room);
  }
}
