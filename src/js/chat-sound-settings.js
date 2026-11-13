// The chat's message-sound settings, in a file of their own so the chat overlay (held to a strict weight) does not carry them. The editor and the sound loader (chat-sounds.js) import
// this file, which adds the three settings to the chat's list once, at the end of it: the editor shows them, and a link carries them when they are not the defaults.

import { CONTROLS, DEFAULTS } from "./settings.js";

export const SOUND_DEFAULTS = { sound: "none", soundVolume: 50, soundGap: 1 };
const named = (pairs) => pairs.map(([id, name]) => ({ id, name }));

export const SOUND_CONTROLS = [
  { key: "sound", where: "main", type: "select", label: "Sound for each message", options: named([["none", "No sound"], ["pop", "Pop"], ["boop", "Boop"], ["bubble", "Bubble"], ["chime", "Chime"], ["coin", "Coin"], ["bell", "Bell"], ["sparkle", "Sparkle"], ["levelup", "Level up"]]), hint: "A short sound each time a message appears. Off unless you pick one. In OBS it plays by itself; in an ordinary browser tab it needs one click first." },
  { key: "soundVolume", where: "more", type: "range", label: "Message sound volume", min: 10, max: 100, step: 5, unit: " %" },
  { key: "soundGap", where: "more", type: "range", label: "Quiet time between sounds", min: 0, max: 10, step: 1, unit: " s", zero: "every message", hint: "In a busy chat, a sound for every message gets tiring. This keeps them apart." },
];

if (!CONTROLS.some((c) => c.key === "sound")) {
  CONTROLS.push(...SOUND_CONTROLS);
  Object.assign(DEFAULTS, SOUND_DEFAULTS);
}
