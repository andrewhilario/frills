// Quick start: a few answers become a set of ready links, one for each overlay, all in the same style. Pure code (no page), so it is tested
// without a browser. The page that asks the questions is start.js.

/** The overlays, the address a streaming app opens, the editor that fine-tunes it, and whether it works on Twitch. */
export const OVERLAYS = [
  { id: "chat", name: "Chat", blurb: "Your chat as speech bubbles.", overlay: "/overlay/", editor: "/editor/", twitch: true },
  { id: "alerts", name: "Alerts", blurb: "A pop-up for each follow, gift or share.", overlay: "/overlay/alerts/", editor: "/alerts/", twitch: true },
  { id: "gifts", name: "Last gifts", blurb: "A list of your most recent gifts.", overlay: "/overlay/gifts/", editor: "/gifts/", twitch: false },
  { id: "goal", name: "Goals", blurb: "A bar that fills as you gain followers, gifts or likes.", overlay: "/overlay/goal/", editor: "/goal/", twitch: false },
  { id: "likers", name: "Top likers", blurb: "A live ranking of who taps the heart the most.", overlay: "/overlay/likers/", editor: "/likers/", twitch: false },
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
 * Everything the result page shows. `answers`: { platform: "tiktok" | "twitch", channel (already cleaned, or ""), overlays: ["chat", ...],
 * vibe, shape, align }. `origin` is the site's address. For each chosen overlay (and only those that work on the chosen platform):
 *   url      the link to paste into a streaming app ("" until there is a name)
 *   editUrl  the editor, opened with the same look and name, to fine-tune it
 *   preview  the overlay in practice mode with the same look, for a picture of it on the page
 */
export function buildLinks(origin, answers) {
  const platform = answers.platform === "twitch" ? "twitch" : "tiktok";
  const vibe = vibeOf(answers.vibe);
  const shape = SHAPES[answers.shape] ?? SHAPES.vertical;
  const align = ALIGNS.some(([id]) => id === answers.align) ? answers.align : "left";
  const chosen = new Set(answers.overlays ?? []);
  return overlaysFor(platform).filter((o) => chosen.has(o.id)).map((o) => {
    const look = new URLSearchParams(o.id === "chat" ? vibe.chat : vibe.widgets);
    if (align !== "left") look.set("align", align);
    const query = (...first) => {
      const params = new URLSearchParams();
      for (const [key, value] of first) if (value) params.set(key, value);
      for (const [key, value] of look) params.set(key, value);
      return params.toString();
    };
    const withName = query(["channel", answers.channel], ["platform", answers.channel ? platform : ""]);
    // chat in a Matcha style is fine-tuned on the Matcha page, which has its own looks
    const editor = o.id === "chat" && look.has("style") ? "/matcha/" : o.editor;
    const previewMore = o.id === "alerts" ? [["platform", platform]] : o.id === "chat" ? [] : [["pace", "1100"]];
    return {
      id: o.id,
      name: o.name,
      blurb: o.blurb,
      url: answers.channel ? `${origin}${o.overlay}?${withName}` : "",
      editUrl: `${origin}${editor}?${withName}`,
      preview: `${origin}${o.overlay}?${query(["demo", "1"], ...previewMore)}`,
      size: shape.size,
      note: noteFor(o.id, platform),
    };
  });
}

function noteFor(id, platform) {
  if (id === "alerts" && platform === "twitch") return "Twitch subs, gifted subs, cheers and raids work with this link. Follow alerts need one extra login: open this overlay in the editor and press the Twitch login button.";
  if (id === "goal") return "The follower goal starts from your real follower count once you are LIVE.";
  return "";
}

/** All the links as plain text, for one copy: "Chat: https://...". */
export function linksText(links) {
  return links.filter((l) => l.url).map((l) => `${l.name}: ${l.url}`).join("\n");
}
