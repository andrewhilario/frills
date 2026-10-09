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

/** One message from the helper -> the plain object a feed draws, with every field checked. Null if there is nothing to draw. */
export function acceptMessage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const text = String(raw.text ?? "").slice(0, MAX_TEXT);
  const name = String(raw.name ?? "").slice(0, 60);
  if (!text.trim() || !name.trim()) return null;
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
    emotes: [],
    source: "tiktok",
  };
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
      if (body.name === "frills-helper") return { kind: "helper", base };
      if (body.name === "frills-relay") return { kind: "relay", base };
    } catch { /* nothing answered there */ }
    return null;
  };
  return (await ask("")) ?? (relayBase ? await ask(relayBase.replace(/\/+$/, "")) : null);
}

/**
 * Reads one TikTok account's LIVE chat through the helper. Calls back like the Twitch connection does, so the pages treat both the
 * same:  onMessage(msg)  onRemove({ id })  onClear({ user })  onStatus({ state, channel, detail, fatal, platform }).
 * States: connecting, connected, offline (not live yet), reconnecting, limited, helper-lost, error, stopped. Returns { stop() }.
 */
export function connectTikTok({ user, base = "", onMessage, onRemove, onClear, onStatus, eventSourceFactory } = {}) {
  const name = cleanTikTokUser(user);
  const say = (state, detail, fatal = false, extra = {}) => onStatus && onStatus({ state, channel: name, detail, fatal, platform: "tiktok", ...extra });
  if (!name) {
    say("error", "TikTok names are letters, numbers, _ and . only.", true);
    return { stop() {} };
  }
  let stopped = false;
  say("connecting");
  const source = (eventSourceFactory ?? ((url) => new EventSource(url)))(`${base}/tiktok/stream?user=${encodeURIComponent(name)}`);
  const listen = (event, fn) => source.addEventListener(event, (e) => {
    if (stopped) return;
    let data;
    try { data = JSON.parse(e.data); } catch { return; } // a damaged event is skipped, never fatal
    fn(data);
  });
  listen("status", (s) => say(String(s.state ?? ""), typeof s.detail === "string" ? s.detail : "", s.fatal === true, { position: Number(s.position) || 0, total: Number(s.total) || 0 }));
  listen("chat", (raw) => { const m = acceptMessage(raw); if (m && onMessage) onMessage(m); });
  listen("remove", ({ id }) => id && onRemove && onRemove({ id: String(id) }));
  listen("clear", ({ user: who }) => who && onClear && onClear({ user: String(who) }));
  source.onerror = () => {
    if (stopped) return;
    // readyState 2 means the browser gave up: whatever answered at this address isn't the helper (the hosted site has no such page).
    // Anything else, the browser is trying again by itself.
    if (source.readyState === 2) say("error", base ? "The free Frills relay turned the connection down. It may be busy, or too many pages are open from your address." : "The Frills helper isn't answering here. TikTok chat needs it running on this PC.", true);
    else say("helper-lost", base ? "Lost the free Frills relay. This reconnects by itself." : "");
  };
  return {
    stop() {
      stopped = true;
      source.close();
      say("stopped");
    },
  };
}
