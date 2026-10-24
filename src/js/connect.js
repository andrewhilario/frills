// Where chat comes from, for the pages that read a real chat: Twitch (straight from the browser) or TikTok (through the Frills helper on
// this PC, or through the shared Frills relay when the site has one). Both give the same callbacks and the same status shape, so the
// editor, the matcha page and the overlay treat them alike.

import { connect as connectTwitch, cleanChannel } from "./twitch.js";
import { cleanTikTokUser, connectTikTok, explainRefusal, findTikTokSource } from "./tiktok.js";

export const PLATFORMS = ["tiktok", "twitch"];

/** What a person typed -> a name that platform accepts, or "". */
export const cleanName = (platform, input) => (platform === "tiktok" ? cleanTikTokUser(input) : cleanChannel(input));

/**
 * Sends one account's chat into one or more feeds. Returns the connection: stop() ends it. For TikTok it first looks for where the chat
 * can come from (the helper on this PC, else the site's relay, `relay` being its address); with neither it says so. With `assumeRelay` the relay is
 * used without asking first.
 */
export function connectTo(feeds, platform, name, onStatus, { relay = "", assumeRelay = false, events = [], onAlert, onInfo, onFound, onFirstMessage } = {}) {
  const list = Array.isArray(feeds) ? feeds : [feeds];
  let sawChat = false;
  const handlers = {
    onStatus,
    onMessage: (m) => {
      if (!sawChat) { sawChat = true; onFirstMessage?.(); }
      list.forEach((f) => f.add(m));
    },
    onRemove: ({ id }) => list.forEach((f) => f.removeById(id)),
    onClear: ({ user }) => list.forEach((f) => (user ? f.removeUser(user) : f.clear())),
  };
  // Twitch sends its alerts (subs, gifted subs, bits, raids) in the same public chat connection, so onAlert simply hears them from there.
  if (platform !== "tiktok") return connectTwitch({ channel: name, ...handlers, onStatus: onStatus && ((s) => onStatus({ ...s, platform: "twitch" })), onEvent: onAlert });

  const login = cleanTikTokUser(name);
  if (!login) return connectTikTok({ user: name, ...handlers }); // says the name is wrong, at once
  let inner = null;
  let stopped = false;
  onStatus?.({ state: "connecting", channel: login, platform: "tiktok" });
  // `assumeRelay` (the chat overlay, which needs nothing but chat) skips the question "what answers here?" when the site's relay is known: it saves a round
  // trip through the tunnel before the stream is even asked for. If the relay is down the stream says so, as it does for any lost connection.
  const looked = assumeRelay && relay ? Promise.resolve({ kind: "relay", base: relay.replace(/\/+$/, ""), features: ["chat"] }) : findTikTokSource(relay);
  looked.then((found) => {
    if (stopped) return;
    onFound?.(found);
    if (!found) {
      onStatus?.({ state: "error", channel: login, platform: "tiktok", fatal: true, detail: relay ? "Couldn't reach TikTok chat. The free Frills relay isn't answering right now. Wait a minute and try again." : "TikTok chat needs the Frills helper running on this PC. It isn't answering here." });
      return;
    }
    inner = connectTikTok({ user: name, base: found.base, events, onAlert, onInfo, retryRefused: true, diagnose: explainRefusal, ...handlers }); // (found a moment ago, so a refusal is only busy or full)
  });
  return {
    stop() {
      stopped = true;
      inner?.stop();
    },
  };
}

const who = (s) => (s.platform === "tiktok" ? `@${s.channel}` : `#${s.channel}`);

const STATUS = {
  connecting: (s) => `Connecting to ${who(s)}…`,
  // Connected is not the same as reading: TikTok accepts a connection to an account that is not LIVE, and then nothing arrives. So for
  // TikTok it says what is true until the first message comes, and the page changes it to "Reading ..." when one does.
  // `wants` is set by the overlays that wait for events other than chat ("follows", "likes"): they say that, not "chat".
  connected: (s) => s.detail || (s.wants && s.platform === "twitch" ? `Reading chat from ${who(s)}. ${s.wants[0].toUpperCase()}${s.wants.slice(1)} show up here when someone does them. They only come while you are live.` : s.wants ? `Connected to TikTok. Waiting for ${s.wants}. They only come while the account is LIVE.` : s.platform === "tiktok" ? "Connected to TikTok. Waiting for the first chat message. Real chat only shows while you are LIVE." : `Reading chat from ${who(s)}`),
  reading: (s) => (s.wants ? `Reading ${who(s)}'s LIVE. ${s.wants[0].toUpperCase()}${s.wants.slice(1)} will show up here.` : `Reading ${who(s)}'s LIVE chat`),
  silent: (s) => (s.wants ? `Nothing has arrived yet. Is the account LIVE right now? Real ${s.wants} only come while it is LIVE and someone does it. If you just went LIVE, press Disconnect and then Connect again.` : "Nothing has arrived yet. Are you LIVE? Real chat only shows while you are LIVE. If you just went LIVE, press Disconnect and then Connect again."),
  queued: (s) => (s.position ? `The free relay is full. Waiting for a spot: ${s.position} of ${s.total}…` : "The free relay is full. Waiting for a spot…"),
  offline: (s) => s.detail || `${who(s)} isn't live right now. Waiting for the LIVE to start…`,
  limited: (s) => s.detail || "TikTok's free connection is busy. Trying again in a minute…",
  "helper-lost": (s) => s.detail || "Lost the Frills helper. Start it again and this reconnects by itself.",
  reconnecting: () => "Lost the connection, trying again…",
  refused: (s) => s.detail || "Trying again…",
  error: (s) => s.detail || "Couldn't connect",
  stopped: () => "Disconnected",
};

export const statusText = (s) => (STATUS[s.state] ?? (() => ""))(s);
