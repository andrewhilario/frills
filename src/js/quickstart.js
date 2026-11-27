// Quick start: a few answers become a set of ready links, one for each overlay, all in the same style. Pure code (no page), so it is tested
// without a browser. The page that asks the questions is start.js.

/** The overlays, the address a streaming app opens, the editor that fine-tunes it, and platform support (`twitch`, `both`). */
export const OVERLAYS = [
  { id: "chat", name: "Chat", blurb: "Your chat as speech bubbles.", overlay: "/overlay/", editor: "/editor/", twitch: true, both: true },
  { id: "alerts", name: "Alerts", blurb: "A pop-up for TikTok follows, gifts & shares and Twitch subs, bits, raids & follows.", overlay: "/overlay/alerts/", editor: "/alerts/", twitch: true, both: true },
  { id: "gifters", name: "Top gifters", blurb: "A live ranking of top diamond gifters, sub gifters or bit senders.", overlay: "/overlay/gifters/", editor: "/gifters/", twitch: true, both: true },
  { id: "labels", name: "Rotating highlights", blurb: "Cycles through your last gift, follower, sub, bits and top supporters.", overlay: "/overlay/labels/", editor: "/labels/", twitch: true, both: true },
  { id: "wheel", name: "Spin the wheel", blurb: "A prize or dare wheel viewers spin with TikTok gifts, Twitch bits or subs.", overlay: "/overlay/wheel/", editor: "/wheel/", twitch: true, both: true },
  { id: "gifts", name: "Last gifts", blurb: "A live feed of your recent TikTok gifts and Twitch subs, bits and raids.", overlay: "/overlay/gifts/", editor: "/gifts/", twitch: true, both: true },
  { id: "jar", name: "Gift jar", blurb: "Watch TikTok gifts or Twitch bits & subs tumble into a themed jar until it is full.", overlay: "/overlay/jar/", editor: "/jar/", twitch: true, both: true },
  { id: "gallery", name: "Gift gallery rotator", blurb: "Rotates through featured TikTok gifts and lights them up when sent.", overlay: "/overlay/gallery/", editor: "/gallery/", twitch: false, both: false },
  { id: "goal", name: "Goals", blurb: "A bar that fills with followers, TikTok gifts/likes, or Twitch subs & bits.", overlay: "/overlay/goal/", editor: "/goal/", twitch: true, both: true },
  { id: "likers", name: "Top likers", blurb: "A live ranking of who taps the heart the most.", overlay: "/overlay/likers/", editor: "/likers/", twitch: false, both: false },
  { id: "songs", name: "Song requests", blurb: "Viewers type !sr in TikTok or Twitch chat to add songs to your queue.", overlay: "/overlay/songs/", editor: "/songs/", twitch: true, both: true },
  { id: "timer", name: "Subathon timer", blurb: "A countdown clock that grows with TikTok gifts or Twitch subs & bits.", overlay: "/overlay/timer/", editor: "/timer/", twitch: true, both: true },
  { id: "tts", name: "Talking pet TTS", blurb: "An animated pet reads TikTok gifts, Twitch bits/subs and !say messages aloud.", overlay: "/overlay/tts/", editor: "/tts/", twitch: true, both: true },
  { id: "counter", name: "Viewer and like counter", blurb: "How many are watching and how many likes your LIVE has.", overlay: "/overlay/counter/", editor: "/counter/", twitch: false, both: false },
];

/**
 * The five looks that every overlay has, each as the options a link carries: `chat` for the chat overlay, `widgets` for the others (the
 * alerts, last gifts, goals and top likers share one set of looks). `swatch` is its background, accent and text color, to show on the card.
 */
export const VIBES = [
  { id: "pink", name: "Cute and pink", blurb: "Soft pink bubbles, with cats peeking over them.", chat: "look=bubblegum&deco=neko", widgets: "look=bubblegum", swatch: ["#1a0a1f", "#ff5fc8", "#fff0fa"] },
  { id: "green", name: "Cozy and green", blurb: "Matcha green, with a frog on a lily pad.", chat: "style=latte&palette=latte&deco=frog", widgets: "look=matcha", swatch: ["#f5f0e1", "#8dae5f", "#33432a"] },
  { id: "night", name: "Dark and gamer", blurb: "Deep blue and sharp, easy to read over a game.", chat: "look=blueberry", widgets: "look=night", swatch: ["#10131a", "#9db4ff", "#f4f6fa"] },
  { id: "arcade", name: "Retro arcade", blurb: "Pixel letters on dark blue, in neon green.", chat: "look=arcade", widgets: "look=arcade", swatch: ["#101a2e", "#59ffa0", "#e8f6ff"] },
  { id: "sunny", name: "Sunny and bold", blurb: "Bright yellow with thick outlines.", chat: "look=butter", widgets: "look=sticker", swatch: ["#ffe066", "#2b1d00", "#fff6d6"] },
];

export const SHAPES = {
  vertical: { name: "A phone LIVE", size: "1080 × 1920", hint: "tall, for TikTok LIVE from a phone" },
  landscape: { name: "A PC stream", size: "1920 × 1080", hint: "wide, for Twitch or a PC" },
};
export const ALIGNS = [["left", "Left"], ["center", "Center"], ["right", "Right"]];

const find = (list, id) => list.find((item) => item.id === id);
export const vibeOf = (id) => find(VIBES, id) ?? VIBES[0];
export const overlaysFor = (platform) => OVERLAYS.filter((o) => platform !== "twitch" || o.twitch);

/**
 * Everything the result page shows. `answers`: { platform: "tiktok" | "twitch" | "both", channel (already cleaned, or ""), twitch (the
 * Twitch channel, cleaned, only when the platform is "both": then `channel` is the TikTok name), overlays: ["chat", ...], vibe, shape,
 * align }. `origin` is the site's address. For each chosen overlay (and only those that work on the chosen platform):
 *   url      the link to paste into a streaming app ("" until there is a name)
 *   editUrl  the editor, opened with the same look and name, to fine-tune it
 *   preview  the overlay in practice mode with the same look, for a picture of it on the page
 *   needs    which accounts the link has to name: ["tiktok"], ["twitch"] or both
 * With "both", the chat is one overlay that reads the two accounts together, the alerts are two (one for each platform), and the rest
 * (last gifts, goals, top likers) are TikTok's.
 */
export function buildLinks(origin, answers) {
  const platform = answers.platform === "twitch" || answers.platform === "both" ? answers.platform : "tiktok";
  const both = platform === "both";
  const names = both ? { tiktok: answers.channel ?? "", twitch: answers.twitch ?? "" } : { [platform]: answers.channel ?? "" };
  const vibe = vibeOf(answers.vibe);
  const shape = SHAPES[answers.shape] ?? SHAPES.vertical;
  const align = ALIGNS.some(([id]) => id === answers.align) ? answers.align : "left";
  const chosen = new Set(answers.overlays ?? []);

  // one entry for each link: dual-platform overlays with `both: true` produce one unified ?tiktok=...&twitch=... link in Both mode
  const entries = [];
  for (const o of overlaysFor(platform).filter((o) => chosen.has(o.id))) {
    if (!both) entries.push({ o, id: o.id, name: o.name, platform });
    else if (o.both) entries.push({ o, id: o.id, name: o.name, platform: "both" });
    else if (o.twitch) entries.push({ o, id: `${o.id}-tiktok`, name: `${o.name} (TikTok)`, platform: "tiktok" }, { o, id: `${o.id}-twitch`, name: `${o.name} (Twitch)`, platform: "twitch" });
    else entries.push({ o, id: o.id, name: o.name, platform: "tiktok" });
  }

  return entries.map(({ o, id, name, platform: reads }) => {
    const look = new URLSearchParams(o.id === "chat" ? vibe.chat : vibe.widgets);
    if (align !== "left") look.set("align", align);
    const query = (...first) => {
      const params = new URLSearchParams();
      for (const [key, value] of first) if (value) params.set(key, value);
      for (const [key, value] of look) params.set(key, value);
      return params.toString();
    };
    const needs = reads === "both" ? ["tiktok", "twitch"] : [reads];
    const ready = needs.every((p) => names[p]);
    const withName = reads === "both"
      ? query(["tiktok", names.tiktok], ["twitch", names.twitch])
      : query(["channel", names[reads]], ["platform", names[reads] ? reads : ""]);
    // chat in a Matcha style is fine-tuned on the Matcha page, which has its own looks
    const editor = o.id === "chat" && look.has("style") ? "/matcha/" : o.editor;
    const previewMore = reads === "both"
      ? (o.id === "chat" ? [["tiktok", "demo"], ["twitch", "demo"]] : [["tiktok", "demo"], ["twitch", "demo"], ["pace", "1100"]])
      : (o.id === "alerts" || o.id === "gifters" || o.id === "labels" || o.id === "wheel" || o.id === "gifts" || o.id === "jar" || o.id === "goal" || o.id === "timer" || o.id === "tts" || o.id === "songs")
        ? [["platform", reads]]
        : o.id === "chat" ? [] : [["pace", "1100"]];
    return {
      id,
      name,
      blurb: o.blurb,
      url: ready ? `${origin}${o.overlay}?${withName}` : "",
      editUrl: `${origin}${editor}?${withName}`,
      preview: `${origin}${o.overlay}?${query(["demo", "1"], ...previewMore)}`,
      size: shape.size,
      note: noteFor(o.id, reads),
      needs,
    };
  });
}

function noteFor(id, reads) {
  if (id === "chat" && reads === "both") return "One chat for both: TikTok and Twitch messages arrive together, each with a small icon so you can tell them apart. The editor can turn the icon off.";
  if (id === "alerts" && (reads === "twitch" || reads === "both")) return "Twitch subs, gifted subs, cheers and raids work with this link. Follow alerts need one extra login: open this overlay in the editor and press the Twitch login button.";
  if (id === "labels" && (reads === "twitch" || reads === "both")) return "Twitch subs, bits, top sub gifter and top bit sender work with this link. Last follower needs one extra login: open this overlay in the editor and press the Twitch login button.";
  if (id === "gifters" && reads === "both") return "Ranks TikTok gift diamonds, Twitch gifted subs and bit cheers together in one leaderboard.";
  if (id === "gifters" && reads === "twitch") return "Ranks gifted subs, bit cheers, or both together in the editor.";
  if (id === "wheel") return "Open the editor to customize your wheel slices and pick whether gifts, bits or a spin meter trigger it.";
  if (id === "gallery") return "Open the editor to choose your featured TikTok gifts and optional reward captions.";
  if (id === "goal") return reads === "twitch" ? "Open the editor to choose a Twitch sub, bits, or follower goal and set your milestone reward." : "The follower goal starts from your real follower count once you are LIVE.";
  if (id === "timer") return "Open this overlay in the editor to press Start, Pause or add time during your stream.";
  if (id === "songs") return "Viewers type !sr and a song name in chat. Open the editor if you also want to connect Spotify.";
  return "";
}

/** All the links as plain text, for one copy: "Chat: https://...". */
export function linksText(links) {
  return links.filter((l) => l.url).map((l) => `${l.name}: ${l.url}`).join("\n");
}
