import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultActionsConfig,
  encodeCommands,
  decodeCommands,
  readCommands,
  cleanTrigger,
  commandProblems,
  matchCommand,
  createCooldownTracker,
} from "../src/js/actions.js";

test("default actions config is populated with standard commands and cute defaults", () => {
  const config = defaultActionsConfig();
  assert.equal(config.prefix, ".");
  assert.equal(config.pack, "frog2");
  assert.equal(config.duration, 6);
  assert.equal(config.cooldown, 10);
  assert.equal(config.sound, "chime");
  assert.ok(config.commands.length >= 4);
  assert.ok(config.commands.some((c) => c.trigger === "mouse"));
  assert.ok(config.commands.some((c) => c.trigger === "sens"));
  assert.ok(config.commands.some((c) => c.trigger === "specs"));
});

test("encodeCommands and decodeCommands roundtrips cleanly without accounts or loss", () => {
  const original = {
    prefix: "!",
    pack: "neko",
    duration: 8,
    cooldown: 15,
    sound: "pop",
    position: "top-right",
    commands: [
      { trigger: "mouse", title: "My Mouse", text: "Viper V3 Pro @ 1600 DPI", icon: "🐭" },
      { trigger: "crosshair", title: "Crosshair Code", text: "0;P;c;5;o;1;0t;1;0l;3;0o;2;0a;1", icon: "🎯" },
    ],
  };

  const encoded = encodeCommands(original);
  assert.ok(typeof encoded === "string");
  assert.ok(encoded.length > 0);
  assert.ok(!/[+/=]/.test(encoded), "URL-safe base64: no +, /, or = characters");

  const decoded = decodeCommands(encoded);
  assert.equal(decoded.prefix, "!");
  assert.equal(decoded.pack, "neko");
  assert.equal(decoded.duration, 8);
  assert.equal(decoded.cooldown, 15);
  assert.equal(decoded.sound, "pop");
  assert.equal(decoded.position, "top-right");
  assert.equal(decoded.commands.length, 2);
  assert.equal(decoded.commands[0].trigger, "mouse");
  assert.equal(decoded.commands[0].title, "My Mouse");
  assert.equal(decoded.commands[0].text, "Viper V3 Pro @ 1600 DPI");
  assert.equal(decoded.commands[1].trigger, "crosshair");
});

test("decodeCommands safely falls back to defaults on null, invalid or corrupted input", () => {
  const fallbackNull = decodeCommands(null);
  assert.equal(fallbackNull.prefix, ".");
  assert.ok(fallbackNull.commands.length > 0);

  const fallbackCorrupt = decodeCommands("not-valid-base64-json-at-all!!!");
  assert.equal(fallbackCorrupt.prefix, ".");
  assert.ok(fallbackCorrupt.commands.length > 0);
});

test("matchCommand matches prefix + trigger, case-insensitively, and handles extra chat words", () => {
  const commands = [
    { trigger: "mouse", title: "Mouse", text: "Superlight 2", icon: "🖱️" },
    { trigger: "sens", title: "Sens", text: "0.31 @ 800", icon: "🎯" },
    { trigger: "!discord", title: "Discord", text: "discord.gg/frills", icon: "💬" },
  ];

  // Default prefix "."
  assert.ok(matchCommand(".mouse", commands, "."));
  assert.equal(matchCommand(".mouse", commands, ".").title, "Mouse");
  assert.equal(matchCommand(".MOUSE", commands, ".").title, "Mouse");
  assert.equal(matchCommand(".mouse what mouse do you use?", commands, ".").title, "Mouse");

  // Prefix "!"
  assert.equal(matchCommand("!mouse", commands, "!").title, "Mouse");
  assert.equal(matchCommand(".mouse", commands, "!"), null);

  // Trigger that already has its own prefix "!discord"
  assert.equal(matchCommand("!discord", commands, ".").title, "Discord");

  // Non-matching command
  assert.equal(matchCommand("hello chat", commands, "."), null);
  assert.equal(matchCommand(".keyboard", commands, "."), null);
});

test("createCooldownTracker enforces cooldown periods per command", () => {
  const tracker = createCooldownTracker(5); // 5 second cooldown
  assert.equal(tracker.canTrigger("mouse"), true);

  tracker.record("mouse");
  assert.equal(tracker.canTrigger("mouse"), false);
  assert.ok(tracker.remaining("mouse") <= 5 && tracker.remaining("mouse") > 0);

  // Other commands are not blocked
  assert.equal(tracker.canTrigger("sens"), true);
});

const linkOf = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

test("a cooldown of 0 (Off) survives the link, and a missing number still gets its default", () => {
  const off = decodeCommands(encodeCommands({ ...defaultActionsConfig(), cooldown: 0 }));
  assert.equal(off.cooldown, 0, "Off must stay Off, not turn into the 10 s default");

  const tracker = createCooldownTracker(off.cooldown);
  tracker.record("mouse");
  assert.equal(tracker.canTrigger("mouse"), true, "with the cooldown off a command can pop up again at once");

  assert.equal(decodeCommands(encodeCommands({ ...defaultActionsConfig(), cooldown: 30 })).cooldown, 30);
  const noNumbers = decodeCommands(encodeCommands({ ...defaultActionsConfig(), cooldown: undefined, duration: "" }));
  assert.equal(noNumbers.cooldown, 10);
  assert.equal(noNumbers.duration, 6);
  assert.equal(decodeCommands(encodeCommands({ ...defaultActionsConfig(), duration: 500 })).duration, 30, "the limits still hold");
  assert.equal(decodeCommands(encodeCommands({ ...defaultActionsConfig(), duration: 0 })).duration, 2, "a display time cannot be shorter than 2 s");
});

test("readCommands tells a missing link, a good one and a damaged one apart", () => {
  assert.equal(readCommands("").state, "none");
  assert.equal(readCommands(null).state, "none");

  const mine = {
    ...defaultActionsConfig(),
    commands: [
      { trigger: "keys", title: "Keyboard", text: "Wooting 60HE", icon: "⌨️" },
      { trigger: "mouse", title: "Mouse", text: "Razer Viper", icon: "🖱️" },
    ],
  };
  const link = encodeCommands(mine);
  const good = readCommands(link);
  assert.equal(good.state, "ok");
  assert.equal(good.config.commands[0].text, "Wooting 60HE");

  // a link cut off by a chat app is "broken": an overlay must not show the sample gear for it
  for (const part of [0.3, 0.5, 0.7, 0.9]) {
    assert.equal(readCommands(link.slice(0, Math.floor(link.length * part))).state, "broken", `cut at ${part}`);
  }
  assert.equal(readCommands("not-valid-base64-json-at-all!!!").state, "broken");
  assert.equal(readCommands(linkOf([1, 2, 3])).state, "broken", "a list is not a configuration");
  // an editor can still carry on from a broken link: it gets the starting commands
  assert.ok(readCommands(link.slice(0, 40)).config.commands.length > 0);
});

test("a person's empty list stays empty, and only a link with no list at all gets the starting commands", () => {
  const empty = readCommands(encodeCommands({ ...defaultActionsConfig(), commands: [] }));
  assert.equal(empty.state, "ok");
  assert.equal(empty.config.commands.length, 0, "deleting every command must not bring the sample commands back");

  const noList = readCommands(linkOf({ p: "!" }));
  assert.equal(noList.state, "ok");
  assert.equal(noList.config.prefix, "!");
  assert.ok(noList.config.commands.length > 0);
});

test("triggers are kept without spaces, and commands that can never pop up are found", () => {
  assert.equal(cleanTrigger("  My Mouse "), "mymouse");
  assert.equal(cleanTrigger(null), "");

  // a trigger with a space is repaired on the way in, so it can fire
  const fromLink = readCommands(linkOf({ a: [{ t: "my mouse", h: "Mouse", d: "x", i: "" }] }));
  assert.equal(fromLink.config.commands[0].trigger, "mymouse");
  assert.ok(matchCommand(".mymouse", fromLink.config.commands, "."));
  // and a command with no trigger at all is dropped
  assert.equal(readCommands(linkOf({ a: [{ t: "  ", h: "x", d: "x", i: "" }] })).config.commands.length, 0);

  assert.deepEqual(commandProblems([{ trigger: "mouse" }, { trigger: "sens" }]), []);
  assert.deepEqual(commandProblems([{ trigger: "mouse" }, { trigger: "Mouse " }, { trigger: "" }]), [
    { kind: "duplicate", trigger: "mouse", index: 1, first: 0 },
    { kind: "empty", index: 2 },
  ]);
});
