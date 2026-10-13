// TikTok chat reaches Frills through the Frills helper: a small program on the streamer's own PC that reads TikTok and also serves this
// site from the same address. A web page can't read TikTok itself, so the page asks the helper for a stream of events (Server-Sent
// Events) and turns them into the same chat messages Twitch gives. The helper is the only thing that talks to TikTok.
//
// The helper sends:  event "status" { state, detail }   event "chat" {message}   event "remove" { id }   event "clear" { user }
// Everything here is plain: no page is needed for the checks, and the connection is only made when connectTikTok is called.

const MAX_TEXT = 300;

// A chatter's profile picture comes from TikTok's own picture servers (seen: tiktokcdn.com, tiktokcdn-us.com, tiktokcdn-eu.com), and
// the page's Content-Security-Policy lists the same three. A made-up chatter (the pretend account) carries a tiny drawing inside the
// address instead. Anything else is not a picture we will show.
const PICTURE_HOST = /(^|\.)tiktokcdn(-us|-eu)?\.com$/i;
const DRAWN_PICTURE = /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]{1,4000}$/;

/** True for an address a profile picture may be loaded from. */
export function isAvatarUrl(value) {
  if (typeof value !== "string" || value.length > 600) return false;
  if (DRAWN_PICTURE.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && PICTURE_HOST.test(url.hostname) && !/\.heic$/i.test(url.pathname);
  } catch {
    return false;
  }
}

/** What a person typed (a name, an @name, or a link to their LIVE) -> a TikTok name, or "" if it can't be one. */
export function cleanTikTokUser(input) {
  let text = String(input ?? "").trim();
  const link = /tiktok\.com\/@([^/?#\s]+)/i.exec(text);
  if (link) text = link[1];
  text = text.replace(/^@/, "").toLowerCase();
  return /^[a-z0-9._]{2,24}$/.test(text) && !text.endsWith(".") ? text : "";
}

/** The emote pictures of a message, checked: at most 8, each a place in the words and an address a page may load. */
function acceptPics(list, textLength) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (out.length >= 8) break;
    if (item && isAvatarUrl(item.url)) out.push({ at: Math.max(0, Math.min(textLength, Math.round(Number(item.at) || 0))), url: item.url });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** One message from the helper -> the plain object a feed draws, with every field checked. Null if there is nothing to draw. */
export function acceptMessage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const text = String(raw.text ?? "").slice(0, MAX_TEXT);
  const name = String(raw.name ?? "").slice(0, 60);
  const pics = acceptPics(raw.pics, Array.from(text).length);
  if ((!text.trim() && !pics.length) || !name.trim()) return null;
  return {
    id: String(raw.id ?? "").slice(0, 80),
    user: String(raw.user ?? "").slice(0, 80),
    name,
    text,
    color: null,
    mod: raw.mod === true,
    gift: raw.gift === true,
    gifter: raw.gifter === true,
    avatar: isAvatarUrl(raw.avatar) ? raw.avatar : "",
    login: String(raw.login ?? "").slice(0, 40),
    host: raw.host === true,
    emotes: [],
    ...(pics.length ? { pics } : {}),
    source: "tiktok",
  };
}

const ALERT_KINDS = ["follow", "gift", "share", "like"];
const num = (value, max) => Math.max(0, Math.min(max, Math.round(Number(value) || 0)));

/** One alert from the helper or relay -> the plain object the alerts draw, with every field checked. Null if there is nothing to draw. */
export function acceptAlert(raw) {
  if (!raw || typeof raw !== "object" || !ALERT_KINDS.includes(raw.kind)) return null;
  const name = String(raw.name ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 60);
  if (!name) return null;
  const alert = {
    kind: raw.kind,
    id: String(raw.id ?? "").slice(0, 80),
    user: String(raw.user ?? "").slice(0, 80),
    name,
    avatar: isAvatarUrl(raw.avatar) ? raw.avatar : "",
  };
  if (raw.kind === "like") {
    alert.count = Math.max(1, num(raw.count, 100000));
    alert.total = num(raw.total, 1000000000);
  }
  if (raw.kind === "gift") {
    Object.assign(alert, {
      gift: String(raw.gift ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 40) || "a gift",
      picture: isAvatarUrl(raw.picture) ? raw.picture : "",
      diamonds: num(raw.diamonds, 1000000),
      count: Math.max(1, num(raw.count, 9999)),
    });
    alert.total = alert.diamonds * alert.count;
  }
  return alert;
}

/** The site's relay for this page: only on the website's own address, because the relay only answers the website (nowhere else would it work). */
export const relayForPage = () => (document.body.dataset.relay && document.body.dataset.site === location.origin ? document.body.dataset.relay : "");

/**
 * Where TikTok chat can come from for this page: { kind: "helper" | "relay", base } or null.
 * First the address the page itself came from (the helper on this PC serves its own pages, and so does a relay in a test), then the
 * shared relay named by the site (`relayBase`, an https address), if there is one.
 */
export async function findTikTokSource(relayBase = "") {
  const ask = async (base) => {
    try {
      const res = await fetch(base + "/tiktok/ping", { cache: "no-store" });
      if (!res.ok) return null;
      const body = await res.json();
      if (body?.ok !== true) return null;
      // `features` says what it can send; an older one has none, which means chat only.
      const features = Array.isArray(body.features) ? body.features.map(String) : ["chat"];
      if (body.name === "frills-helper") return { kind: "helper", base, features };
      if (body.name === "frills-relay") return { kind: "relay", base, features };
    } catch { /* nothing answered there */ }
    return null;
  };
  return (await ask("")) ?? (relayBase ? await ask(relayBase.replace(/\/+$/, "")) : null);
}

/**
 * Reads one TikTok account's LIVE chat through the helper. Calls back like the Twitch connection does, so the pages treat both the
 * same:  onMessage(msg)  onRemove({ id })  onClear({ user })  onStatus({ state, channel, detail, fatal, platform }).
 * `events` (a list of "follow", "gift", "share") also asks for those alerts, which arrive at onAlert(alert).
 * States: connecting, connected, offline (not live yet), reconnecting, limited, helper-lost, error, stopped. Returns { stop() }.
 */
export function connectTikTok({ user, base = "", onMessage, onRemove, onClear, onStatus, onAlert, onInfo, events = [], eventSourceFactory } = {}) {
  const name = cleanTikTokUser(user);
  const say = (state, detail, fatal = false, extra = {}) => onStatus && onStatus({ state, channel: name, detail, fatal, platform: "tiktok", ...extra });
  if (!name) {
    say("error", "TikTok names are letters, numbers, _ and . only.", true);
    return { stop() {} };
  }
  let stopped = false;
  let source = null;
  let heard = false; // something has come from this stream at least once, so it is known to be the relay or helper and worth coming back to
  let beatAt = 0; // when the last "beat" came (a relay sends one every 15 seconds; an older one never does, and is then not watched)
  let tries = 0; // failed attempts in a row, which sets how long to wait before the next
  let again = 0;
  let watcher = 0;
  say("connecting");
  const wanted = events.filter((kind) => ALERT_KINDS.includes(kind));
  const address = `${base}/tiktok/stream?user=${encodeURIComponent(name)}${wanted.length ? `&events=${wanted.join(",")}` : ""}`;

  /** Opens the stream and listens. Called again to come back after the relay was restarted or went away. */
  function open() {
    const mine = (eventSourceFactory ?? ((url) => new EventSource(url)))(address);
    source = mine;
    const listen = (event, fn) => mine.addEventListener(event, (e) => {
      if (stopped || mine !== source) return;
      heard = true;
      tries = 0;
      let data;
      try { data = JSON.parse(e.data); } catch { return; } // a damaged event is skipped, never fatal
      fn(data);
    });
    listen("status", (s) => say(String(s.state ?? ""), typeof s.detail === "string" ? s.detail : "", s.fatal === true, { position: Number(s.position) || 0, total: Number(s.total) || 0 }));
    listen("chat", (raw) => { const m = acceptMessage(raw); if (m && onMessage) onMessage(m); });
    listen("alert", (raw) => { const a = acceptAlert(raw); if (a && onAlert) onAlert(a); });
    // What the account itself says, sent once when the relay connects: whether it is LIVE and its follower count. Anything odd is ignored.
    listen("info", (raw) => {
      const n = Math.round(Number(raw?.followers));
      const followers = Number.isFinite(n) && n > 0 && n < 1e10 ? n : 0;
      const live = raw?.live === true;
      if (onInfo && (followers || live)) onInfo({ live, followers });
    });
    listen("remove", ({ id }) => id && onRemove && onRemove({ id: String(id) }));
    listen("clear", ({ user: who }) => who && onClear && onClear({ user: String(who) }));
    listen("beat", () => { beatAt = Date.now(); });
    mine.onerror = () => {
      if (stopped || mine !== source) return;
      // readyState 2 means the browser gave up. A browser only gives up for good on an answer that is not an event stream, and that is
      // what a relay says while it is being restarted (the tunnel is up, the relay behind it is not yet). So after a stream that had
      // worked we try again ourselves, for as long as it takes; a stream that never worked is not the relay (the hosted site has no
      // such page), or the relay turned us down, and that is said once.
      if (mine.readyState === 2) {
        if (!heard) {
          say("error", base ? "The free Frills relay turned the connection down. It may be busy, or too many pages are open from your address." : "The Frills helper isn't answering here. TikTok chat needs it running on this PC.", true);
          return;
        }
        say("helper-lost", base ? "Lost the free Frills relay. This reconnects by itself." : "");
        comeBack();
      } else {
        // the browser is trying again by itself
        say("helper-lost", base ? "Lost the free Frills relay. This reconnects by itself." : "");
      }
    };
  }

  /** Closes the stream we have and opens a new one after a wait that grows (2, 4, 8, 15 then 30 seconds, with a little jitter). */
  function comeBack(now = false) {
    clearTimeout(again);
    try { source?.close(); } catch { /* already closed */ }
    source = null;
    beatAt = 0;
    const wait = now ? 0 : Math.min(30000, 2000 * 2 ** Math.min(tries, 4)) * (0.8 + Math.random() * 0.4);
    tries += 1;
    again = setTimeout(() => { if (!stopped) open(); }, wait);
  }

  // A relay says "beat" every 15 seconds. Once one has been heard, a long silence means the connection is dead even though the browser
  // does not know it (a tunnel that restarted can leave it hanging), so it is replaced.
  watcher = setInterval(() => {
    if (!stopped && beatAt && Date.now() - beatAt > 50000) {
      say("helper-lost", base ? "Lost the free Frills relay. This reconnects by itself." : "");
      comeBack(true);
    }
  }, 10000);

  watcher?.unref?.(); // in a program (the tests) a waiting timer must not keep it from ending
  open();
  return {
    stop() {
      stopped = true;
      clearTimeout(again);
      clearInterval(watcher);
      try { source?.close(); } catch { /* already closed */ }
      say("stopped");
    },
  };
}
