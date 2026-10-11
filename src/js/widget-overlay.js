// What every small overlay page (Last Gifts, Follower Goal) does the same way: connect to a TikTok account for the events it wants,
// say so on the page when something is wrong, and notice a relay that is too old to send them.

import { cleanName, connectTo, statusText } from "./connect.js";
import { relayForPage } from "./tiktok.js";

/**
 * Connects and calls `onAlert(event)` for each event of the `events` kinds. `say(text)` shows a note on the page ("" clears it).
 * Returns { stop() }.
 */
export function connectEvents({ channel, events, onAlert, onInfo, onChat, say }) {
  // Chat is not shown here, but an overlay that reads commands from it (song requests) is given each message.
  const noFeed = { add: (m) => onChat?.(m), removeById() {}, removeUser() {}, clear() {} };
  let old = false; // the relay we found can only send chat: say so, and keep saying it
  return connectTo([noFeed], "tiktok", channel, (status) => {
    if (old) return;
    say(status.state === "connected" || status.state === "stopped" ? "" : statusText(status));
  }, {
    relay: relayForPage(),
    events,
    onAlert,
    onInfo,
    onFound: (found) => {
      if (found && !found.features.includes("alerts")) {
        old = true;
        say("The Frills relay needs an update before it can send this.");
      }
    },
  });
}

/** The account named in the address, cleaned, or "". */
export const channelFromParams = (params) => cleanName("tiktok", params.get("channel"));
