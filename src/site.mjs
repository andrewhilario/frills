// What the build knows about the site. Addresses live in site.config.json (committed) so they are never lost between builds;
// a variable of the same name in the environment wins, for a one-off build.

import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../site.config.json", import.meta.url), "utf8"));
const pick = (envName, key) => (process.env[envName] ?? config[key] ?? "").trim();

export const site = {
  name: "Frills",
  url: pick("SITE_URL", "url").replace(/\/+$/, ""),
  // The feedback form on the site itself (a Worker and a D1 database, see worker/). When on, "Feedback" links point at /feedback/.
  feedbackForm: (process.env.FEEDBACK_FORM ?? String(config.feedbackForm ?? "")) === "true" || process.env.FEEDBACK_FORM === "1",
  feedbackUrl: pick("FEEDBACK_URL", "feedbackUrl"),
  waitlistUrl: pick("WAITLIST_URL", "waitlistUrl"),
  // Where the TikTok helper can be downloaded. Empty until it can be: the pages then say there is no download yet, and nothing links nowhere.
  helperUrl: pick("HELPER_URL", "helperUrl"),
  // The shared relay that lets TikTok chat work without installing anything (a capped free beta). Empty means there is none.
  relayUrl: pick("RELAY_URL", "relayUrl").replace(/\/+$/, ""),
  // The code Google Search Console asks for to prove the site is yours (a public tag, not a secret). Empty means no tag.
  googleSiteVerification: pick("GOOGLE_SITE_VERIFICATION", "googleSiteVerification"),
  // The Client ID of the Spotify app used by the private /spotify/ test page. It is public by design (the login uses no secret). Empty means no Spotify.
  spotifyClientId: pick("SPOTIFY_CLIENT_ID", "spotifyClientId"),
  // The Client ID of the Twitch app used by the private /twitch/ page that listens for new followers. Public by design (the login uses no secret). Empty means no Twitch follows.
  twitchClientId: pick("TWITCH_CLIENT_ID", "twitchClientId"),
  tagline: "Free chat overlays with all the frills.",
  description: "Free, customizable chat overlays for live streams. Pick a cute look, tweak every detail, and paste one link into your streaming app. Works with TikTok LIVE and Twitch.",
  tally: { url: "https://valwidgets.live", blurb: "free Valorant rank overlays" },
  year: new Date().getFullYear(),
  // Same policy as Tally: ask AI training crawlers to stay out, and let search and assistant crawlers in.
  trainingCrawlers: ["GPTBot", "ClaudeBot", "anthropic-ai", "CCBot", "Applebot-Extended", "Bytespider", "meta-externalagent", "cohere-ai", "Diffbot"],
};

/** A deploy built from the wrong address would publish canonical links, a sitemap and social cards that point nowhere. */
if (site.feedbackForm && !site.feedbackUrl) site.feedbackUrl = "/feedback/";

export function checkSite() {
  const problems = [];
  if (!/^https:\/\/[^/\s]+$/.test(site.url) || /localhost|127\.0\.0\.1/.test(site.url)) problems.push(`the site address "${site.url}" must be a plain https address`);
  if (site.googleSiteVerification && !/^[A-Za-z0-9_-]{20,100}$/.test(site.googleSiteVerification)) problems.push("googleSiteVerification must be just the code from Google Search Console (letters, numbers, - and _)");
  if (site.spotifyClientId && !/^[a-f0-9]{32}$/.test(site.spotifyClientId)) problems.push("spotifyClientId must be the 32-character Client ID from the Spotify dashboard");
  if (site.twitchClientId && !/^[a-z0-9]{20,40}$/.test(site.twitchClientId)) problems.push("twitchClientId must be the Client ID from the Twitch developer console (lowercase letters and numbers)");
  for (const [name, value] of [["feedbackUrl", site.feedbackForm ? "" : site.feedbackUrl], ["waitlistUrl", site.waitlistUrl], ["helperUrl", site.helperUrl], ["relayUrl", site.relayUrl]]) {
    if (value && !/^https:\/\//.test(value)) problems.push(`${name} must start with https://`);
  }
  return problems;
}
