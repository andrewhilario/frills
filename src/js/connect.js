// Where chat comes from, for the pages that read a real chat: Twitch (straight from the browser) or TikTok (through the Frills helper on
// this PC, or through the shared Frills relay when the site has one). Both give the same callbacks and the same status shape, so the
// editor, the matcha page and the overlay treat them alike.

import { connect as connectTwitch, cleanChannel } from "./twitch.js";
import { cleanTikTokUser, connectTikTok, findTikTokSource } from "./tiktok.js";

export const PLATFORMS = ["tiktok", "twitch"];

/** What a person typed -> a name that platform accepts, or "". */
export const cleanName = (platform, input) => (platform === "tiktok" ? cleanTikTokUser(input) : cleanChannel(input));

/**
 * Sends one account's chat into one or more feeds. Returns the connection: stop() ends it. For TikTok it first looks for where the chat
 * can come from (the helper on this PC, else the site's relay, `relay` being its address); with neither it says so.
 */
export function connectTo(feeds, platform, name, onStatus, { relay = "" } = {}) {
  const list = Array.isArray(feeds) ? feeds : [feeds];
  const handlers = {
    onStatus,
    onMessage: (m) => list.forEach((f) => f.add(m)),
    onRemove: ({ id }) => list.forEach((f) => f.removeById(id)),
    onClear: ({ user }) => list.forEach((f) => (user ? f.removeUser(user) : f.clear())),
  };
  if (platform !== "tiktok") return connectTwitch({ channel: name, ...handlers });

  const login = cleanTikTokUser(name);
  if (!login) return connectTikTok({ user: name, ...handlers }); // says the name is wrong, at once
  let inner = null;
  let stopped = false;
  onStatus?.({ state: "connecting", channel: login, platform: "tiktok" });
  findTikTokSource(relay).then((found) => {
    if (stopped) return;
    if (!found) {
      onStatus?.({ state: "error", channel: login, platform: "tiktok", fatal: true, detail: relay ? "Couldn't reach TikTok chat. The free Frills relay isn't answering right now. Wait a minute and try again." : "TikTok chat needs the Frills helper running on this PC. It isn't answering here." });
      return;
    }
    inner = connectTikTok({ user: name, base: found.base, ...handlers });
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
  connected: (s) => s.detail || (s.platform === "tiktok" ? `Reading ${who(s)}'s LIVE chat` : `Reading chat from ${who(s)}`),
  queued: (s) => (s.position ? `The free relay is full. Waiting for a spot: ${s.position} of ${s.total}…` : "The free relay is full. Waiting for a spot…"),
  offline: (s) => s.detail || `${who(s)} isn't live right now. Waiting for the LIVE to start…`,
  limited: (s) => s.detail || "TikTok's free connection is busy. Trying again in a minute…",
  "helper-lost": (s) => s.detail || "Lost the Frills helper. Start it again and this reconnects by itself.",
  reconnecting: () => "Lost the connection, trying again…",
  error: (s) => s.detail || "Couldn't connect",
  stopped: () => "Disconnected",
};

export const statusText = (s) => (STATUS[s.state] ?? (() => ""))(s);
