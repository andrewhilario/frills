// Pure client-side Talking Pet TTS logic tests: cleaning text, gift/chat rules, cooldowns, and queue ordering.

import test from "node:test";
import assert from "node:assert/strict";
import { TTS, TtsQueue, cleanSpeechText, roleAllowedForTts, ttsSpeechFor } from "../src/js/tts.js";
import { pickBrowserVoice } from "../src/js/tts-audio.js";

test("cleanSpeechText removes URLs, control bytes, spam punctuation, and caps length", () => {
  assert.equal(cleanSpeechText("check https://evil.example/a?b=1   now!!!!!"), "check now!!");
  assert.equal(cleanSpeechText("hello\u0007\nworld"), "hello world");
  assert.equal(cleanSpeechText("https://only-a-link.test"), "");
  assert.equal(cleanSpeechText("one two three four five", 12), "one two thre");
});

test("ttsSpeechFor filters gifts by trigger, diamond threshold, and readUser setting", () => {
  const base = { ...TTS.defaults, trigger: "both", minDiamonds: 5, announceGift: true, readUser: true };

  assert.equal(ttsSpeechFor({ kind: "gift", name: "Maya", gift: "Rose", diamonds: 1, count: 1 }, base), null);

  const streak = ttsSpeechFor({ kind: "gift", name: "Maya", gift: "Rose", diamonds: 1, count: 5 }, base);
  assert.equal(streak.kind, "gift");
  assert.equal(streak.badge, "5x Rose");
  assert.equal(streak.text, "Maya sent 5 Rose!");

  const anon = ttsSpeechFor({ kind: "gift", name: "Maya", gift: "Galaxy", diamonds: 1000, count: 1 }, { ...base, readUser: false });
  assert.equal(anon.text, "Galaxy!");

  assert.equal(ttsSpeechFor({ kind: "gift", name: "Maya", gift: "Lion", diamonds: 29999, count: 1 }, { ...base, trigger: "cmd" }), null);
  assert.equal(ttsSpeechFor({ kind: "gift", name: "Maya", gift: "Lion", diamonds: 29999, count: 1 }, { ...base, announceGift: false }), null);
  assert.equal(ttsSpeechFor({ kind: "follow", name: "Maya" }, base), null);

  // Twitch alerts (bits, sub, subgift, raid)
  assert.equal(ttsSpeechFor({ kind: "bits", name: "Maya", count: 3 }, base), null, "bits below minDiamonds threshold are skipped");
  const bits = ttsSpeechFor({ kind: "bits", name: "Maya", count: 500 }, base);
  assert.equal(bits.badge, "500 bits");
  assert.equal(bits.text, "Maya cheered 500 bits!");

  const sub = ttsSpeechFor({ kind: "sub", name: "Maya" }, base);
  assert.equal(sub.badge, "sub");
  assert.equal(sub.text, "Maya just subscribed!");

  const subgift = ttsSpeechFor({ kind: "subgift", name: "Maya", count: 5 }, base);
  assert.equal(subgift.badge, "5x gifted subs");
  assert.equal(subgift.text, "Maya gifted 5 subs!");

  const raid = ttsSpeechFor({ kind: "raid", name: "Maya", count: 42 }, base);
  assert.equal(raid.badge, "raid · 42");
  assert.equal(raid.text, "Maya raided with 42 viewers!");
});

test("ttsSpeechFor handles !say prefix cleanly and respects all_chat vs gift-only modes", () => {
  const cmdCfg = { ...TTS.defaults, trigger: "cmd", command: "!say", readUser: true };

  assert.equal(ttsSpeechFor({ name: "Kai", text: "just chatting" }, cmdCfg), null);
  assert.equal(ttsSpeechFor({ name: "Kai", text: "!saying something" }, cmdCfg), null, "requires whitespace after prefix");
  assert.equal(ttsSpeechFor({ name: "Kai", text: "!say   " }, cmdCfg), null);

  const ok = ttsSpeechFor({ name: "Kai", text: "!SAY happy birthday frog!" }, cmdCfg);
  assert.equal(ok.kind, "chat");
  assert.equal(ok.message, "happy birthday frog!");
  assert.equal(ok.text, "Kai says: happy birthday frog!");

  const all = ttsSpeechFor({ name: "Kai", text: "normal message" }, { ...cmdCfg, trigger: "all_chat", readUser: false });
  assert.equal(all.text, "normal message");

  assert.equal(ttsSpeechFor({ name: "Kai", text: "!say ignored" }, { ...cmdCfg, trigger: "gift" }), null);

  // Per-event giftVoice & Twitch role filtering (who: subs / vips / mods)
  const giftPersona = ttsSpeechFor({ kind: "bits", name: "Kai", count: 200 }, { ...TTS.defaults, voice: "nova", giftVoice: "fable" });
  assert.equal(giftPersona.voice, "fable");

  assert.equal(roleAllowedForTts({ name: "Kai" }, "subs"), false);
  assert.equal(roleAllowedForTts({ name: "Kai", subscriber: true }, "subs"), true);
  assert.equal(roleAllowedForTts({ name: "Kai", vip: true }, "vips"), true);
  assert.equal(roleAllowedForTts({ name: "Kai", subscriber: true }, "vips"), false);
  assert.equal(roleAllowedForTts({ name: "Kai", mod: true }, "mods"), true);
  assert.equal(roleAllowedForTts({ name: "Kai", broadcaster: true }, "mods"), true);
  assert.equal(ttsSpeechFor({ name: "Viewer", text: "!say let me in" }, { ...cmdCfg, who: "subs" }), null);
  assert.equal(ttsSpeechFor({ name: "SubFan", text: "!say sub hype!", subscriber: true }, { ...cmdCfg, who: "subs" }).message, "sub hype!");
});

test("TtsQueue runs utterances sequentially, enforces per-viewer cooldown, and caps backlog", async () => {
  let nowMs = 10_000;
  const spoken = [];
  const releases = [];
  let idleCount = 0;

  const q = new TtsQueue(
    { ...TTS.defaults, cooldownSec: 8 },
    {
      now: () => nowMs,
      maxQueue: 2,
      gapMs: 0,
      speak: (item) =>
        new Promise((resolve) => {
          spoken.push(item.text);
          releases.push(resolve);
        }),
      onIdle: () => { idleCount += 1; },
    },
  );

  // First item starts immediately (shifted out of pending before awaiting speak)
  assert.equal(q.enqueue({ userKey: "amy", text: "first" }), true);
  // Same user within 8s cooldown is skipped unless bypassCooldown is set
  assert.equal(q.enqueue({ userKey: "amy", text: "spam" }), false);
  assert.equal(q.enqueue({ userKey: "amy", text: "forced" }, { bypassCooldown: true }), true);
  // Pending now holds ["forced"]; enqueue one more puts it at maxQueue (2)
  assert.equal(q.enqueue({ userKey: "bob", text: "second queued" }), true);
  // Third pending exceeds maxQueue=2
  assert.equal(q.enqueue({ userKey: "cal", text: "dropped" }), false);

  // Cooldown expires after 8s for Amy
  nowMs += 8000;
  // Clear first running item so pending advances
  releases.shift()();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(spoken[1], "forced");
  assert.equal(q.enqueue({ userKey: "amy", text: "after cooldown" }), true);

  while (spoken.length < 4) {
    while (releases.length) releases.shift()();
    await new Promise((r) => setTimeout(r, 5));
  }
  while (releases.length) releases.shift()();
  await new Promise((r) => setTimeout(r, 15));
  assert.deepEqual(spoken, ["first", "forced", "second queued", "after cooldown"]);
  assert.ok(idleCount >= 1);

  q.clear();
  assert.equal(q.pending.length, 0);
});

test("TTS settings sanitize out-of-range inputs and round-trip through query params", () => {
  const clean = TTS.sanitize({ engine: "bogus", pet: "dragon", rate: 999, volume: -5, maxChars: 12, command: "!talk", minDiamonds: 25 });
  assert.equal(clean.engine, "auto");
  assert.equal(clean.pet, "frog2");
  assert.equal(clean.rate, 150);
  assert.equal(clean.volume, 10);
  assert.equal(clean.maxChars, 40);
  assert.equal(clean.command, "!talk");
  assert.equal(clean.minDiamonds, 25);

  const params = TTS.toParams({ ...TTS.defaults, pet: "neko", voice: "shimmer", trigger: "cmd" });
  const parsed = TTS.fromParams(params);
  assert.deepEqual([parsed.pet, parsed.voice, parsed.trigger], ["neko", "shimmer", "cmd"]);
});

test("pickBrowserVoice maps personas onto distinct installed/Natural voices and honors explicit filter", () => {
  const voices = [
    { name: "Microsoft David Desktop", lang: "en-US" },
    { name: "Microsoft Zira Desktop", lang: "en-US" },
    { name: "Microsoft Aria Online (Natural)", lang: "en-US" },
    { name: "Microsoft Jenny Online (Natural)", lang: "en-US" },
    { name: "Microsoft Guy Online (Natural)", lang: "en-US" },
    { name: "Microsoft Andrew Online (Natural)", lang: "en-US" },
    { name: "Microsoft Sonia Online (Natural)", lang: "en-GB" },
  ];

  assert.equal(pickBrowserVoice(voices, { voice: "nova" }).name, "Microsoft Aria Online (Natural)");
  assert.equal(pickBrowserVoice(voices, { voice: "shimmer" }).name, "Microsoft Jenny Online (Natural)");
  assert.equal(pickBrowserVoice(voices, { voice: "echo" }).name, "Microsoft Guy Online (Natural)");
  assert.equal(pickBrowserVoice(voices, { voice: "onyx" }).name, "Microsoft Andrew Online (Natural)");
  assert.equal(pickBrowserVoice(voices, { voice: "fable" }).name, "Microsoft Sonia Online (Natural)");
  assert.equal(pickBrowserVoice(voices, { voice: "nova", browserVoice: "Zira" }).name, "Microsoft Zira Desktop");
});
