import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultActionsConfig,
  encodeCommands,
  decodeCommands,
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
