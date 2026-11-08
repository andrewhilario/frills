// Stream Commands & Gear Pop-ups: data structures, defaults, URL encoder/decoder, command matcher, and cooldown tracker.
// 100% zero-account architecture: all configuration lives in the URL parameter (?c=...) and in localStorage.

export const DEFAULT_PREFIX = ".";
export const DEFAULT_PACK = "frog2";
export const DEFAULT_DURATION = 6;
export const DEFAULT_COOLDOWN = 10;
export const DEFAULT_SOUND = "chime";
export const DEFAULT_POSITION = "bottom-right";

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
    commands: DEFAULT_COMMANDS.map((c) => ({ ...c })),
  };
}

/**
 * Encodes actions configuration into a compact URL-safe base64 string.
 */
export function encodeCommands(config) {
  const compact = {
    p: config.prefix ?? DEFAULT_PREFIX,
    k: config.pack ?? DEFAULT_PACK,
    d: Number(config.duration) || DEFAULT_DURATION,
    cd: Number(config.cooldown) || DEFAULT_COOLDOWN,
    s: config.sound ?? DEFAULT_SOUND,
    pos: config.position ?? DEFAULT_POSITION,
    a: (config.commands || []).map((c) => ({
      t: String(c.trigger || "").trim(),
      h: String(c.title || "").trim(),
      d: String(c.text || "").trim(),
      i: String(c.icon || "").trim(),
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
 * Decodes a URL-safe base64 string into an actions configuration object.
 * Falls back safely to defaults on malformed input.
 */
export function decodeCommands(b64) {
  const defaults = defaultActionsConfig();
  if (!b64 || typeof b64 !== "string") return defaults;
  try {
    let standard = b64.replace(/-/g, "+").replace(/_/g, "/");
    while (standard.length % 4) standard += "=";
    const binary = atob(standard);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    const raw = JSON.parse(json);
    if (!raw || typeof raw !== "object") return defaults;

    const prefix = typeof raw.p === "string" ? raw.p : defaults.prefix;
    const pack = PACK_MASCOTS[raw.k] ? raw.k : defaults.pack;
    const duration = Math.max(2, Math.min(30, Number(raw.d) || defaults.duration));
    const cooldown = Math.max(0, Math.min(120, Number(raw.cd) || defaults.cooldown));
    const sound = typeof raw.s === "string" ? raw.s : defaults.sound;
    const position = typeof raw.pos === "string" ? raw.pos : defaults.position;

    let commands = defaults.commands;
    if (Array.isArray(raw.a)) {
      commands = raw.a
        .filter((c) => c && typeof c === "object" && typeof c.t === "string" && c.t.trim().length > 0)
        .map((c) => ({
          trigger: String(c.t).trim(),
          title: String(c.h ?? "").trim(),
          text: String(c.d ?? "").trim(),
          icon: String(c.i ?? "").trim(),
        }));
    }
    return { prefix, pack, duration, cooldown, sound, position, commands: commands.length ? commands : defaults.commands };
  } catch {
    return defaults;
  }
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
      // Normal trigger: matches prefix + trigger (e.g. .mouse), or if prefix is empty, bare trigger
      const expected = pref ? `${pref}${trig}` : trig;
      if (firstToken === expected) return { ...cmd };
      // Also allow user typing "!trigger" if defaultPrefix is "." when trigger is common
      if (!pref && firstToken === trig) return { ...cmd };
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
