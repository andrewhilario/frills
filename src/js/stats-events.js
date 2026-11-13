// Everything Frills is allowed to count, and nothing else. An event is a name plus up to two short labels, each picked from a fixed list below: there is no free text and
// no number anyone typed, so a count cannot carry a name, a key or an address. The same lists guard both ends: the browser refuses to send anything outside them
// (stats.js) and the Worker refuses to store anything outside them (worker/stats.mjs). It is the same idea as valwidgets.live's counter (and the same event names
// where the meaning is the same: visit, link_copied, overlay_load), so the two sites can be read side by side on the stats page.

/** Where a visit started, in coarse groups. */
export const PAGES = ["home", "editor", "overlays", "alerts", "gifts", "goal", "likers", "counter", "timer", "songs", "matcha", "start", "guides", "other"];
/** Where a visit came from, in coarse groups. The address itself is never kept. "bio" and "ad1" to "ad3" are for links we put in a profile or an ad (?ref=bio, ?ref=ad1). */
export const REFS = ["direct", "tiktok", "reddit", "discord", "youtube", "search", "bio", "ad1", "ad2", "ad3", "other"];
/** The editor a link was copied from. */
export const OVERLAYS = ["chat", "alerts", "gifts", "goal", "likers", "counter", "timer", "songs", "matcha"];
/** The overlay pages that count when they open. */
export const LOADS = ["chat", "alerts", "gifts", "goal", "likers", "counter", "timer", "songs"];
/** Whether an overlay ran on a real account, or on practice events. */
export const MODES = ["live", "demo"];
/** The streaming platforms a link or overlay can be for ("both" when a chat overlay reads TikTok and Twitch together). */
export const PLATFORMS = ["tiktok", "twitch", "both"];
/** The Frills Plus ideas a streamer can click to express interest in. */
export const PLUS_FEATURES = ["remote_link", "custom_upload", "scene_link", "plus_pack"];

export const EVENTS = {
  /** A new visit to the site, once per browser tab session: the page it started on, and where it came from. */
  visit: { first: PAGES, second: REFS },
  /** The overlay link was copied: from which editor, and optionally for which platform. */
  link_copied: { first: OVERLAYS, second: PLATFORMS, optionalSecond: true },
  /** An overlay page opened (OBS, a streaming app, a browser tab): which one, and whether on a real account. Counted by the Worker, with a scrambled code (see scramble). */
  overlay_load: { first: LOADS, second: MODES },
  /** Someone clicked a Frills Plus feature preview or button: which feature, and optionally on which page. */
  plus_interest: { first: PLUS_FEATURES, second: PAGES, optionalSecond: true },
};

const isEventName = (event) => Object.prototype.hasOwnProperty.call(EVENTS, event);

/** Whether `first` and `second` are exactly the labels this event allows. `second` is "" for events that have only one (or where the second is optional and omitted). */
export function labelsValid(event, first, second = "") {
  if (!isEventName(event)) return false;
  const spec = EVENTS[event];
  if (!spec.first.includes(first)) return false;
  if (!spec.second) return second === "";
  if (spec.optionalSecond && second === "") return true;
  return spec.second.includes(second);
}

/** What goes over the wire, for example {"e":"visit","a":"home","b":"tiktok"}. `b` is left out when there is no second label. */
export const encodeEvent = (event, first, second = "") => JSON.stringify(second ? { e: event, a: first, b: second } : { e: event, a: first });

/** Reads a request body. Anything that is not exactly one allowed event, with exactly its allowed labels, is null. */
export function parseEvent(text) {
  let body;
  try { body = JSON.parse(text); } catch { return null; }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  if (Object.keys(body).some((key) => key !== "e" && key !== "a" && key !== "b")) return null;
  const { e, a, b } = body;
  if (typeof e !== "string" || typeof a !== "string") return null;
  if (b !== undefined && typeof b !== "string") return null;
  const second = b ?? "";
  return labelsValid(e, a, second) ? { event: e, first: a, second } : null;
}

/** What is written to Workers Analytics Engine: the event, its labels, (for an overlay opened on a real account) the scrambled code, and the country the request came from (two letters, "" when not known), counted as one. */
export const toDataPoint = ({ event, first, second }, id = "", country = "") => ({ indexes: [event], blobs: [event, first, second, id, country], doubles: [1] });

/** Which platform ("tiktok", "twitch", "both", or "") an overlay link or query string is for. */
export function platformOf(link = "") {
  const text = String(link || "");
  const q = text.indexOf("?");
  const params = new URLSearchParams(q >= 0 ? text.slice(q + 1) : text);
  const tiktok = (params.get("tiktok") ?? "").trim();
  const twitch = (params.get("twitch") ?? "").trim();
  const channel = (params.get("channel") ?? "").trim();
  if (tiktok && twitch) return "both";
  if (tiktok) return "tiktok";
  if (twitch && !channel) return "twitch";
  if (!channel) return "";
  return params.get("platform") === "twitch" ? "twitch" : "tiktok";
}

/** The page group of an address on the site. */
export function pageOf(pathname) {
  const path = String(pathname || "/");
  if (path === "/") return "home";
  if (path.startsWith("/editor")) return "editor";
  if (path.startsWith("/overlays")) return "overlays";
  for (const name of ["alerts", "gifts", "goal", "likers", "counter", "timer", "songs", "matcha", "start"]) if (path.startsWith("/" + name)) return name;
  if (path.startsWith("/guides") || path.startsWith("/looks")) return "guides";
  return "other";
}

/** The editor an address is, for "the link was copied", or "" for a page that has no link to copy. */
export function overlayOf(pathname) {
  const path = String(pathname || "/");
  if (path.startsWith("/matcha/alerts")) return "alerts";
  if (path.startsWith("/editor")) return "chat";
  for (const name of ["alerts", "gifts", "goal", "likers", "counter", "timer", "songs", "matcha"]) if (path.startsWith("/" + name)) return name;
  return "";
}

/** Which overlay page an address is, for the Worker's count ("" for anything else). */
export function loadOf(pathname) {
  const path = String(pathname || "").replace(/\/+$/, "");
  if (path === "/overlay") return "chat";
  const name = /^\/overlay\/([a-z]+)$/.exec(path)?.[1];
  return LOADS.includes(name) ? name : "";
}

/** Where a visit came from: a ?ref= label we put in a link wins, then the page it came from, in coarse groups. */
export function refOf(referrer, host = "", param = "") {
  if (REFS.includes(param) && param !== "other") return param;
  let from = "";
  try { from = new URL(referrer).hostname.toLowerCase(); } catch { /* no referrer */ }
  if (!from || from === String(host).toLowerCase()) return "direct";
  const is = (...names) => names.some((n) => from === n || from.endsWith("." + n));
  if (is("tiktok.com")) return "tiktok";
  if (is("reddit.com", "redd.it")) return "reddit";
  if (is("discord.com", "discordapp.com")) return "discord";
  if (is("youtube.com", "youtu.be")) return "youtube";
  if (/(^|\.)(google|bing|duckduckgo|yahoo|ecosia|brave|startpage)\./.test(from)) return "search";
  return "other";
}
