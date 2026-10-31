// The alert settings and the alert engine, with no page and a pretend clock: what the options are and how a link carries them, how words
// are filled in, how a gift's size picks its tier, and when each alert shows, waits, joins a crowd or is dropped.

import test from "node:test";
import assert from "node:assert/strict";
import { CARDS, CONTROLS, SECRET_CARDS, DEFAULTS, LOOKS, alertsUrl, alertVars, coerce, currentLook, fromParams, sanitize, toParams } from "../src/js/alerts-settings.js";
import { AlertQueue, fillTemplate, makeAlert, tierOf, wording } from "../src/js/alerts.js";

// ── settings ────────────────────────────────────────────────────────────────────────────────────────────────────────

test("every option has a default of the right kind, and the defaults are what sanitize gives for nothing", () => {
  for (const c of CONTROLS) {
    assert.ok(c.key in DEFAULTS, `${c.key} has a default`);
    assert.notEqual(coerce(c, DEFAULTS[c.key]), undefined, `${c.key}'s default is acceptable to its own control`);
  }
  assert.deepEqual(sanitize(undefined), DEFAULTS);
  assert.deepEqual(sanitize({ nonsense: 1 }), DEFAULTS);
});

test("bad values are dropped, numbers are held to their range, and text is cleaned and cut", () => {
  const s = sanitize({ accent: "red", bg: "#ABCDEF", size: 999, giftTime: "7", followText: "Hi\u0000 {name}" + "x".repeat(200), followSound: "laser", enter: "bounce", merge: "yes", maxShown: 0 });
  assert.equal(s.accent, DEFAULTS.accent);
  assert.equal(s.bg, "#abcdef");
  assert.equal(s.size, 96);
  assert.equal(s.giftTime, 7);
  assert.equal(s.followText.length, 80);
  assert.ok(!s.followText.includes("\u0000"));
  assert.equal(s.followSound, DEFAULTS.followSound);
  assert.equal(s.enter, "bounce");
  assert.equal(s.merge, true, "a toggle must be a real boolean");
  assert.equal(s.maxShown, 1);
});

test("a medium gift can never be bigger than a big one", () => {
  const s = sanitize({ giftMid: 5000, giftBig: 300 });
  assert.equal(s.giftMid, 300);
});

test("a link carries only what differs from the defaults, and reads back to the same settings", () => {
  assert.equal(alertsUrl("https://x.test/overlay/alerts/"), "https://x.test/overlay/alerts/?");
  const changed = sanitize({ ...LOOKS.night, giftBigText: "WOW {name} sent {gift}!", volume: 30, merge: false, vpos: "middle", followFx: "none" });
  const url = alertsUrl("https://x.test/overlay/alerts/", { channel: "pond.pal", settings: changed });
  const params = new URL(url).searchParams;
  assert.equal(params.get("channel"), "pond.pal");
  assert.equal(params.get("platform"), "tiktok");
  assert.equal(params.get("merge"), "0");
  assert.equal(params.get("volume"), "30");
  assert.ok(!params.has("followText"), "an unchanged text is not in the link");
  assert.deepEqual(sanitize(fromParams(params)), changed);
  assert.deepEqual(sanitize(fromParams(new URLSearchParams("look=arcade&accent=%23ff0000"))), { ...DEFAULTS, ...LOOKS.arcade, accent: "#ff0000" }, "a look sets the base, and a single option wins over it");
});

test("a link with a long, unusual set of texts still stays a sensible length", () => {
  const long = sanitize({ followText: "a".repeat(80), followCrowd: "b".repeat(80), giftText: "c".repeat(80), giftBigText: "d".repeat(80), shareText: "e".repeat(80), shareCrowd: "f".repeat(80), ...LOOKS.arcade });
  assert.ok(alertsUrl("https://frills.valwidgets.live/overlay/alerts/", { channel: "a_long_tiktok_name", settings: long }).length < 1500);
});

test("the starting looks are recognized until something is changed", () => {
  assert.equal(currentLook({ ...DEFAULTS }), "sticker");
  assert.equal(currentLook({ ...DEFAULTS, ...LOOKS.matcha }), "matcha");
  assert.equal(currentLook({ ...DEFAULTS, accent: "#000000" }), null);
});

test("the look becomes plain CSS variables", () => {
  const vars = alertVars(DEFAULTS);
  for (const value of Object.values(vars)) assert.ok(!/oklch|color-mix/.test(value), "no modern color functions: old streaming browsers cannot draw them");
  assert.equal(vars["--a-speed"], "500ms");
  assert.match(vars["--a-shadow"], /5px 5px 0 #ffd23f/);
});

// ── words ───────────────────────────────────────────────────────────────────────────────────────────────────────────

test("a template is filled in with the name and the gift marked, unknown placeholders dropped, and nothing treated as HTML", () => {
  assert.deepEqual(fillTemplate("{name} sent {gift} ×{count}!", { name: "Mochi", gift: "Rose", count: 3 }), [
    { text: "Mochi", mark: true }, { text: " sent ", mark: false }, { text: "Rose", mark: true }, { text: " ×", mark: false }, { text: "3", mark: false }, { text: "!", mark: false },
  ]);
  assert.deepEqual(fillTemplate("hi {secret} {name}", { name: "A", secret: "no" }).map((p) => p.text), ["hi ", " ", "A"], "{secret} is not a placeholder");
  assert.deepEqual(fillTemplate("<b>{name}</b>", { name: "<i>x</i>" }).map((p) => p.text), ["<b>", "<i>x</i>", "</b>"], "kept as plain text for the view to draw as text");
  assert.deepEqual(fillTemplate("", {}), []);
});

test("the words follow the kind, a crowd, and a big gift", () => {
  const joined = (item) => wording(item, DEFAULTS).map((p) => p.text).join("");
  assert.equal(joined({ kind: "follow", name: "Mochi", others: 0 }), "Mochi just followed!");
  assert.equal(joined({ kind: "follow", name: "Mochi", others: 5 }), "Mochi and 5 others followed!");
  assert.equal(joined({ kind: "share", name: "Mochi", others: 0 }), "Mochi shared the LIVE!");
  assert.equal(joined({ kind: "gift", name: "Mochi", gift: "Rose", count: 3, tier: 1 }), "Mochi sent Rose ×3");
  assert.equal(joined({ kind: "gift", name: "Mochi", gift: "Galaxy", count: 1, tier: 3 }), "Mochi sent Galaxy ×1!!");
});

// ── making an alert ─────────────────────────────────────────────────────────────────────────────────────────────────

test("a gift's size in diamonds picks its tier, and bigger gifts stay longer", () => {
  assert.deepEqual([1, 99, 100, 999, 1000, 5000].map((d) => tierOf(d, DEFAULTS)), [1, 1, 2, 2, 3, 3]);
  const gift = (diamonds) => makeAlert({ kind: "gift", id: "g", name: "A", gift: "G", diamonds, count: 1, total: diamonds }, DEFAULTS);
  assert.deepEqual([gift(1).time, gift(100).time, gift(1000).time], [5000, 6500, 8500]);
  assert.equal(makeAlert({ kind: "follow", name: "A" }, DEFAULTS).time, 4000);
});

test("a kind that is switched off, and a gift below the smallest wanted, make no alert", () => {
  assert.equal(makeAlert({ kind: "follow", name: "A" }, { ...DEFAULTS, followOn: false }), null);
  assert.equal(makeAlert({ kind: "gift", name: "A", diamonds: 4 }, { ...DEFAULTS, giftMin: 5 }), null);
  assert.ok(makeAlert({ kind: "gift", name: "A", diamonds: 5 }, { ...DEFAULTS, giftMin: 5 }));
  assert.equal(makeAlert({ kind: "like", name: "A" }, DEFAULTS), null, "only follow, gift and share exist");
  assert.equal(makeAlert(null, DEFAULTS), null);
});

// ── the queue, on a pretend clock ───────────────────────────────────────────────────────────────────────────────────

/** A clock that only moves when told to. */
function clock() {
  let now = 0;
  let next = 1;
  const jobs = new Map();
  return {
    setTimeout: (fn, ms) => { const id = next++; jobs.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: (id) => jobs.delete(id),
    tick(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...jobs].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        jobs.delete(due[0]);
        due[1].fn();
      }
      now = end;
    },
  };
}
function rig(over = {}) {
  const log = [];
  const timers = clock();
  const config = { ...DEFAULTS, maxShown: 1, maxWaiting: 4, merge: true, speed: 500, ...over };
  const queue = new AlertQueue(config, { timers, onShow: (i) => log.push("+" + i.name + (i.others ? `(+${i.others})` : "")), onHide: (i) => log.push("-" + i.name) });
  const send = (kind, name, extra = {}) => queue.push(makeAlert({ kind, name, id: name, gift: "Rose", count: 1, diamonds: 1, total: 1, ...extra }, config));
  return { queue, timers, log, send };
}

test("one at a time: the second waits until the first has gone", () => {
  const { timers, log, send } = rig();
  send("follow", "A");
  send("follow", "B");
  assert.deepEqual(log, ["+A"]);
  timers.tick(4000);
  assert.deepEqual(log, ["+A", "-A"], "A has gone, B waits for A's exit to finish");
  timers.tick(400);
  assert.deepEqual(log, ["+A", "-A", "+B"]);
});

test("with room for two, two show at once and a third waits", () => {
  const { timers, log, send } = rig({ maxShown: 2 });
  send("follow", "A");
  send("follow", "B");
  send("follow", "C");
  assert.deepEqual(log, ["+A", "+B"]);
  timers.tick(4000);
  assert.deepEqual(log.slice(2, 4), ["-A", "-B"]);
  timers.tick(400);
  assert.deepEqual(log.slice(4), ["+C"]);
});

test("a gift waiting jumps ahead of follows, and a bigger gift ahead of a smaller one", () => {
  const { timers, log, send } = rig({ merge: false });
  send("follow", "A");
  send("follow", "B");
  send("gift", "G1", { diamonds: 1 });
  send("gift", "G3", { diamonds: 5000 });
  send("gift", "G2", { diamonds: 200 });
  timers.tick(60000);
  assert.deepEqual(log.filter((x) => x.startsWith("+")), ["+A", "+G3", "+G2", "+G1", "+B"]);
});

test("three or more follows waiting join into one alert with the others counted", () => {
  const { timers, log, send } = rig();
  send("follow", "First");
  for (const n of ["B", "C", "D", "E", "F"]) send("follow", n);
  timers.tick(60000);
  assert.deepEqual(log.filter((x) => x.startsWith("+")), ["+First", "+B(+4)"], "B, C, D, E and F became 'B and 4 others'");
});

test("a follow that arrives after a crowd has formed joins that crowd instead of starting another", () => {
  const { timers, log, send } = rig();
  send("follow", "First");
  for (const n of ["B", "C", "D"]) send("follow", n); // B, C and D become a crowd
  send("follow", "E");
  send("share", "S"); // a share is not part of a follow crowd
  timers.tick(60000);
  assert.deepEqual(log.filter((x) => x.startsWith("+")), ["+First", "+B(+3)", "+S"]);
});

test("follows and shares are joined separately, and a crowd is not formed when joining is off", () => {
  const { timers, log, send } = rig();
  send("follow", "First");
  send("follow", "F1"); send("share", "S1"); send("follow", "F2"); send("share", "S2");
  timers.tick(60000);
  assert.deepEqual(log.filter((x) => x.startsWith("+")), ["+First", "+F1", "+S1", "+F2", "+S2"], "two of each is not yet a crowd");
  const off = rig({ merge: false, maxWaiting: 20 });
  off.send("follow", "First");
  for (const n of ["B", "C", "D", "E"]) off.send("follow", n);
  off.timers.tick(60000);
  assert.equal(off.log.filter((x) => x.startsWith("+")).length, 5, "nobody was joined");
});

test("when the line is too long the oldest follow goes first, and a gift is kept", () => {
  const { timers, log, queue, send } = rig({ merge: false, maxWaiting: 3 });
  send("follow", "A");
  send("follow", "F1"); send("follow", "F2"); send("gift", "G", { diamonds: 1 });
  send("follow", "F3");
  assert.equal(queue.dropped, 1);
  timers.tick(60000);
  assert.deepEqual(log.filter((x) => x.startsWith("+")), ["+A", "+G", "+F2", "+F3"], "F1, the oldest follow, was dropped");
});

test("changing the settings (a bigger limit) lets waiting alerts through, and clear empties everything", () => {
  const { timers, log, queue, send } = rig({ merge: false });
  send("follow", "A");
  send("follow", "B");
  queue.setConfig({ ...queue.config, maxShown: 2 });
  assert.deepEqual(log, ["+A", "+B"]);
  send("follow", "C");
  queue.clear();
  assert.deepEqual(log.slice(2), ["-A", "-B"]);
  timers.tick(60000);
  assert.equal(log.length, 4, "the cleared one never shows");
});

// ── the sounds, against a pretend audio system ─────────────────────────────────────────────────────────────────────

import { SOUNDS } from "../src/js/alerts-settings.js";
import { createSounds, soundIds } from "../src/js/sounds.js";

/** A pretend AudioContext that only counts what is asked of it. */
function pretendAudio({ state = "running", resumeTo = "running", neverAnswers = false } = {}) {
  const made = { oscillators: [], gains: 0 };
  class Context {
    constructor() { this.state = state; this.currentTime = 0; this.destination = {}; }
    resume() { return neverAnswers ? new Promise(() => {}) : Promise.resolve().then(() => { this.state = resumeTo; }); }
    createGain() { made.gains += 1; return { gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    createOscillator() {
      const osc = { frequency: { setValueAtTime(f) { osc.first ??= f; }, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} };
      made.oscillators.push(osc);
      return osc;
    }
  }
  return { Context, made };
}

test("every sound in the list exists, and the list has nothing the player can't make", () => {
  assert.deepEqual(SOUNDS.map((s) => s.id).filter((id) => id !== "none").sort(), soundIds().sort());
});

test("a bigger gift plays the sound again, higher: once, twice, three times", () => {
  const counts = [1, 2, 3].map((tier) => {
    const { Context, made } = pretendAudio();
    const sounds = createSounds(Context);
    assert.equal(sounds.play("pop", { tier }), true);
    return made.oscillators.length;
  });
  assert.deepEqual(counts, [1, 2, 3], "pop is one note, so the count is the number of layers");
  const { Context, made } = pretendAudio();
  createSounds(Context).play("pop", { tier: 3 });
  const [low, mid, high] = made.oscillators.map((o) => o.first);
  assert.ok(low < mid && mid < high, "each layer is higher than the one before");
});

test("silence, an unknown sound, a blocked browser and no audio at all all play nothing and never throw", async () => {
  const quiet = pretendAudio();
  const sounds = createSounds(quiet.Context);
  assert.equal(sounds.play("none"), false);
  assert.equal(sounds.play("laser"), false);
  assert.equal(sounds.play("pop", { volume: 0 }), false);
  assert.equal(quiet.made.oscillators.length, 0);

  const blocked = pretendAudio({ state: "suspended", resumeTo: "suspended" });
  const stuck = createSounds(blocked.Context);
  assert.equal(stuck.play("pop"), false, "the browser is waiting for a click");
  assert.equal(await stuck.unlock(), false);
  assert.equal(stuck.state, "suspended");

  assert.equal(createSounds(null).play("pop"), false);
  assert.equal(createSounds(null).state, "none");
  assert.equal(await createSounds(null).unlock(), false);
});

test("a click unlocks sound, and a browser that never answers the unlock does not freeze the page", async () => {
  const ok = pretendAudio({ state: "suspended", resumeTo: "running" });
  const sounds = createSounds(ok.Context);
  assert.equal(await sounds.unlock(), true);
  assert.equal(sounds.play("chime"), true);

  const never = pretendAudio({ state: "suspended", neverAnswers: true });
  const started = Date.now();
  assert.equal(await createSounds(never.Context).unlock(), false);
  assert.ok(Date.now() - started < 1500, "it gave up waiting after a moment");
});

// ── Twitch: subs, gifted subs, bits and raids go through the same engine ─────────────────────────────────────────────────────────

test("the Twitch kinds have words, a size and a time of their own", () => {
  const joined = (item) => wording(item, DEFAULTS).map((p) => p.text).join("");
  assert.equal(joined({ kind: "sub", name: "Newbie", count: 1, resub: false, tier: 1 }), "Newbie subscribed!");
  assert.equal(joined({ kind: "sub", name: "Oldie", count: 14, resub: true, tier: 2 }), "Oldie resubscribed for 14 months!");
  assert.equal(joined({ kind: "sub", name: "Oldie", count: 1, resub: true, tier: 1 }), "Oldie subscribed!", "a resub of one month reads as a new sub");
  assert.equal(joined({ kind: "subgift", name: "Kind", count: 10, tier: 2 }), "Kind gifted 10 subs!");
  assert.equal(joined({ kind: "subgift", name: "Kind", count: 1, tier: 1 }), "Kind gifted a sub!", "one sub is not \"1 subs\"");
  assert.equal(joined({ kind: "bits", name: "Cheerer", count: 50, tier: 1 }), "Cheerer cheered 50 bits!");
  assert.equal(joined({ kind: "bits", name: "Cheerer", count: 5000, tier: 3 }), "Cheerer cheered 5000 bits!!");
  assert.equal(joined({ kind: "raid", name: "Big", count: 250, tier: 3 }), "Big is raiding with 250 viewers!");
  const bits = (count) => makeAlert({ kind: "bits", id: "b", name: "A", count }, DEFAULTS);
  assert.deepEqual([bits(1), bits(99), bits(100), bits(999), bits(1000)].map((a) => a.tier), [1, 1, 2, 2, 3]);
  const gifts = (count) => makeAlert({ kind: "subgift", id: "s", name: "A", count }, DEFAULTS).tier;
  assert.deepEqual([gifts(1), gifts(5), gifts(20)], [1, 2, 3]);
  const raid = (count) => makeAlert({ kind: "raid", id: "r", name: "A", count }, DEFAULTS).tier;
  assert.deepEqual([raid(10), raid(25), raid(100)], [1, 2, 3]);
  const sub = (count) => makeAlert({ kind: "sub", id: "u", name: "A", count, resub: true }, DEFAULTS).tier;
  assert.deepEqual([sub(1), sub(12), sub(36)], [1, 2, 3]);
  assert.equal(makeAlert({ kind: "raid", id: "r", name: "A", count: 10 }, DEFAULTS).time, 8000);
  assert.equal(makeAlert({ kind: "sub", id: "u", name: "A", count: 1 }, DEFAULTS).sound, "levelup");
});

test("a Twitch kind that is switched off, and a cheer below the smallest wanted, make no alert", () => {
  assert.equal(makeAlert({ kind: "raid", name: "A", count: 5 }, { ...DEFAULTS, raidOn: false }), null);
  assert.equal(makeAlert({ kind: "sub", name: "A", count: 1 }, { ...DEFAULTS, subOn: false }), null);
  assert.equal(makeAlert({ kind: "bits", name: "A", count: 9 }, { ...DEFAULTS, bitsMin: 10 }), null);
  assert.ok(makeAlert({ kind: "bits", name: "A", count: 10 }, { ...DEFAULTS, bitsMin: 10 }));
});

test("a medium cheer can never be bigger than a big one, and a link names Twitch only when it is Twitch", () => {
  assert.equal(sanitize({ bitsMid: 800, bitsBig: 300 }).bitsMid, 300);
  const url = (platform) => alertsUrl("https://x.test/overlay/alerts/", { channel: "me", settings: DEFAULTS, platform });
  assert.equal(url("twitch"), "https://x.test/overlay/alerts/?channel=me&platform=twitch");
  assert.equal(url("tiktok"), "https://x.test/overlay/alerts/?channel=me&platform=tiktok");
  assert.equal(url(undefined), "https://x.test/overlay/alerts/?channel=me&platform=tiktok");
  const custom = sanitize({ raidText: "{name} brought {count}!", subSound: "bell" });
  assert.deepEqual(fromParams(new URLSearchParams(toParams(custom))), { raidText: "{name} brought {count}!", subSound: "bell" });
});

test("Twitch alerts outrank follows when the line is too long, and are never joined into a crowd", () => {
  const { send, log, timers } = rig({ maxWaiting: 3 });
  send("follow", "F1");
  send("follow", "F2");
  send("raid", "R1", { count: 40 });
  send("sub", "S1", { count: 1 });
  send("bits", "B1", { count: 5 });
  send("sub", "S2", { count: 1 });
  timers.tick(60000);
  const shown = log.filter((l) => l.startsWith("+"));
  assert.ok(shown.some((l) => l.includes("R1")), "the raid was kept");
  assert.ok(!shown.some((l) => l.includes("(+")), "no crowd was made out of subs or bits");
  assert.ok(!shown.some((l) => l.includes("F2")), "a follow was dropped before the Twitch alerts");
});

test("card styles: twelve formats, the plain card is the default, only a known one is accepted, and a starting look never changes it", () => {
  assert.deepEqual(CARDS.map((c) => c.id), ["card", "trading", "profile", "ticket", "polaroid", "stack", "note", "capsule", "banner", "bubble", "neon", "text"]);
  assert.equal(DEFAULTS.card, "card");
  assert.equal(CONTROLS.find((c) => c.key === "card").section, "look");
  assert.equal(sanitize({ card: "banner" }).card, "banner");
  assert.equal(sanitize({ card: "sideways" }).card, "card", "a made-up style falls back to the card");
  assert.equal(sanitize({ card: "<img>" }).card, "card");
  assert.equal(sanitize(fromParams(new URLSearchParams("card=neon"))).card, "neon", "a link can carry it");
  assert.equal(alertsUrl("https://x.test/o/", { settings: { ...DEFAULTS } }), "https://x.test/o/?", "the plain card adds nothing to a link");
  assert.equal(new URL(alertsUrl("https://x.test/o/", { channel: "a", settings: { ...DEFAULTS, card: "ticket" } })).searchParams.get("card"), "ticket");
  for (const id of Object.keys(LOOKS)) assert.equal(sanitize(fromParams(new URLSearchParams(`card=text&look=${id}`))).card, "text", `the ${id} look leaves the card style alone`);
  assert.equal(currentLook({ ...DEFAULTS, card: "bubble" }), "sticker", "a card style is not part of a look");
});

test("a card style the editor does not offer (the frog pond, from the Matcha page) still works from a link, and nothing else gets in that way", () => {
  assert.deepEqual(SECRET_CARDS, ["frogpond"]);
  assert.equal(CARDS.some((c) => SECRET_CARDS.includes(c.id)), false, "it is not in the list the editor shows");
  assert.equal(sanitize({ card: "frogpond" }).card, "frogpond");
  assert.equal(sanitize(fromParams(new URLSearchParams("card=frogpond"))).card, "frogpond");
  assert.equal(new URL(alertsUrl("https://x.test/o/", { channel: "a", settings: { ...DEFAULTS, card: "frogpond" } })).searchParams.get("card"), "frogpond", "and it stays in a link");
  assert.equal(sanitize({ card: "frogpond2" }).card, "card");
  assert.equal(sanitize({ font: "frogpond" }).font, DEFAULTS.font, "the allowance is for the card setting only");
  assert.equal(coerce(CONTROLS.find((c) => c.key === "font"), "frogpond"), undefined);
});

test("the pictures on a card are their own secret setting: none to begin with, any pack of the chat's, never shown by the public editor, and in a link only when set", () => {
  assert.equal(DEFAULTS.deco, "none");
  const control = CONTROLS.find((c) => c.key === "deco");
  assert.equal(control.secret, true, "the public editor leaves out what is marked secret");
  assert.deepEqual(CONTROLS.filter((c) => c.secret).map((c) => c.key), ["deco"], "and nothing else is");
  assert.deepEqual(control.options.map((o) => o.id), ["none", "frog", "frog2", "neko", "hamster", "bunny", "halloween", "christmas"]);
  assert.equal(sanitize({ deco: "frog2" }).deco, "frog2");
  assert.equal(sanitize({ deco: "dragons" }).deco, "none");
  assert.equal(sanitize({ deco: "<img>" }).deco, "none");
  assert.equal(sanitize(fromParams(new URLSearchParams("deco=frog2&card=trading"))).deco, "frog2", "from a link, on any card style");
  const plain = new URL(alertsUrl("https://x.test/o/", { channel: "a", settings: { ...DEFAULTS } }));
  assert.equal(plain.searchParams.has("deco"), false);
  const dressed = new URL(alertsUrl("https://x.test/o/", { channel: "a", settings: { ...DEFAULTS, deco: "frog2", card: "ticket" } }));
  assert.deepEqual([dressed.searchParams.get("deco"), dressed.searchParams.get("card")], ["frog2", "ticket"]);
  assert.equal(currentLook({ ...DEFAULTS, deco: "frog2" }), "sticker", "a starting look does not touch them");
});
