// OBS & Stream Actions ("When → Do" rule engine): 10 free actions, unlimited with Frills Plus.
// Supports chat commands (!clip, !replay, !anything with role gates), TikTok gifts/follows/shares/likes,
// Twitch subs/gifted subs/bits/raids -> OBS Replay Buffer clips, Replay Cam, scene switching, source toggles,
// filters, audio mute, media playback, text updates, hotkeys, plus Frills sounds, banners, and timed delays.
// Pure logic & URL encoding so it is unit-tested without a browser.

import { defineWidget, number, range, selectOf, text, toggle } from "./widget-settings.js";
import { SOUNDS } from "./alerts-settings.js";
import { HEX } from "./color.js";
import { cleanObsPort } from "./obs-ws.js";
import { cleanSlobsPort } from "./slobs-ws.js";
import { cleanVtsPort, renderStickyNoteBase64 } from "./vts-ws.js";

/** Free visitors get up to 10 actions & up to 5 live VTS sticky notes at once with no account; Frills Plus unlocks unlimited. */
export const FREE_ACTIONS_LIMIT = 10;
export const FREE_STICKY_NOTES_LIMIT = 5;
export const PLUS_ACTIONS_LIMIT = 100;
export const MAX_STEPS_PER_RULE = 5;
export const MAX_ACTION_QUEUE = 12;

export const ACTION_TRIGGERS = [
  ["command", "Chat command (!word)"],
  ["gift", "TikTok gift"],
  ["follow", "New follower"],
  ["share", "TikTok share"],
  ["like", "TikTok likes (every N)"],
  ["sub", "Twitch sub"],
  ["subgift", "Twitch gifted subs"],
  ["bits", "Twitch bits"],
  ["raid", "Twitch raid"],
];

export const COMMAND_ROLES = [
  ["everyone", "Anyone in chat"],
  ["mods", "Mods & streamer"],
  ["host", "Streamer only"],
];

export const ACTION_TYPES = [
  ["obs.clip", "OBS · Save clip (Replay Buffer)"],
  ["obs.replay", "OBS · Instant replay cam"],
  ["obs.scene", "OBS · Switch scene"],
  ["obs.source", "OBS · Show / hide source"],
  ["obs.filter", "OBS · Toggle filter"],
  ["obs.mute", "OBS · Mute / unmute audio"],
  ["obs.media", "OBS · Play media source"],
  ["obs.text", "OBS · Update text source"],
  ["obs.hotkey", "OBS · Trigger hotkey"],
  ["vts.sticky", "VTube Studio · Sticky note with gifter’s name (5 free · ∞ Plus)"],
  ["vts.hotkey", "VTube Studio · Hotkey / Item Scene (Plus)"],
  ["vts.item", "VTube Studio · Drop item / prop (Plus)"],
  ["vts.expression", "VTube Studio · Toggle expression (Plus)"],
  ["vts.move", "VTube Studio · Zoom / flip avatar (Plus)"],
  ["vts.tint", "VTube Studio · Color tint avatar (Plus)"],
  ["frills.sound", "Overlay · Play sound"],
  ["frills.banner", "Overlay · Show banner"],
  ["flow.wait", "Flow · Wait (seconds)"],
];

export const VTS_STICKY_SHAPES = [
  ["note", "Pastel sticky note (Free)"],
  ["heart", "Heart sticker (Plus)"],
  ["star", "Star tag (Plus)"],
  ["paw", "Chibi paw stamp (Plus)"],
  ["cloud", "Dreamy cloud (Plus)"],
  ["random", "Random sticker shape (Plus)"],
];

export const VTS_STICKY_COLORS = [
  ["yellow", "Classic yellow"],
  ["pink", "Sakura pink"],
  ["mint", "Matcha mint"],
  ["blue", "Sky blue"],
  ["lavender", "Lavender"],
  ["random", "Random pastel"],
];

export const VTS_STICKY_PIN_MODES = [
  ["face", "Stick across face (follows head)"],
  ["center", "Stick to face center (follows head)"],
  ["random", "Scatter anywhere on avatar"],
  ["screen", "Float on screen (unpinned)"],
];

export const VTS_MOVE_PRESETS = [
  ["zoom", "Face zoom in"],
  ["flip", "Flip upside down"],
  ["tilt", "Dramatic head tilt"],
  ["shrink", "Tiny mini avatar"],
];

export const isVtsStep = (step) => Boolean(step?.type?.startsWith("vts."));
export const isFreeVtsStep = (step) => step?.type === "vts.sticky";
export const isPlusVtsStep = (step) => isVtsStep(step) && !isFreeVtsStep(step);
export const isPlusStickyShape = (shape) => Boolean(shape && shape !== "note");
export const hasVtsSteps = (rules) => (rules ?? []).some((r) => r?.enabled !== false && (r.steps ?? []).some(isVtsStep));
export const hasFreeVtsSteps = (rules) => (rules ?? []).some((r) => r?.enabled !== false && (r.steps ?? []).some(isFreeVtsStep));
export const hasPlusVtsSteps = (rules) => (rules ?? []).some((r) => r?.enabled !== false && (r.steps ?? []).some(isPlusVtsStep));
export const hasPlusStickyShape = (rules) => (rules ?? []).some((r) => r?.enabled !== false && (r.steps ?? []).some((s) => s?.type === "vts.sticky" && isPlusStickyShape(s.shape)));

export const BANNER_FX = [
  ["none", "No effect"],
  ["sparkles", "Sparkles"],
  ["confetti", "Confetti"],
  ["hearts", "Hearts"],
];

const TRIGGER_IDS = new Set(ACTION_TRIGGERS.map(([id]) => id));
const ROLE_IDS = new Set(COMMAND_ROLES.map(([id]) => id));
const TYPE_IDS = new Set(ACTION_TYPES.map(([id]) => id));
const SOUND_IDS = new Set(SOUNDS.map((s) => s.id));
const FX_IDS = new Set(BANNER_FX.map(([id]) => id));

const cleanStr = (v, max = 60) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
const clampInt = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
export const cleanCommandWord = (raw, fallback = "clip") =>
  String(raw ?? "").toLowerCase().replace(/^!+/, "").replace(/[^a-z0-9_-]/g, "").slice(0, 20) || fallback;

/** Starter templates streamers can drop in with one click. */
export const ACTION_STARTERS = [
  {
    id: "clip",
    chip: "+ !clip",
    rule: {
      name: "Save a clip",
      enabled: true,
      cooldownSec: 15,
      queue: true,
      trigger: { kind: "command", command: "clip", who: "mods" },
      steps: [
        { type: "obs.clip", toast: "Clip saved · {name}" },
        { type: "frills.sound", sound: "pop", volume: 70 },
      ],
    },
  },
  {
    id: "replay",
    chip: "+ !replay",
    rule: {
      name: "Instant replay cam",
      enabled: true,
      cooldownSec: 20,
      queue: true,
      trigger: { kind: "command", command: "replay", who: "mods" },
      steps: [
        { type: "obs.replay", source: "Frills Replay Cam", speed: 100, saveFirst: true, maxSec: 20, badge: "REPLAY" },
      ],
    },
  },
  {
    id: "gift-replay",
    chip: "+ Gift → Replay",
    rule: {
      name: "Gift slow-mo replay",
      enabled: true,
      cooldownSec: 20,
      queue: true,
      trigger: { kind: "gift", giftName: "", minDiamonds: 100 },
      steps: [
        { type: "obs.replay", source: "Frills Replay Cam", speed: 75, saveFirst: true, maxSec: 25, badge: "SLOW-MO REPLAY" },
      ],
    },
  },
  {
    id: "mute-mic",
    chip: "+ Mute mic",
    rule: {
      name: "Mute mic for 10s",
      enabled: true,
      cooldownSec: 30,
      queue: true,
      trigger: { kind: "gift", giftName: "Rose", minDiamonds: 1 },
      steps: [
        { type: "obs.mute", source: "Mic/Aux", mode: "mute", duration: 10 },
        { type: "frills.banner", title: "Mic muted!", text: "{name} muted the mic for 10s", seconds: 4, fx: "sparkles" },
      ],
    },
  },
  {
    id: "switch-scene",
    chip: "+ Switch scene",
    rule: {
      name: "Switch scene (10s)",
      enabled: true,
      cooldownSec: 20,
      queue: true,
      trigger: { kind: "gift", giftName: "", minDiamonds: 50 },
      steps: [
        { type: "obs.scene", scene: "Zoom Cam", duration: 10 },
      ],
    },
  },
  {
    id: "webcam-filter",
    chip: "+ Cam filter",
    rule: {
      name: "Webcam filter (10s)",
      enabled: true,
      cooldownSec: 15,
      queue: true,
      trigger: { kind: "gift", giftName: "", minDiamonds: 20 },
      steps: [
        { type: "obs.filter", source: "Webcam", filter: "Blur", mode: "on", duration: 10 },
      ],
    },
  },
  {
    id: "play-media",
    chip: "+ Meme video",
    rule: {
      name: "Play meme video",
      enabled: true,
      cooldownSec: 15,
      queue: true,
      trigger: { kind: "gift", giftName: "", minDiamonds: 10 },
      steps: [
        { type: "obs.media", scene: "", source: "Meme Video", hideOnEnd: true, maxSec: 15 },
      ],
    },
  },
  {
    id: "hype-banner",
    chip: "+ !hype banner",
    rule: {
      name: "Hype banner & sound",
      enabled: true,
      cooldownSec: 10,
      queue: false,
      trigger: { kind: "command", command: "hype", who: "everyone" },
      steps: [
        { type: "frills.banner", title: "HYPE!", text: "{name} dropped the hype!", seconds: 4, fx: "confetti" },
        { type: "frills.sound", sound: "fanfare", volume: 75 },
      ],
    },
  },
  {
    id: "vts-sticky",
    chip: "+ VTS Sticky note",
    rule: {
      name: "Sticky note with name (VTS)",
      enabled: true,
      cooldownSec: 5,
      queue: true,
      trigger: { kind: "gift", giftName: "", minDiamonds: 100 },
      steps: [
        { type: "vts.sticky", title: "{name}", subtitle: "{gift}", shape: "note", color: "random", pinMode: "face", artMesh: "", size: 22, rotation: -6, duration: 0 },
        { type: "frills.sound", sound: "pop", volume: 75 },
      ],
    },
  },
  {
    id: "vts-zoom",
    chip: "+ VTS Face zoom",
    rule: {
      name: "Avatar face zoom (VTS)",
      enabled: true,
      cooldownSec: 20,
      queue: true,
      trigger: { kind: "bits", minBits: 100 },
      steps: [
        { type: "vts.move", preset: "zoom", duration: 8 },
      ],
    },
  },
];

export const DEFAULT_RULES = [
  { id: "r1", ...ACTION_STARTERS[0].rule },
  { id: "r2", ...ACTION_STARTERS[1].rule },
];

/** Normalizes one action step against its `type`. */
export function sanitizeStep(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const type = TYPE_IDS.has(s.type) ? s.type : "obs.clip";
  if (type === "obs.clip") {
    return { type, toast: cleanStr(s.toast ?? "Clip saved · {name}", 80) };
  }
  if (type === "obs.replay") {
    return {
      type,
      source: cleanStr(s.source ?? "Frills Replay Cam", 60) || "Frills Replay Cam",
      speed: clampInt(s.speed, 25, 150, 100),
      saveFirst: s.saveFirst !== false,
      maxSec: clampInt(s.maxSec, 5, 60, 20),
      badge: cleanStr(s.badge ?? "REPLAY", 32) || "REPLAY",
    };
  }
  if (type === "obs.scene") {
    return { type, scene: cleanStr(s.scene ?? "", 60), duration: clampInt(s.duration, 0, 300, 0) };
  }
  if (type === "obs.source") {
    const mode = ["show", "hide", "toggle"].includes(s.mode) ? s.mode : "show";
    return { type, scene: cleanStr(s.scene ?? "", 60), source: cleanStr(s.source ?? "", 60), mode, duration: clampInt(s.duration, 0, 300, 10) };
  }
  if (type === "obs.filter") {
    const mode = ["on", "off", "toggle"].includes(s.mode) ? s.mode : "on";
    return { type, source: cleanStr(s.source ?? "", 60), filter: cleanStr(s.filter ?? "", 60), mode, duration: clampInt(s.duration, 0, 300, 10) };
  }
  if (type === "obs.mute") {
    const mode = ["mute", "unmute", "toggle"].includes(s.mode) ? s.mode : "mute";
    return { type, source: cleanStr(s.source ?? "Mic/Aux", 60), mode, duration: clampInt(s.duration, 0, 300, 10) };
  }
  if (type === "obs.media") {
    return { type, scene: cleanStr(s.scene ?? "", 60), source: cleanStr(s.source ?? "", 60), hideOnEnd: s.hideOnEnd !== false, maxSec: clampInt(s.maxSec, 3, 120, 15) };
  }
  if (type === "obs.text") {
    return { type, source: cleanStr(s.source ?? "", 60), text: cleanStr(s.text ?? "{name}: {text}", 140) };
  }
  if (type === "obs.hotkey") {
    return { type, hotkey: cleanStr(s.hotkey ?? "", 80) };
  }
  if (type === "vts.sticky") {
    const shape = VTS_STICKY_SHAPES.some(([id]) => id === s.shape) ? s.shape : "note";
    const color = VTS_STICKY_COLORS.some(([id]) => id === s.color) ? s.color : "random";
    const pinMode = VTS_STICKY_PIN_MODES.some(([id]) => id === s.pinMode) ? s.pinMode : "face";
    return {
      type,
      title: cleanStr(s.title ?? "{name}", 48) || "{name}",
      subtitle: cleanStr(s.subtitle ?? "{gift}", 48),
      shape,
      color,
      pinMode,
      artMesh: cleanStr(s.artMesh ?? "", 80),
      size: clampInt(s.size, 12, 60, 22),
      rotation: clampInt(s.rotation, -45, 45, -6),
      duration: clampInt(s.duration, 0, 300, 0),
    };
  }
  if (type === "vts.hotkey") {
    return { type, hotkey: cleanStr(s.hotkey ?? "", 80), duration: clampInt(s.duration, 0, 300, 30) };
  }
  if (type === "vts.item") {
    return {
      type,
      fileName: cleanStr(s.fileName ?? "", 80),
      size: clampInt(s.size, 10, 100, 32),
      posX: clampInt(s.posX, -100, 100, 0),
      posY: clampInt(s.posY, -100, 100, 15),
      rotation: clampInt(s.rotation, -180, 180, 0),
      duration: clampInt(s.duration, 0, 300, 30),
    };
  }
  if (type === "vts.expression") {
    const mode = ["on", "off", "toggle"].includes(s.mode) ? s.mode : "on";
    return { type, expression: cleanStr(s.expression ?? "", 80), mode, duration: clampInt(s.duration, 0, 300, 15) };
  }
  if (type === "vts.move") {
    const preset = ["zoom", "flip", "tilt", "shrink"].includes(s.preset) ? s.preset : "zoom";
    return { type, preset, duration: clampInt(s.duration, 1, 120, 8) };
  }
  if (type === "vts.tint") {
    const color = typeof s.color === "string" && HEX.test(s.color) ? s.color.toLowerCase() : "#ff66aa";
    return { type, color, duration: clampInt(s.duration, 1, 120, 8) };
  }
  if (type === "frills.sound") {
    const sound = SOUND_IDS.has(s.sound) && s.sound !== "none" ? s.sound : "pop";
    return { type, sound, volume: clampInt(s.volume, 10, 100, 75) };
  }
  if (type === "frills.banner") {
    return {
      type,
      title: cleanStr(s.title ?? "Action triggered!", 48),
      text: cleanStr(s.text ?? "{name} · {gift}", 100),
      seconds: clampInt(s.seconds, 2, 15, 4),
      fx: FX_IDS.has(s.fx) ? s.fx : "sparkles",
    };
  }
  return { type: "flow.wait", seconds: clampInt(s.seconds, 1, 60, 3) };
}

/** Normalizes one rule trigger. */
export function sanitizeTrigger(raw) {
  const t = raw && typeof raw === "object" ? raw : {};
  const kind = TRIGGER_IDS.has(t.kind) ? t.kind : "command";
  if (kind === "command") {
    return {
      kind,
      command: cleanCommandWord(t.command, "clip"),
      who: ROLE_IDS.has(t.who) ? t.who : "mods",
    };
  }
  if (kind === "gift") {
    return {
      kind,
      giftName: cleanStr(t.giftName ?? "", 40),
      minDiamonds: clampInt(t.minDiamonds, 1, 1000000, 1),
    };
  }
  if (kind === "like") {
    return { kind, minLikes: clampInt(t.minLikes, 10, 1000000, 500) };
  }
  if (kind === "subgift") {
    return { kind, minCount: clampInt(t.minCount, 1, 1000, 1) };
  }
  if (kind === "bits") {
    return { kind, minBits: clampInt(t.minBits, 1, 1000000, 100) };
  }
  if (kind === "raid") {
    return { kind, minViewers: clampInt(t.minViewers, 1, 100000, 2) };
  }
  return { kind };
}

/** Normalizes one action rule. */
export function sanitizeRule(raw, idx = 0) {
  const r = raw && typeof raw === "object" ? raw : {};
  const id = /^[a-z0-9_-]{1,16}$/i.test(String(r.id ?? "")) ? String(r.id) : `r${idx + 1}`;
  const trigger = sanitizeTrigger(r.trigger);
  const rawSteps = Array.isArray(r.steps) && r.steps.length ? r.steps : [{ type: "obs.clip" }];
  const steps = rawSteps.slice(0, MAX_STEPS_PER_RULE).map(sanitizeStep);
  const fallbackName = trigger.kind === "command" ? `!${trigger.command}` : `Action ${idx + 1}`;
  return {
    id,
    name: cleanStr(r.name ?? fallbackName, 48) || fallbackName,
    enabled: r.enabled !== false,
    cooldownSec: clampInt(r.cooldownSec, 0, 3600, 15),
    queue: r.queue !== false,
    trigger,
    steps,
  };
}

/** Sanitizes an array of rules and enforces `limit` (`FREE_ACTIONS_LIMIT = 10` for Free, `PLUS_ACTIONS_LIMIT` for Plus). */
export function sanitizeRules(raw, { limit = FREE_ACTIONS_LIMIT, allowEmpty = false } = {}) {
  const cap = clampInt(limit, 1, PLUS_ACTIONS_LIMIT, FREE_ACTIONS_LIMIT);
  if (!Array.isArray(raw)) return allowEmpty ? [] : DEFAULT_RULES.slice(0, cap).map((r, i) => sanitizeRule(r, i));
  const seen = new Set();
  const out = [];
  for (let i = 0; i < raw.length && out.length < cap; i++) {
    const clean = sanitizeRule(raw[i], i);
    while (seen.has(clean.id)) clean.id = `r${out.length + 1}_${seen.size}`;
    seen.add(clean.id);
    out.push(clean);
  }
  return out;
}

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(encoded) {
  const norm = String(encoded ?? "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4 ? "=".repeat(4 - (norm.length % 4)) : "";
  const bin = atob(norm + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Encodes a rule array compactly as URL-safe base64url JSON. */
export function encodeRules(rules, { limit = PLUS_ACTIONS_LIMIT } = {}) {
  const clean = sanitizeRules(rules, { limit, allowEmpty: true });
  return toBase64Url(JSON.stringify(clean));
}

/** Decodes a base64url (or raw JSON) rule payload safely, falling back to `DEFAULT_RULES` if malformed. */
export function decodeRules(raw, { limit = FREE_ACTIONS_LIMIT } = {}) {
  const cap = clampInt(limit, 1, PLUS_ACTIONS_LIMIT, FREE_ACTIONS_LIMIT);
  if (Array.isArray(raw)) return sanitizeRules(raw, { limit: cap, allowEmpty: true });
  const str = String(raw ?? "").trim();
  if (!str) return sanitizeRules(DEFAULT_RULES, { limit: cap });
  try {
    const json = str.startsWith("[") ? str : fromBase64Url(str);
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return sanitizeRules(DEFAULT_RULES, { limit: cap });
    return sanitizeRules(parsed, { limit: cap, allowEmpty: true });
  } catch {
    return sanitizeRules(DEFAULT_RULES, { limit: cap });
  }
}

export const DEFAULT_RULES_ENCODED = encodeRules(DEFAULT_RULES);

/** Human summary of a trigger for rule card headers and Phone Stream Deck labels. */
export function triggerSummary(trigger) {
  if (!trigger) return "Action";
  switch (trigger.kind) {
    case "command": return `!${trigger.command}`;
    case "gift": return trigger.giftName ? `Gift · ${trigger.giftName}` : `Gift ≥ ${Number(trigger.minDiamonds || 1).toLocaleString("en-US")}◆`;
    case "follow": return "New follow";
    case "share": return "Share";
    case "like": return `Every ${Number(trigger.minLikes || 500).toLocaleString("en-US")} likes`;
    case "sub": return "Twitch sub";
    case "subgift": return trigger.minCount > 1 ? `${trigger.minCount}+ gifted subs` : "Gifted sub";
    case "bits": return `≥ ${Number(trigger.minBits || 100).toLocaleString("en-US")} bits`;
    case "raid": return `Raid ≥ ${Number(trigger.minViewers || 2)}`;
    default: return trigger.kind;
  }
}

/** Replaces `{name}`, `{who}`, `{gift}`, `{count}`, `{text}`, `{rule}` placeholders safely. */
export function formatTemplate(tpl, ctx = {}) {
  return String(tpl ?? "").replace(/\{(name|who|gift|count|text|rule)\}/gi, (_, k) => {
    const key = k.toLowerCase();
    if (key === "who" || key === "name") return String(ctx.who || ctx.name || "Viewer");
    if (key === "gift") return String(ctx.gift || ctx.label || "");
    if (key === "count") return String(ctx.count ?? "");
    if (key === "text") return String(ctx.text || "");
    if (key === "rule") return String(ctx.ruleName || "");
    return "";
  });
}

export const ACTIONS = defineWidget({
  defaults: {
    obsApp: "obs",
    obsPort: 4455,
    obsAutoStart: true,
    replaySource: "Frills Replay Cam",
    vtsPort: 8001,
    showToasts: true,
    toastSeconds: 4,
    rules: DEFAULT_RULES_ENCODED,
  },
  controls: [
    { section: "actions", ...selectOf("obsApp", "Streaming app", [["obs", "OBS Studio"], ["slobs", "Streamlabs Desktop"]]), hidden: true },
    { section: "actions", ...number("obsPort", "OBS / Streamlabs port", 1, 65535), hidden: true },
    { section: "actions", ...toggle("obsAutoStart", "Auto-start Replay Buffer when connected"), hidden: true },
    { section: "actions", ...text("replaySource", "Default OBS Replay Cam source name", 60), hidden: true },
    { section: "actions", ...number("vtsPort", "VTube Studio API port", 1, 65535), hidden: true },
    { section: "actions", ...toggle("showToasts", "Show on-screen toast when an action fires") },
    { section: "actions", ...range("toastSeconds", "Toast duration", 2, 10, 1, " s") },
    { section: "actions", ...text("rules", "Rules payload", 15000), hidden: true },
  ],
});

/** Evaluates whether one chat message or stream event matches a rule's trigger. Returns `{ match, ctx }` or `{ match: false, why }`. */
export function matchTrigger(rule, payload, { channel = "", likesMap = null } = {}) {
  if (!rule?.enabled || !payload) return { match: false, why: "disabled" };
  const t = rule.trigger;

  if (payload.type === "chat") {
    if (t.kind !== "command") return { match: false, why: "kind" };
    const m = /^\s*[!！]\s*([a-z0-9_-]+)(?:\s+(.*))?$/is.exec(String(payload.text ?? ""));
    if (!m) return { match: false, why: "not-command" };
    if (m[1].toLowerCase() !== t.command) return { match: false, why: "wrong-command" };
    const isHost = payload.host === true || (channel && String(payload.login ?? "").toLowerCase() === String(channel).toLowerCase());
    const isMod = payload.mod === true;
    if (t.who === "host" && !isHost) return { match: false, why: "not-allowed" };
    if (t.who === "mods" && !(isHost || isMod)) return { match: false, why: "not-allowed" };
    return {
      match: true,
      ctx: {
        who: cleanStr(payload.name || payload.user || "Viewer", 40) || "Viewer",
        label: `!${t.command}`,
        gift: `!${t.command}`,
        count: 1,
        text: cleanStr(m[2] ?? "", 120),
      },
    };
  }

  if (payload.kind !== t.kind) return { match: false, why: "kind" };
  const who = cleanStr(payload.name || payload.user || "Viewer", 40) || "Viewer";

  if (t.kind === "gift") {
    const giftName = cleanStr(payload.gift || "Gift", 40);
    if (t.giftName && giftName.toLowerCase() !== t.giftName.toLowerCase()) return { match: false, why: "gift-name" };
    const count = Math.max(1, Math.round(Number(payload.count) || 1));
    const total = Math.max(0, Math.round(Number(payload.total) || ((Number(payload.diamonds) || 0) * count)));
    if (total < (t.minDiamonds || 1)) return { match: false, why: "min-diamonds" };
    return { match: true, ctx: { who, label: count > 1 ? `${count}× ${giftName}` : giftName, gift: giftName, count, text: "" } };
  }

  if (t.kind === "like") {
    const add = Math.max(0, Math.round(Number(payload.count) || 0));
    if (add <= 0) return { match: false, why: "zero-likes" };
    const need = Math.max(10, Number(t.minLikes) || 500);
    const prev = likesMap ? (likesMap.get(rule.id) || 0) : 0;
    const sum = prev + add;
    if (sum < need) {
      likesMap?.set(rule.id, sum);
      return { match: false, why: "likes-building" };
    }
    likesMap?.set(rule.id, sum % need);
    return { match: true, ctx: { who, label: `${need.toLocaleString("en-US")} likes`, gift: "Likes", count: need, text: "" } };
  }

  if (t.kind === "subgift") {
    const count = Math.max(1, Math.round(Number(payload.count) || 1));
    if (count < (t.minCount || 1)) return { match: false, why: "min-count" };
    return { match: true, ctx: { who, label: count > 1 ? `${count} Gifted Subs` : "Gifted Sub", gift: "Gifted Sub", count, text: "" } };
  }

  if (t.kind === "bits") {
    const count = Math.max(0, Math.round(Number(payload.count) || 0));
    if (count < (t.minBits || 1)) return { match: false, why: "min-bits" };
    return { match: true, ctx: { who, label: `${count.toLocaleString("en-US")} Bits`, gift: `${count} Bits`, count, text: cleanStr(payload.text ?? "", 120) } };
  }

  if (t.kind === "raid") {
    const viewers = Math.max(1, Math.round(Number(payload.count ?? payload.viewers) || 1));
    if (viewers < (t.minViewers || 1)) return { match: false, why: "min-viewers" };
    return { match: true, ctx: { who, label: `Raid (${viewers})`, gift: "Raid", count: viewers, text: "" } };
  }

  const labels = { follow: "New Follower", share: "Share", sub: "Twitch Sub" };
  return { match: true, ctx: { who, label: labels[t.kind] || t.kind, gift: labels[t.kind] || t.kind, count: 1, text: "" } };
}

/**
 * Connects an `ObsClient` to the 9 `obs.*` action step types (clip, replay cam, scene switch,
 * source toggle, filter toggle, audio mute, media playback, text update, hotkey) with clean auto-revert timers.
 */
export function createObsStepExecutor(obs, {
  defaultReplaySource = () => "Frills Replay Cam",
  previewFallback = false,
  onReplayStart = () => {},
  onReplayEnd = () => {},
  onToast = () => {},
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancelSchedule = (id) => clearTimeout(id),
} = {}) {
  const timers = new Set();
  const trackTimer = (fn, ms) => {
    const id = schedule(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  };
  const sleepCancelable = (ms) => new Promise((resolve) => { trackTimer(resolve, ms); });

  async function resolveSceneItem(sceneName, sourceName) {
    let scene = sceneName;
    if (!scene) {
      const cur = await obs.call("GetCurrentProgramScene");
      scene = cur?.currentProgramSceneName || "";
    }
    if (!scene) throw new Error(obs?.kind === "slobs" ? "No active Streamlabs scene." : "No active OBS scene.");
    try {
      const found = await obs.call("GetSceneItemId", { sceneName: scene, sourceName });
      return { sceneName: found?.sceneName || scene, sceneItemId: found.sceneItemId };
    } catch (err) {
      if (obs?.kind === "slobs") throw err;
      const created = await obs.call("CreateSceneItem", { sceneName: scene, sourceName, sceneItemEnabled: false });
      return { sceneName: scene, sceneItemId: created.sceneItemId };
    }
  }

  return {
    async run(step, ctx) {
      const appLabel = obs?.kind === "slobs" ? "Streamlabs Desktop" : "OBS";
      if (!obs?.connected) {
        if (previewFallback) {
          if (step.type === "obs.clip") {
            const msg = formatTemplate(step.toast || "Clip saved · {name}", ctx);
            onToast({ title: "Clip saved (preview)", text: msg, fx: "sparkles" });
            return { ok: true, simulated: true, detail: `Simulated clip (connect ${appLabel} to save real clips)` };
          }
          if (step.type === "obs.replay") {
            onReplayStart({ badge: step.badge || "REPLAY", who: ctx.who, label: ctx.label });
            await sleepCancelable(Math.min(4000, (step.maxSec || 20) * 1000));
            onReplayEnd();
            return { ok: true, simulated: true, detail: "Simulated replay cam (connect OBS to play real clips)" };
          }
          onToast({ title: ctx.ruleName || "Action (preview)", text: `${step.type.replace("obs.", `${appLabel} `)} · ${ctx.who}`, fx: "sparkles" });
          return { ok: true, simulated: true, detail: `Simulated ${step.type} (connect ${appLabel} to run live)` };
        }
        return { ok: false, detail: `${appLabel} not connected` };
      }

      if (step.type === "obs.clip") {
        const waitSaved = obs.waitForEvent("ReplayBufferSaved", () => true, 6000).catch(() => null);
        await obs.call("SaveReplayBuffer");
        await waitSaved;
        if (step.toast) onToast({ title: "Clip saved", text: formatTemplate(step.toast, ctx), fx: "sparkles" });
        return { ok: true, detail: `Saved ${appLabel} Replay Buffer` };
      }

      if (step.type === "obs.replay") {
        let savedPath = "";
        if (step.saveFirst !== false) {
          const waitSaved = obs.waitForEvent("ReplayBufferSaved", () => true, 8000);
          await obs.call("SaveReplayBuffer");
          const ev = await waitSaved;
          savedPath = String(ev?.savedReplayPath ?? "");
        }
        if (!savedPath) {
          const last = await obs.call("GetLastReplayBufferReplay").catch(() => ({}));
          savedPath = String(last?.savedReplayPath ?? "");
        }
        if (!savedPath) throw new Error("OBS returned no saved replay path. Is Replay Buffer running?");

        const sourceName = step.source || defaultReplaySource() || "Frills Replay Cam";
        const { sceneName, sceneItemId } = await resolveSceneItem("", sourceName);
        await obs.call("SetInputSettings", {
          inputName: sourceName,
          inputSettings: {
            local_file: savedPath,
            looping: false,
            restart_on_activate: true,
            close_when_inactive: true,
            speed_percent: clampInt(step.speed, 25, 150, 100),
          },
          overlay: true,
        });
        const waitEnded = obs.waitForEvent("MediaInputPlaybackEnded", (d) => d?.inputName === sourceName, (step.maxSec || 20) * 1000).catch(() => null);
        await obs.call("SetSceneItemEnabled", { sceneName, sceneItemId, sceneItemEnabled: true });
        onReplayStart({ badge: step.badge || "REPLAY", who: ctx.who, label: ctx.label });
        await waitEnded;
        await obs.call("SetSceneItemEnabled", { sceneName, sceneItemId, sceneItemEnabled: false }).catch(() => {});
        onReplayEnd();
        return { ok: true, detail: `Played replay in ${sourceName}` };
      }

      if (step.type === "obs.scene") {
        if (!step.scene) throw new Error("Choose an OBS scene name.");
        let prevScene = "";
        if (step.duration > 0) {
          const cur = await obs.call("GetCurrentProgramScene").catch(() => ({}));
          prevScene = String(cur?.currentProgramSceneName ?? "");
        }
        await obs.call("SetCurrentProgramScene", { sceneName: step.scene });
        if (step.duration > 0 && prevScene && prevScene !== step.scene) {
          trackTimer(() => { obs.call("SetCurrentProgramScene", { sceneName: prevScene }).catch(() => {}); }, step.duration * 1000);
        }
        return { ok: true, detail: step.duration > 0 ? `Scene → ${step.scene} (${step.duration}s)` : `Scene → ${step.scene}` };
      }

      if (step.type === "obs.source") {
        if (!step.source) throw new Error("Choose an OBS source name.");
        const { sceneName, sceneItemId } = await resolveSceneItem(step.scene, step.source);
        let prev = false;
        if (step.mode === "toggle" || step.duration > 0) {
          const cur = await obs.call("GetSceneItemEnabled", { sceneName, sceneItemId }).catch(() => ({ sceneItemEnabled: false }));
          prev = Boolean(cur?.sceneItemEnabled);
        }
        const next = step.mode === "show" ? true : step.mode === "hide" ? false : !prev;
        await obs.call("SetSceneItemEnabled", { sceneName, sceneItemId, sceneItemEnabled: next });
        if (step.duration > 0) {
          trackTimer(() => { obs.call("SetSceneItemEnabled", { sceneName, sceneItemId, sceneItemEnabled: prev }).catch(() => {}); }, step.duration * 1000);
        }
        return { ok: true, detail: `${next ? "Showed" : "Hid"} ${step.source}${step.duration > 0 ? ` (${step.duration}s)` : ""}` };
      }

      if (step.type === "obs.filter") {
        if (!step.source || !step.filter) throw new Error("Choose an OBS source and filter name.");
        let prev = false;
        if (step.mode === "toggle" || step.duration > 0) {
          const cur = await obs.call("GetSourceFilter", { sourceName: step.source, filterName: step.filter }).catch(() => ({ filterEnabled: false }));
          prev = Boolean(cur?.filterEnabled);
        }
        const next = step.mode === "on" ? true : step.mode === "off" ? false : !prev;
        await obs.call("SetSourceFilterEnabled", { sourceName: step.source, filterName: step.filter, filterEnabled: next });
        if (step.duration > 0) {
          trackTimer(() => { obs.call("SetSourceFilterEnabled", { sourceName: step.source, filterName: step.filter, filterEnabled: prev }).catch(() => {}); }, step.duration * 1000);
        }
        return { ok: true, detail: `${next ? "Enabled" : "Disabled"} ${step.filter} on ${step.source}` };
      }

      if (step.type === "obs.mute") {
        if (!step.source) throw new Error("Choose an OBS audio input name.");
        let prev = false;
        if (step.mode === "toggle" || step.duration > 0) {
          const cur = await obs.call("GetInputMute", { inputName: step.source }).catch(() => ({ inputMuted: false }));
          prev = Boolean(cur?.inputMuted);
        }
        const next = step.mode === "mute" ? true : step.mode === "unmute" ? false : !prev;
        await obs.call("SetInputMute", { inputName: step.source, inputMuted: next });
        if (step.duration > 0) {
          trackTimer(() => { obs.call("SetInputMute", { inputName: step.source, inputMuted: prev }).catch(() => {}); }, step.duration * 1000);
        }
        return { ok: true, detail: `${next ? "Muted" : "Unmuted"} ${step.source}${step.duration > 0 ? ` (${step.duration}s)` : ""}` };
      }

      if (step.type === "obs.media") {
        if (!step.source) throw new Error("Choose an OBS media source name.");
        const { sceneName, sceneItemId } = await resolveSceneItem(step.scene, step.source);
        const waitEnded = step.hideOnEnd
          ? obs.waitForEvent("MediaInputPlaybackEnded", (d) => d?.inputName === step.source, (step.maxSec || 15) * 1000).catch(() => null)
          : null;
        await obs.call("SetSceneItemEnabled", { sceneName, sceneItemId, sceneItemEnabled: true });
        await obs.call("TriggerMediaInputAction", { inputName: step.source, mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART" }).catch(() => {});
        if (waitEnded) {
          await waitEnded;
          await obs.call("SetSceneItemEnabled", { sceneName, sceneItemId, sceneItemEnabled: false }).catch(() => {});
        }
        return { ok: true, detail: `Played ${step.source}` };
      }

      if (step.type === "obs.text") {
        if (!step.source) throw new Error("Choose an OBS text source name.");
        const rendered = formatTemplate(step.text, ctx);
        await obs.call("SetInputSettings", { inputName: step.source, inputSettings: { text: rendered }, overlay: true });
        return { ok: true, detail: `Updated ${step.source}` };
      }

      if (step.type === "obs.hotkey") {
        if (!step.hotkey) throw new Error("Choose an OBS hotkey name.");
        await obs.call("TriggerHotkeyByName", { hotkeyName: step.hotkey });
        return { ok: true, detail: `Triggered ${step.hotkey}` };
      }

      return { ok: false, detail: `Unknown OBS step ${step.type}` };
    },
    clear() {
      for (const id of timers) cancelSchedule(id);
      timers.clear();
      onReplayEnd();
    },
  };
}

function hexToRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex ?? ""));
  if (!m) return [255, 102, 170];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Connects a `VtsClient` to the 5 `vts.*` action step types (hotkeys/Item Scenes, drop/remove items,
 * expressions, zoom/flip/tilt/shrink model moves, and color tints) with automatic revert timers.
 */
export function createVtsStepExecutor(vts, {
  previewFallback = false,
  maxStickyNotes = 0,
  allowPlusShapes = true,
  onToast = () => {},
  onStickyPreview = null,
  renderStickyNote = renderStickyNoteBase64,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancelSchedule = (id) => clearTimeout(id),
} = {}) {
  const timers = new Set();
  const activeStickyIds = [];
  let stickyCap = Math.max(0, Math.round(Number(maxStickyNotes) || 0));
  let plusShapesAllowed = Boolean(allowPlusShapes);
  const forgetStickyId = (id) => {
    const idx = activeStickyIds.indexOf(id);
    if (idx >= 0) activeStickyIds.splice(idx, 1);
  };
  const unloadInstance = (instanceID) => vts.call("ItemUnloadRequest", {
    unloadAllInScene: false,
    unloadAllLoadedByThisPlugin: false,
    allowUnloadingItemsLoadedByUserOrOtherPlugins: false,
    instanceIDs: [instanceID],
    fileNames: [],
  }).catch(() => {});
  const trackTimer = (fn, ms) => {
    const id = schedule(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  };

  return {
    setMaxStickyNotes(limit) {
      stickyCap = Math.max(0, Math.round(Number(limit) || 0));
    },
    setAllowPlusShapes(allow) {
      plusShapesAllowed = Boolean(allow);
    },
    clearStickyTracking() {
      activeStickyIds.length = 0;
    },
    async run(step, ctx) {
      if (!vts?.connected) {
        if (previewFallback) {
          if (step.type === "vts.sticky") {
            const title = formatTemplate(step.title || "{name}", ctx) || ctx.who || "Viewer";
            const subtitle = step.subtitle ? formatTemplate(step.subtitle, ctx) : "";
            const shape = plusShapesAllowed ? (step.shape || "note") : "note";
            let base64 = "";
            try {
              base64 = renderStickyNote({ title, subtitle, color: step.color || "random", shape });
            } catch { /* headless fallback */ }
            if (base64 && onStickyPreview) {
              onStickyPreview({ base64, maxNotes: stickyCap, title, subtitle });
            }
            onToast({ title: ctx.ruleName || "Sticky note (preview)", text: `${title}${subtitle ? ` · ${subtitle}` : ""}`, fx: "sparkles" });
            return { ok: true, simulated: true, detail: `Preview sticky note “${title}” (connect VTube Studio to pin to avatar)` };
          }
          const msg = `${step.type.replace("vts.", "VTS ")} · ${ctx.who}`;
          onToast({ title: ctx.ruleName || "VTube Studio (preview)", text: msg, fx: "sparkles" });
          return { ok: true, simulated: true, detail: `Simulated ${step.type} (connect VTube Studio to run live)` };
        }
        return { ok: false, detail: "VTube Studio not connected" };
      }

      if (step.type === "vts.sticky") {
        await vts.ensureCustomItemPermission();
        const title = formatTemplate(step.title || "{name}", ctx) || ctx.who || "Viewer";
        const subtitle = step.subtitle ? formatTemplate(step.subtitle, ctx) : "";
        const requestedShape = step.shape || "note";
        const shape = plusShapesAllowed ? requestedShape : "note";
        const shapeFallback = !plusShapesAllowed && isPlusStickyShape(requestedShape);
        const customDataBase64 = renderStickyNote({ title, subtitle, color: step.color || "random", shape });
        if (customDataBase64 && onStickyPreview) {
          onStickyPreview({ base64: customDataBase64, maxNotes: stickyCap, title, subtitle });
        }
        const sizeNorm = clampInt(step.size, 12, 60, 22) / 100;
        const rot = clampInt(step.rotation, -45, 45, -6);
        const stays = !(step.duration > 0);
        const jitterX = step.pinMode === "random" || step.pinMode === "face" ? (Math.random() - 0.5) * 0.28 : 0;
        const jitterY = step.pinMode === "random" || step.pinMode === "face" ? (Math.random() - 0.5) * 0.22 + 0.1 : 0.12;
        const fileName = `frills-note-${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 90 + 10)}.png`;
        const res = await vts.call("ItemLoadRequest", {
          fileName,
          positionX: jitterX,
          positionY: jitterY,
          size: sizeNorm,
          rotation: rot,
          fadeTime: 0.2,
          order: 12,
          failIfOrderTaken: false,
          smoothing: 0,
          censored: false,
          flipped: false,
          locked: false,
          unloadWhenPluginDisconnects: !stays,
          customDataBase64,
          customDataAskUserFirst: false,
          customDataSkipAskingUserIfWhitelisted: true,
          customDataAskTimer: -1,
        });
        const instanceID = String(res?.instanceID ?? "");
        let evicted = false;
        if (instanceID) {
          activeStickyIds.push(instanceID);
          if (stickyCap > 0) {
            while (activeStickyIds.length > stickyCap) {
              const oldest = activeStickyIds.shift();
              if (oldest) {
                evicted = true;
                void unloadInstance(oldest);
              }
            }
          }
        }
        let pinnedMesh = "";
        let pinned = false;
        if (instanceID && step.pinMode !== "screen") {
          const artMeshID = step.pinMode === "random" && !step.artMesh ? "" : await vts.resolveFaceArtMesh(step.artMesh);
          const vertexPinType = step.pinMode === "center" && artMeshID ? "Center" : "Random";
          const angle = rot + (vertexPinType === "Random" ? (Math.random() - 0.5) * 26 : 0);
          const pinReq = {
            pin: true,
            itemInstanceID: instanceID,
            angleRelativeTo: "RelativeToModel",
            sizeRelativeTo: "RelativeToWorld",
            vertexPinType,
            pinInfo: {
              modelID: "",
              artMeshID,
              angle,
              size: sizeNorm,
            },
          };
          try {
            await vts.call("ItemPinRequest", pinReq);
            pinned = true;
            pinnedMesh = artMeshID;
          } catch {
            if (artMeshID) {
              try {
                await vts.call("ItemPinRequest", { ...pinReq, vertexPinType: "Random", pinInfo: { ...pinReq.pinInfo, artMeshID: "" } });
                pinned = true;
                pinnedMesh = "";
              } catch { /* keep floating on screen if model cannot be pinned */ }
            }
          }
        }
        if (!stays && instanceID) {
          trackTimer(() => {
            forgetStickyId(instanceID);
            void unloadInstance(instanceID);
          }, step.duration * 1000);
        }
        const where = pinned ? (pinnedMesh ? `pinned to ${pinnedMesh}` : "pinned to avatar") : "on screen";
        const capNote = evicted ? ` · ${stickyCap}/${stickyCap} free cap (oldest peeled off)` : "";
        const shapeNote = shapeFallback ? " · Plus shape fell back to pastel note" : "";
        return { ok: true, detail: `Sticky note “${title}” ${where} (${stays ? "stays" : `${step.duration}s`})${capNote}${shapeNote}` };
      }

      if (step.type === "vts.hotkey") {
        if (!step.hotkey) throw new Error("Choose a VTube Studio hotkey or Item Scene.");
        const hotkeyID = await vts.resolveHotkeyId(step.hotkey);
        await vts.call("HotkeyTriggerRequest", { hotkeyID });
        if (step.duration > 0) {
          trackTimer(() => { vts.call("HotkeyTriggerRequest", { hotkeyID }).catch(() => {}); }, step.duration * 1000);
        }
        return { ok: true, detail: step.duration > 0 ? `VTS hotkey “${step.hotkey}” (${step.duration}s)` : `VTS hotkey “${step.hotkey}”` };
      }

      if (step.type === "vts.item") {
        if (!step.fileName) throw new Error("Choose an item filename from your VTube Studio Items folder.");
        const res = await vts.call("ItemLoadRequest", {
          fileName: step.fileName,
          positionX: (clampInt(step.posX, -100, 100, 0) / 100),
          positionY: (clampInt(step.posY, -100, 100, 15) / 100),
          size: clampInt(step.size, 10, 100, 32) / 100,
          rotation: clampInt(step.rotation, -180, 180, 0),
          fadeTime: 0.25,
          order: 4,
          failIfOrderTaken: false,
          smoothing: 0,
          censored: false,
          flipped: false,
          locked: false,
          unloadWhenPluginDisconnects: true,
        });
        const instanceID = String(res?.instanceID ?? "");
        if (step.duration > 0 && instanceID) {
          trackTimer(() => {
            vts.call("ItemUnloadRequest", {
              unloadAllInScene: false,
              unloadAllLoadedByThisPlugin: false,
              allowUnloadingItemsLoadedByUserOrOtherPlugins: false,
              instanceIDs: [instanceID],
              fileNames: [],
            }).catch(() => {});
          }, step.duration * 1000);
        }
        return { ok: true, detail: `Dropped ${step.fileName}${step.duration > 0 ? ` (${step.duration}s)` : ""}` };
      }

      if (step.type === "vts.expression") {
        if (!step.expression) throw new Error("Choose a VTube Studio expression.");
        const resolved = await vts.resolveExpression(step.expression);
        const next = step.mode === "on" ? true : step.mode === "off" ? false : !resolved.active;
        await vts.call("ExpressionActivationRequest", { expressionFile: resolved.file, active: next, fadeTime: 0.25 });
        if (step.duration > 0) {
          trackTimer(() => {
            vts.call("ExpressionActivationRequest", { expressionFile: resolved.file, active: resolved.active, fadeTime: 0.25 }).catch(() => {});
          }, step.duration * 1000);
        }
        return { ok: true, detail: `${next ? "On" : "Off"} expression ${step.expression}${step.duration > 0 ? ` (${step.duration}s)` : ""}` };
      }

      if (step.type === "vts.move") {
        const model = await vts.call("CurrentModelRequest").catch(() => ({}));
        const orig = model?.modelPosition;
        const moves = {
          zoom: { positionX: 0, positionY: -0.18, rotation: 0, size: 32 },
          flip: { positionX: 0, positionY: 0, rotation: 180, size: 0 },
          tilt: { positionX: 0, positionY: 0, rotation: 24, size: 8 },
          shrink: { positionX: 0, positionY: -0.22, rotation: 0, size: -45 },
        };
        const delta = moves[step.preset] ?? moves.zoom;
        await vts.call("MoveModelRequest", { timeInSeconds: 0.35, valuesAreRelativeToModel: true, ...delta });
        const holdSec = clampInt(step.duration, 1, 120, 8);
        trackTimer(() => {
          const resetReq = orig
            ? { timeInSeconds: 0.4, valuesAreRelativeToModel: false, positionX: orig.positionX, positionY: orig.positionY, rotation: orig.rotation, size: orig.size }
            : { timeInSeconds: 0.4, valuesAreRelativeToModel: true, positionX: -delta.positionX, positionY: -delta.positionY, rotation: -delta.rotation, size: -delta.size };
          vts.call("MoveModelRequest", resetReq).catch(() => {});
        }, holdSec * 1000);
        return { ok: true, detail: `VTS ${step.preset} (${holdSec}s)` };
      }

      if (step.type === "vts.tint") {
        const [colorR, colorG, colorB] = hexToRgb(step.color);
        await vts.call("ColorTintRequest", {
          colorTint: { colorR, colorG, colorB, colorA: 255, mixWithSceneLightingColor: 1.0 },
          artMeshMatcher: { tintAll: true },
        });
        const holdSec = clampInt(step.duration, 1, 120, 8);
        trackTimer(() => {
          vts.call("ColorTintRequest", {
            colorTint: { colorR: 255, colorG: 255, colorB: 255, colorA: 255, mixWithSceneLightingColor: 1.0 },
            artMeshMatcher: { tintAll: true },
          }).catch(() => {});
        }, holdSec * 1000);
        return { ok: true, detail: `VTS tint ${step.color} (${holdSec}s)` };
      }

      return { ok: false, detail: `Unknown VTS step ${step.type}` };
    },
    clear() {
      for (const id of timers) cancelSchedule(id);
      timers.clear();
      activeStickyIds.length = 0;
    },
  };
}

/**
 * Pure stream-to-actions engine: evaluates triggers, deduplicates IDs, enforces cooldowns & free/Plus rule limits,
 * queues sequential executions cleanly, and delegates step execution to injected handlers.
 */
export class ActionEngine {
  constructor({
    rules = DEFAULT_RULES,
    limit = FREE_ACTIONS_LIMIT,
    allowVts = true,
    channel = "",
    now = () => Date.now(),
    runObs = async () => ({ ok: true }),
    runVts = async () => ({ ok: true }),
    playSound = () => {},
    showBanner = () => {},
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    onLog = () => {},
  } = {}) {
    this.limit = limit;
    this.allowVts = Boolean(allowVts);
    this.rules = sanitizeRules(rules, { limit, allowEmpty: true });
    this.channel = String(channel ?? "").toLowerCase();
    this.now = now;
    this.runObs = runObs;
    this.runVts = runVts;
    this.playSound = playSound;
    this.showBanner = showBanner;
    this.wait = wait;
    this.onLog = onLog;

    this.heard = new Set();
    this.cooldowns = new Map();
    this.likes = new Map();
    this.queue = [];
    this.running = false;
    this.gen = 0;
  }

  setChannel(channel) {
    this.channel = String(channel ?? "").toLowerCase();
  }

  setRules(rules, { limit = this.limit } = {}) {
    this.limit = limit;
    this.rules = sanitizeRules(rules, { limit, allowEmpty: true });
  }

  _remember(id) {
    if (!id) return false;
    if (this.heard.has(id)) return true;
    this.heard.add(id);
    if (this.heard.size > 500) this.heard.delete(this.heard.values().next().value);
    return false;
  }

  handleChat(message) {
    if (!message?.text || this._remember(message.id ? `chat:${message.id}` : "")) return [];
    return this._dispatch({ ...message, type: "chat" });
  }

  handleEvent(event) {
    if (!event?.kind || this._remember(event.id ? `ev:${event.kind}:${event.id}` : "")) return [];
    return this._dispatch(event);
  }

  /** Manually runs one rule by id (editor Test button or Frills Plus Phone Stream Deck). */
  runRule(ruleId, ctx = {}) {
    const rule = this.rules.find((r) => r.id === ruleId);
    if (!rule) return false;
    const merged = {
      who: cleanStr(ctx.who || "Streamer", 40) || "Streamer",
      label: cleanStr(ctx.label || triggerSummary(rule.trigger), 48),
      gift: cleanStr(ctx.gift || ctx.label || "Test", 40),
      count: Number(ctx.count) || 1,
      text: cleanStr(ctx.text || "", 120),
      ruleName: rule.name,
    };
    this._scheduleRun(rule, merged);
    return true;
  }

  _dispatch(payload) {
    const fired = [];
    const tNow = this.now();
    for (const rule of this.rules) {
      const res = matchTrigger(rule, payload, { channel: this.channel, likesMap: this.likes });
      if (!res.match) {
        if (res.why === "not-allowed") {
          this.onLog({ at: tNow, ruleId: rule.id, ruleName: rule.name, who: payload.name || "Viewer", status: "skipped", detail: "Not allowed (role restricted)" });
        }
        continue;
      }
      const nextAllowed = this.cooldowns.get(rule.id) || 0;
      if (rule.cooldownSec > 0 && tNow < nextAllowed) {
        const left = Math.ceil((nextAllowed - tNow) / 1000);
        this.onLog({ at: tNow, ruleId: rule.id, ruleName: rule.name, who: res.ctx.who, status: "skipped", detail: `Cooldown (${left}s left)` });
        continue;
      }
      if (rule.cooldownSec > 0) this.cooldowns.set(rule.id, tNow + rule.cooldownSec * 1000);
      this._scheduleRun(rule, { ...res.ctx, ruleName: rule.name });
      fired.push(rule.id);
    }
    return fired;
  }

  _scheduleRun(rule, ctx) {
    if (!rule.queue) {
      void this._execute(rule, ctx, this.gen);
      return;
    }
    if (this.queue.length >= MAX_ACTION_QUEUE) {
      this.onLog({ at: this.now(), ruleId: rule.id, ruleName: rule.name, who: ctx.who, status: "skipped", detail: "Action queue full" });
      return;
    }
    this.queue.push({ rule, ctx });
    void this._pump();
  }

  async _pump() {
    if (this.running || !this.queue.length) return;
    this.running = true;
    const myGen = this.gen;
    while (this.queue.length && myGen === this.gen) {
      const next = this.queue.shift();
      await this._execute(next.rule, next.ctx, myGen);
    }
    if (myGen === this.gen) this.running = false;
  }

  async _execute(rule, ctx, myGen) {
    const notes = [];
    let failed = "";
    for (const step of rule.steps) {
      if (myGen !== this.gen) return;
      try {
        if (step.type === "flow.wait") {
          await this.wait(Math.max(100, (step.seconds || 1) * 1000));
          notes.push(`waited ${step.seconds}s`);
        } else if (step.type === "frills.sound") {
          this.playSound(step.sound, { volume: step.volume ?? 75 });
          notes.push(`sound:${step.sound}`);
        } else if (step.type === "frills.banner") {
          this.showBanner({
            title: formatTemplate(step.title, ctx),
            text: formatTemplate(step.text, ctx),
            ms: (step.seconds || 4) * 1000,
            fx: step.fx || "none",
          });
          notes.push("banner");
        } else if (step.type.startsWith("obs.")) {
          const res = await this.runObs(step, ctx);
          if (res?.ok === false) {
            failed = res.detail || "OBS error";
            break;
          }
          if (res?.detail) notes.push(res.detail);
        } else if (step.type.startsWith("vts.")) {
          if (isPlusVtsStep(step) && !this.allowVts) {
            failed = "This VTube Studio action requires Frills Plus (sticky notes are free up to 5 at once)";
            break;
          }
          const res = await this.runVts(step, ctx);
          if (res?.ok === false) {
            failed = res.detail || "VTube Studio error";
            break;
          }
          if (res?.detail) notes.push(res.detail);
        }
      } catch (err) {
        failed = err?.message || "Step failed";
        break;
      }
    }
    if (myGen !== this.gen) return;
    this.onLog({
      at: this.now(),
      ruleId: rule.id,
      ruleName: rule.name,
      who: ctx.who,
      status: failed ? "error" : "ok",
      detail: failed || notes.join(" · ") || "Ran",
    });
  }

  clear() {
    this.gen += 1;
    this.queue = [];
    this.running = false;
    this.cooldowns.clear();
    this.likes.clear();
  }
}

export { cleanObsPort, cleanSlobsPort, cleanVtsPort };
