// The message sound for the chat (chat-sound-settings.js and chat-sound.js): what the three settings are and how they reach a link, that every sound on offer exists, and the rule for when
// a sound plays: never when none is chosen, never sooner than the quiet time after the last one, and never counted when the browser would not play it.

import test from "node:test";
import assert from "node:assert/strict";
import { CONTROLS, DEFAULTS, coerce, fromParams, overlayUrl, sanitize } from "../src/js/settings.js";
import { SOUND_CONTROLS, SOUND_DEFAULTS } from "../src/js/chat-sound-settings.js";
import { chatPing } from "../src/js/chat-sound.js";
import { soundIds } from "../src/js/sounds.js";

const control = (key) => CONTROLS.find((c) => c.key === key);

test("the chat has a sound setting, off by default, with a volume and a quiet time", () => {
  assert.deepEqual(SOUND_DEFAULTS, { sound: "none", soundVolume: 50, soundGap: 1 });
  for (const key of Object.keys(SOUND_DEFAULTS)) assert.ok(control(key), `${key} is in the chat's settings`);
  assert.equal(DEFAULTS.sound, "none", "silent until a sound is picked: chats that were silent stay silent");
  assert.equal(CONTROLS.filter((c) => c.key === "sound").length, 1, "added once, however many files import the settings");
  assert.deepEqual(control("sound").options.map((o) => o.id), ["none", "pop", "boop", "bubble", "chime", "coin", "bell", "sparkle", "levelup"]);
  assert.equal(control("sound").options[0].name, "No sound", "the option to have none is the first one");
  assert.equal(control("sound").where, "main", "the sound is up front, not buried under more options");
  assert.equal(SOUND_CONTROLS.length, 3);
});

test("every sound on offer is one the player can make", () => {
  const made = soundIds();
  for (const { id } of control("sound").options) if (id !== "none") assert.ok(made.includes(id), `${id} exists in sounds.js`);
});

test("a sound that is not on the list, or a number out of range, is not accepted", () => {
  assert.equal(coerce(control("sound"), "gong"), undefined);
  assert.equal(coerce(control("sound"), ""), undefined);
  assert.equal(coerce(control("sound"), 7), undefined);
  assert.equal(coerce(control("sound"), "pop"), "pop");
  assert.equal(coerce(control("soundVolume"), 500), 100, "as loud as the slider goes, no more");
  assert.equal(coerce(control("soundVolume"), 0), 10);
  assert.equal(coerce(control("soundGap"), 99), 10);
  assert.equal(coerce(control("soundGap"), -3), 0);
  assert.equal(sanitize({ sound: "gong" }).sound, "none", "something unknown falls back to silence");
  assert.equal(sanitize(null).sound, "none");
});

test("a link carries the sound only when one is chosen, and reads it back", () => {
  const base = `${"https://frills.example"}/overlay/`;
  const silent = overlayUrl(base, { channel: "pond.pal", settings: sanitize({}) });
  assert.equal(silent.includes("sound"), false, "no sound: nothing about sound in the link");
  const loud = overlayUrl(base, { channel: "pond.pal", settings: sanitize({ sound: "pop", soundVolume: 80, soundGap: 3 }) });
  const params = new URL(loud).searchParams;
  assert.deepEqual([params.get("sound"), params.get("soundVolume"), params.get("soundGap")], ["pop", "80", "3"]);
  const back = sanitize(fromParams(params));
  assert.deepEqual([back.sound, back.soundVolume, back.soundGap], ["pop", 80, 3]);
  assert.equal(overlayUrl(base, { channel: "pond.pal", settings: { ...sanitize({ sound: "pop" }), sound: "none" } }).includes("sound="), false, "choosing No sound again removes it from the link");
});

// ── when a sound plays ────────────────────────────────────────────────────────────────────────────────

const pretendPlayer = (accept = true) => {
  const played = [];
  return { played, play: (id, options) => { played.push([id, options.volume]); return accept; } };
};
let clock = 0;
const now = () => clock;

test("no sound is ever played while 'No sound' is chosen", () => {
  const player = pretendPlayer();
  const ping = chatPing(() => ({ sound: "none", soundVolume: 80, soundGap: 0 }), () => player, now);
  for (let i = 0; i < 5; i++) { clock += 5000; ping(); }
  assert.deepEqual(player.played, []);
});

test("the chosen sound plays at the chosen volume", () => {
  clock = 0;
  const player = pretendPlayer();
  chatPing(() => ({ sound: "boop", soundVolume: 35, soundGap: 1 }), () => player, now)();
  assert.deepEqual(player.played, [["boop", 35]]);
});

test("a second message inside the quiet time is silent, and the next one after it plays", () => {
  clock = 10_000;
  const player = pretendPlayer();
  const ping = chatPing(() => ({ sound: "pop", soundVolume: 50, soundGap: 2 }), () => player, now);
  ping();
  clock += 500; ping();
  clock += 1000; ping();
  assert.equal(player.played.length, 1, "1.5 seconds later is still inside the 2 seconds");
  clock += 600; ping();
  assert.equal(player.played.length, 2, "2.1 seconds after the first");
  clock += 2000; ping();
  assert.equal(player.played.length, 3, "exactly the quiet time later plays");
});

test("a quiet time of 0 means a sound for every message", () => {
  clock = 50_000;
  const player = pretendPlayer();
  const ping = chatPing(() => ({ sound: "pop", soundVolume: 50, soundGap: 0 }), () => player, now);
  for (let i = 0; i < 4; i++) ping();
  assert.equal(player.played.length, 4);
});

test("while the player is still loading, or the browser will not play yet, nothing breaks and the quiet time is not used up", () => {
  clock = 90_000;
  let ready = null;
  const ping = chatPing(() => ({ sound: "pop", soundVolume: 50, soundGap: 5 }), () => ready, now);
  ping();
  clock += 100;
  ping(); // the player has not loaded: nothing to play with, and no error
  const blocked = pretendPlayer(false);
  ready = blocked;
  clock += 100;
  ping();
  assert.equal(blocked.played.length, 1, "it tried, and the browser said no");
  const allowed = pretendPlayer(true);
  ready = allowed;
  clock += 100;
  ping();
  assert.equal(allowed.played.length, 1, "after a refusal it tries again at the next message, not five seconds later");
});

test("the settings are read at the moment of each message, so changing them while it runs takes effect", () => {
  clock = 200_000;
  let settings = { sound: "none", soundVolume: 50, soundGap: 0 };
  const player = pretendPlayer();
  const ping = chatPing(() => settings, () => player, now);
  ping();
  assert.equal(player.played.length, 0);
  settings = { sound: "coin", soundVolume: 70, soundGap: 0 };
  ping();
  assert.deepEqual(player.played, [["coin", 70]]);
});
