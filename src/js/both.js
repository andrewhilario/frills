// Chat from TikTok and Twitch at once. One chat overlay can read both accounts into the same feed. What that needs, kept apart from the pages:
//   - which accounts a link names (a new link says tiktok= and/or twitch=; an older one says channel= and platform=)
//   - each platform's messages marked as its own, so a delete, a timeout or a clear on one platform never touches the other's
//   - one line for the status note when two connections each have a state of their own

import { cleanTikTokUser } from "./tiktok.js";
import { cleanChannel } from "./twitch.js";

export const PLATFORM_NAMES = { tiktok: "TikTok", twitch: "Twitch" };

/** The accounts a chat link names, in a fixed order: [{ platform, channel }], one or two. An address with nothing usable gives []. */
export function sourcesOf(params) {
  const tiktok = cleanTikTokUser(params.get("tiktok"));
  const twitch = cleanChannel(params.get("twitch"));
  if (tiktok || twitch) return [tiktok && { platform: "tiktok", channel: tiktok }, twitch && { platform: "twitch", channel: twitch }].filter(Boolean);
  const platform = params.get("platform") === "tiktok" ? "tiktok" : "twitch"; // an older link: one account, and Twitch unless it says otherwise
  const channel = platform === "tiktok" ? cleanTikTokUser(params.get("channel")) : cleanChannel(params.get("channel"));
  return channel ? [{ platform, channel }] : [];
}

/**
 * A view of one feed for one platform's connection. Messages go in marked with their platform, and their ids and people carry it too
 * ("twitch:abc"), so the same name on both platforms is two different people and a delete only finds its own platform's message.
 */
export function scoped(feed, platform) {
  const mark = (value) => (value ? `${platform}:${value}` : "");
  return {
    add: (m) => feed.add({ ...m, platform, id: mark(m.id), user: mark(m.user) }),
    removeById: (id) => feed.removeById(mark(id)),
    removeUser: (user) => feed.removeUser(mark(user)),
    clear: () => feed.clearWhere(platform),
  };
}

/**
 * Practice chat for two platforms: the made-up messages take turns being TikTok's and Twitch's, except gifts and the gifter dot, which only TikTok
 * has (a rose is a TikTok gift), so those always belong to TikTok. `tiktok` and `twitch` are the two scoped views of a feed; `clear` clears it.
 */
export function takingTurns(tiktok, twitch, clear = () => {}) {
  let turn = 0;
  return {
    add: (m) => (m.gift || turn++ % 2 === 0 ? tiktok.add(m) : twitch.add({ ...m, gifter: false })),
    removeById() {},
    removeUser() {},
    clear,
  };
}

/**
 * One line about two connections: "" when each is fine, else what is wrong, with the platform named ("TikTok: waiting for a spot · Twitch:
 * connecting"). `parts` is the latest status of each ({ tiktok, twitch }), `text` turns a status into words.
 */
export function noteFor(parts, text) {
  const lines = [];
  for (const platform of ["tiktok", "twitch"]) {
    const status = parts[platform];
    if (!status || status.state === "connected" || status.state === "stopped") continue;
    lines.push(`${PLATFORM_NAMES[platform]}: ${text(status)}`);
  }
  return lines.join(" · ");
}
