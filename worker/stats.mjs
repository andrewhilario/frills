// Frills' anonymous counts, on the Worker's side. Two kinds, both written to a Workers Analytics Engine dataset (the binding EVENTS in wrangler.jsonc) and kept by
// Cloudflare for three months:
//   - what a page tells us (POST /api/e): a visit or a copied link, checked against the fixed lists in src/js/stats-events.js;
//   - an overlay page opening (GET /overlay/...), counted here so the overlays themselves carry no extra code: the kind of overlay, whether on a real account, and a
//     scrambled code of the account (a one-way hash with a secret salt, STATS_SALT) so that "how many different overlays opened this week" and "how many came back"
//     can be counted. The code cannot be turned back into a name, and without the salt it is not made at all.
// No cookie, no address, no log of requests. A counter must never get in the way of a page, so a failure here is swallowed.

import { loadOf, parseEvent, toDataPoint } from "../src/js/stats-events.js";

const MAX_BODY = 256; // a valid event is under 100 characters, so anything near this is not one

const reply = (status, stored) => new Response(null, { status, headers: { "cache-control": "no-store", ...(stored === undefined ? {} : { "x-counted": stored ? "yes" : "no" }) } });

/** Only this site's own pages may post here: the Origin header has to name the host the request came to. */
function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

/** POST /api/e. `x-counted: yes|no` says whether it was stored, so after a deploy `curl -i` can tell "wired up" from "accepted and dropped". */
export async function handleEvent(request, env) {
  if (request.method !== "POST") return reply(405);
  if (!sameOrigin(request)) return reply(403);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY) return reply(413);
  const text = await request.text();
  if (text.length > MAX_BODY) return reply(413);
  const counted = parseEvent(text);
  if (!counted || counted.event === "overlay_load") return reply(400); // (an overlay opening is counted below, by the Worker: a browser may not claim one)
  let stored = false;
  try {
    if (env?.EVENTS) {
      env.EVENTS.writeDataPoint(toDataPoint(counted));
      stored = true;
    }
  } catch { /* a counter must never turn into an error on somebody's page */ }
  return reply(204, stored);
}

/** A one-way code for `text`: 16 hex characters of SHA-256 over the secret salt and the text. */
export async function scramble(salt, text) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}|${text}`)));
  return [...bytes.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The account an overlay link names ("tiktok:name"), whichever way the link says it, or "" for none. */
export function accountOf(params) {
  const tiktok = (params.get("tiktok") ?? "").trim().toLowerCase();
  const twitch = (params.get("twitch") ?? "").trim().toLowerCase();
  const channel = (params.get("channel") ?? "").trim().toLowerCase();
  const platform = params.get("platform") === "twitch" ? "twitch" : "tiktok";
  if (tiktok) return `tiktok:${tiktok.slice(0, 60)}`;
  if (twitch && !channel) return `twitch:${twitch.slice(0, 60)}`;
  return channel ? `${platform}:${channel.slice(0, 60)}` : "";
}

/** GET /overlay/...: count the opening, then hand the page to the static files exactly as before (whatever happens here). */
export async function countOverlay(request, env) {
  try {
    const url = new URL(request.url);
    const kind = loadOf(url.pathname);
    const optedOut = request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1"; // Do Not Track and Global Privacy Control are honoured here too
    if (kind && request.method === "GET" && env?.EVENTS && !optedOut) {
      const account = url.searchParams.get("demo") === "1" ? "" : accountOf(url.searchParams);
      const id = account && env.STATS_SALT ? await scramble(env.STATS_SALT, account) : "";
      env.EVENTS.writeDataPoint(toDataPoint({ event: "overlay_load", first: kind, second: account ? "live" : "demo" }, id));
    }
  } catch { /* the overlay must open whatever the counter does */ }
  return env.ASSETS.fetch(request);
}
