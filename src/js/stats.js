// Anonymous counting, from the browser. What can be counted is in stats-events.js.
//
// Nothing is stored in the browser except a note that this tab's visit was counted, and nothing identifies anyone: no cookie, no ID, no address. A count is sent to this
// site's own address (/api/e), never to another host. If the browser sends Do Not Track or Global Privacy Control, nothing is sent at all. Counting must never get in
// the way of a page, so every failure is swallowed. This is for the pages with the site's menu and the editors, not for the overlays (they are at their weight cap).

import { encodeEvent, labelsValid, overlayOf, pageOf, refOf } from "./stats-events.js";

const ENDPOINT = "/api/e";

/** The visitor's own setting: Do Not Track or Global Privacy Control means nothing is sent. */
export function optedOut(browser = globalThis.navigator) {
  return browser?.doNotTrack === "1" || browser?.doNotTrack === "yes" || browser?.globalPrivacyControl === true;
}

/** Counts one event. Quietly does nothing for a visitor who opted out, or for labels the list does not allow. */
export function count(event, first, second = "") {
  try {
    if (typeof navigator === "undefined" || !labelsValid(event, first, second) || optedOut()) return;
    const body = encodeEvent(event, first, second);
    if (navigator.sendBeacon?.(ENDPOINT, body)) return;
    void fetch(ENDPOINT, { method: "POST", body, keepalive: true, credentials: "omit" }).catch(() => undefined);
  } catch { /* a counter must never break the page it is counting */ }
}

/** The overlay link was copied on this page (when this page is an editor). */
export function countCopy() {
  const overlay = overlayOf(location.pathname);
  if (overlay) count("link_copied", overlay);
}

let counted = false;
/** A new visit, once per tab session: the page it started on and where it came from. */
function visit() {
  try {
    if (counted || typeof document === "undefined") return;
    counted = true;
    if (sessionStorage.getItem("frills:visit") === "1") return;
    sessionStorage.setItem("frills:visit", "1");
  } catch { /* storage can be blocked: then every page load is a visit, which is only a bit too many */ }
  count("visit", pageOf(location.pathname), refOf(document.referrer, location.host, new URLSearchParams(location.search).get("ref") ?? ""));
}
visit();
