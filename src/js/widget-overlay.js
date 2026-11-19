// What every small overlay page does the same way: connect to a TikTok LIVE or Twitch channel for the events it wants,
// say so on the page when something is wrong, and notice a relay that is too old to send them.

import { cleanName, connectTo, statusText } from "./connect.js";
import { relayForPage } from "./tiktok.js";
import { plusCodeFromParams, plusRelayForPage } from "./plus-relay.js";
import { acceptInfo } from "./info.js";

/**
 * Connects and calls `onAlert(event)` for each event of the `events` kinds. `say(text)` shows a note on the page ("" clears it).
 * Supports TikTok LIVE (via relay or helper) and Twitch (anonymous IRC). Returns { stop() }.
 */
export function connectEvents({ channel, platform = "tiktok", events, onAlert, onInfo, onChat, say }) {
  // Chat is not shown here, but an overlay that reads commands from it (song requests) is given each message.
  const noFeed = { add: (m) => onChat?.(m), removeById() {}, removeUser() {}, clear() {} };
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

/** Which streaming platform a query string asks for. */
export const platformFromParams = (params) => (params.get("platform") === "twitch" ? "twitch" : "tiktok");

/** The account named in the address, cleaned for the platform, or "". */
export const channelFromParams = (params, platform = "tiktok") => cleanName(platform === "twitch" ? "twitch" : "tiktok", params.get("channel"));
