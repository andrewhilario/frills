// What every small overlay page does the same way: connect to a TikTok LIVE or Twitch channel for the events it wants,
// say so on the page when something is wrong, and notice a relay that is too old to send them.

import { cleanName, connectTo, statusText } from "./connect.js";
import { relayForPage } from "./tiktok.js";
import { plusCodeFromParams, plusRelayForPage } from "./plus-relay.js";
import { acceptInfo } from "./info.js";

/**
 * Connects and calls `onAlert(event)` for each event of the `events` kinds. `say(text)` shows a note on the page ("" clears it).
 * Supports TikTok LIVE (via relay or helper), Twitch (anonymous IRC), and Both (`both: { tiktok, twitch }`). Returns { stop() }.
 */
export function connectEvents({ channel, platform = "tiktok", both = null, events, onAlert, onInfo, onChat, say }) {
  // Chat is not shown here, but an overlay that reads commands from it (song requests, talking pet) is given each message.
  const noFeed = { add: (m) => onChat?.(m), removeById() {}, removeUser() {}, clear() {} };
  if (both?.tiktok && both?.twitch) {
    const a = connectEvents({ channel: both.tiktok, platform: "tiktok", events, onAlert, onInfo, onChat, say });
    const b = connectEvents({ channel: both.twitch, platform: "twitch", events, onAlert, onChat, say: () => {} });
    return { stop() { a.stop(); b.stop(); } };
  }
  const resolved = platform === "twitch" ? "twitch" : "tiktok";
  let old = false; // the relay we found can only send chat: say so, and keep saying it
  return connectTo([noFeed], resolved, channel, (status) => {
    if (old) return;
    say(status.state === "connected" || status.state === "stopped" ? "" : statusText(status));
  }, {
    relay: resolved === "tiktok" ? relayForPage() : "",
    plusRelay: resolved === "tiktok" ? plusRelayForPage() : "",
    plusCode: resolved === "tiktok" ? plusCodeFromParams() : "",
    keepTrying: true, // an overlay in OBS has no button to press: if the relay is not answering when it opens, it looks again by itself
    events,
    onAlert,
    onInfo: resolved === "tiktok" ? (raw) => { const info = acceptInfo(raw); if (info) onInfo?.(info); } : undefined,
    onFound: resolved === "tiktok" ? (found) => {
      if (found && !found.features.includes("alerts")) {
        old = true;
        say("The Frills relay needs an update before it can send this.");
      }
    } : undefined,
  });
}

/** Both accounts when a link carries `?tiktok=...&twitch=...`, or null. */
export const bothFromParams = (params) => {
  const tiktok = cleanName("tiktok", params.get("tiktok"));
  const twitch = cleanName("twitch", params.get("twitch"));
  return tiktok && twitch ? { tiktok, twitch } : null;
};

/** Which streaming platform a query string asks for. */
export const platformFromParams = (params) => (bothFromParams(params) ? "both" : params.get("platform") === "twitch" ? "twitch" : "tiktok");

/** The account named in the address, cleaned for the platform, or "". */
export const channelFromParams = (params, platform = "tiktok") => {
  const both = bothFromParams(params);
  if (both) return `${both.tiktok}+${both.twitch}`;
  return cleanName(platform === "twitch" ? "twitch" : "tiktok", params.get("channel"));
};
