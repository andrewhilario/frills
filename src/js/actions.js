// Stream Commands & Gear Pop-ups: data structures, defaults, URL encoder/decoder, command matcher, and cooldown tracker.
// 100% zero-account architecture: all configuration lives in the URL parameter (?c=...) and in localStorage.

export const DEFAULT_PREFIX = ".";
export const DEFAULT_PACK = "frog2";
export const DEFAULT_DURATION = 6;
export const DEFAULT_COOLDOWN = 10;
export const DEFAULT_SOUND = "chime";
export const DEFAULT_POSITION = "bottom-right";
/** The most a chat reply can be. TikTok comments are about 150 characters (not confirmed for LIVE chat), so a reply is cut there. */
export const MAX_REPLY = 150;

export const DEFAULT_COMMANDS = [
  { trigger: "mouse", title: "Mouse & Pad", text: "Logitech G Pro X Superlight 2 (800 DPI, Artisan Zero Soft)", icon: "🖱️" },
  { trigger: "sens", title: "In-Game Sensitivity", text: "Valorant: 0.31 @ 800 DPI (248 eDPI) · Fortnite: 6.8%", icon: "🎯" },
  { trigger: "specs", title: "PC Specs", text: "Ryzen 7 7800X3D · RTX 4080 Super · 32GB DDR5-6000", icon: "💻" },
  { trigger: "discord", title: "Discord Community", text: "Join our cozy community! discord.gg/frills", icon: "💬" },
  { trigger: "rank", title: "Rank & Peak", text: "Ascendant 2 (Peak: Immortal 1) · Grinding to Radiant!", icon: "🏆" },
];

export const PACK_MASCOTS = {
  frog2: { name: "Frog Pond", peeker: "/decor/frog2/peeker-a.webp", decor: "/decor/frog2/corner.webp", accent: "#6bb377" },
  neko: { name: "Neko Cafe", peeker: "/decor/neko/peeker-a.webp", decor: "/decor/neko/corner.webp", accent: "#e8927c" },
  bunny: { name: "Bunny Cloud", peeker: "/decor/bunny/peeker-a.webp", decor: "/decor/bunny/corner.webp", accent: "#b39ddb" },
  hamster: { name: "Hamster Burrow", peeker: "/decor/hamster/peeker-a.webp", decor: "/decor/hamster/corner.webp", accent: "#f4a261" },
};

/** Default configuration object */
export function defaultActionsConfig() {
  return {
    prefix: DEFAULT_PREFIX,
    pack: DEFAULT_PACK,
    duration: DEFAULT_DURATION,
    cooldown: DEFAULT_COOLDOWN,
    sound: DEFAULT_SOUND,
    position: DEFAULT_POSITION,
    chat: false, // post the replies in the streamer's TikTok chat. Off until they turn it on
    // The starting commands show sample gear on the card. They have no chat reply, so sample text can never be posted to a real chat.
    commands: DEFAULT_COMMANDS.map((c) => ({ reply: "", ...c })),
  };
}

/** A number typed or stored by a person. The fallback is for a missing or non-numeric value only, so a real 0 (cooldown Off) stays 0. */
function numberOr(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * A trigger as it is kept: lower case and with no spaces. A chat command is the first word of a message, so a trigger with a
 * space in it could never match.
 */
export function cleanTrigger(raw) {
  return String(raw ?? "").toLowerCase().replace(/\s+/g, "");
}

/** A chat reply as it is kept and posted: one line (a chat message has no line breaks), trimmed, and at most MAX_REPLY characters. */
export function cleanReply(raw) {
  const oneLine = String(raw ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return Array.from(oneLine).slice(0, MAX_REPLY).join("").trim();
}

/**
 * Things in a list of commands that stop one from ever popping up: no trigger, or a trigger another command already has
 * (only the first of those fires). Each problem names the command by its place in the list.
 */
export function commandProblems(commands = []) {
  const problems = [];
  const firstSeen = new Map();
  commands.forEach((c, index) => {
    const trigger = cleanTrigger(c?.trigger);
    if (!trigger) {
      problems.push({ kind: "empty", index });
    } else if (firstSeen.has(trigger)) {
      problems.push({ kind: "duplicate", trigger, index, first: firstSeen.get(trigger) });
    } else {
      firstSeen.set(trigger, index);
    }
  });
  return problems;
}

/**
 * Encodes actions configuration into a compact URL-safe base64 string.
 */
export function encodeCommands(config) {
  const compact = {
    p: config.prefix ?? DEFAULT_PREFIX,
    k: config.pack ?? DEFAULT_PACK,
    d: numberOr(config.duration, DEFAULT_DURATION),
    cd: numberOr(config.cooldown, DEFAULT_COOLDOWN),
    s: config.sound ?? DEFAULT_SOUND,
    pos: config.position ?? DEFAULT_POSITION,
    ch: config.chat ? 1 : 0,
    a: (config.commands || []).map((c) => ({
      t: cleanTrigger(c.trigger),
      h: String(c.title || "").trim(),
      d: String(c.text || "").trim(),
      i: String(c.icon || "").trim(),
      r: cleanReply(c.reply),
    })),
  };
  try {
    const json = JSON.stringify(compact);
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  } catch {
    return "";
  }
}

/**
 * Reads the configuration in a link and says how that went:
 *   "none"   the link has no configuration at all
 *   "ok"     it was read (a person may have zero commands, and that is kept)
 *   "broken" there was something but it could not be read, for example a link a chat app cut off
 * Whatever the state, `config` is always usable: for "none" and "broken" it is the starting defaults, so an editor can carry on.
 * An overlay must not show those defaults (sample gear) on a real stream, so it checks `state`.
 */
export function readCommands(b64) {
  const defaults = defaultActionsConfig();
  if (!b64 || typeof b64 !== "string") return { config: defaults, state: "none" };
  try {
    let standard = b64.replace(/-/g, "+").replace(/_/g, "/");
    while (standard.length % 4) standard += "=";
    const binary = atob(standard);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    const raw = JSON.parse(json);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { config: defaults, state: "broken" };

    const prefix = typeof raw.p === "string" ? raw.p : defaults.prefix;
    const pack = PACK_MASCOTS[raw.k] ? raw.k : defaults.pack;
    const duration = Math.max(2, Math.min(30, numberOr(raw.d, defaults.duration)));
    const cooldown = Math.max(0, Math.min(120, numberOr(raw.cd, defaults.cooldown)));
    const sound = typeof raw.s === "string" ? raw.s : defaults.sound;
    const position = typeof raw.pos === "string" ? raw.pos : defaults.position;

    // A list that is there is the person's own, even when it is empty. Only a link with no list gets the starting commands.
    let commands = defaults.commands;
    if (Array.isArray(raw.a)) {
      commands = raw.a
        .filter((c) => c && typeof c === "object" && typeof c.t === "string")
        .map((c) => ({
          trigger: cleanTrigger(c.t),
          title: String(c.h ?? "").trim(),
          text: String(c.d ?? "").trim(),
          icon: String(c.i ?? "").trim(),
          reply: cleanReply(c.r ?? ""),
        }))
        .filter((c) => c.trigger.length > 0);
    }
    return { config: { prefix, pack, duration, cooldown, sound, position, chat: raw.ch === 1, commands }, state: "ok" };
  } catch {
    return { config: defaults, state: "broken" };
  }
}

/**
 * Decodes a URL-safe base64 string into an actions configuration object.
 * Falls back safely to defaults on malformed input (use readCommands to find out whether that happened).
 */
export function decodeCommands(b64) {
  return readCommands(b64).config;
}

/**
 * Matches a chat message text against configured commands.
 * Supports global prefix (e.g. . or !) and per-command custom triggers.
 * Case-insensitive. Returns matched command or null.
 */
export function matchCommand(messageText, commands = [], defaultPrefix = DEFAULT_PREFIX) {
  if (!messageText || typeof messageText !== "string") return null;
  const trimmed = messageText.trim();
  if (!trimmed) return null;

  // Split into first token and remainder
  const firstToken = trimmed.split(/\s+/)[0].toLowerCase();
  const pref = (defaultPrefix || "").toLowerCase();

  for (const cmd of commands) {
    if (!cmd || !cmd.trigger) continue;
    const trig = cmd.trigger.trim().toLowerCase();
    if (!trig) continue;

    // If trigger starts with a punctuation symbol (!, ., ?, /, #, etc.), match directly
    const startsWithSymbol = /^[!./?#~$%&*@^+=:;-]/.test(trig);
    if (startsWithSymbol) {
      if (firstToken === trig) return { ...cmd };
    } else {
      // Normal trigger: prefix + trigger (e.g. .mouse), or the bare word when the prefix is empty
      const expected = pref ? `${pref}${trig}` : trig;
      if (firstToken === expected) return { ...cmd };
    }
  }
  return null;
}

/**
 * Cooldown tracker preventing viewer spam.
 */
export function createCooldownTracker(cooldownSeconds = DEFAULT_COOLDOWN) {
  const lastTriggered = new Map();

  return {
    canTrigger(key) {
      const cdMs = Math.max(0, cooldownSeconds) * 1000;
      if (cdMs === 0) return true;
      const id = String(key || "").toLowerCase();
      const last = lastTriggered.get(id) || 0;
      return Date.now() - last >= cdMs;
    },
    record(key) {
      const id = String(key || "").toLowerCase();
      lastTriggered.set(id, Date.now());
    },
    remaining(key) {
      const cdMs = Math.max(0, cooldownSeconds) * 1000;
      if (cdMs === 0) return 0;
      const id = String(key || "").toLowerCase();
      const last = lastTriggered.get(id) || 0;
      const diff = Date.now() - last;
      if (diff >= cdMs) return 0;
      return Math.ceil((cdMs - diff) / 1000);
    },
    reset() {
      lastTriggered.clear();
    },
  };
}
