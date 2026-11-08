// The chat bot's brain, with a pretend clock: what it answers, how often, and the ways it must never flood the chat or answer itself.

import test from "node:test";
import assert from "node:assert/strict";
import { createReplyEngine } from "../src/js/reply-engine.js";

const commands = [
  { trigger: "mouse", title: "Mouse", text: "card text", reply: "I use a Razer Viper V3 Pro at 800 DPI" },
  { trigger: "sens", title: "Sens", text: "card text", reply: "0.31 at 800 DPI" },
  { trigger: "rank", title: "Rank", text: "card text", reply: "" },
  { trigger: "specs", title: "Specs", text: "card text", reply: "Ryzen 7 7800X3D and an RTX 4080 Super" },
];

function setup(extra = {}) {
  const clock = { t: 1_000_000 };
  const bot = createReplyEngine({ commands, prefix: ".", cooldownSeconds: 10, gapSeconds: 5, maxQueue: 2, now: () => clock.t, ...extra });
  return { bot, advance: (seconds) => (clock.t += seconds * 1000) };
}
let serial = 0;
const msg = (text, extra = {}) => ({ id: `m${++serial}`, user: `u${serial}`, text, ...extra });

test("a command with a reply is queued and posted once, and chat that is not a command is not", () => {
  const { bot } = setup();
  assert.equal(bot.handle(msg("hello chat")), "ignored");
  assert.equal(bot.handle(msg(".mouse what mouse is that?")), "queued");
  assert.equal(bot.next().text, "I use a Razer Viper V3 Pro at 800 DPI");
  assert.equal(bot.next(), null, "it was posted, so nothing is left");
});

test("a command with no chat reply posts nothing", () => {
  const { bot } = setup();
  assert.equal(bot.handle(msg(".rank")), "no reply");
  assert.equal(bot.next(), null);
});

test("the same command works again after its cooldown, for another viewer, however long the chat has been quiet", () => {
  const { bot, advance } = setup();
  assert.equal(bot.handle(msg(".mouse")), "queued");
  assert.ok(bot.next());
  advance(4);
  assert.equal(bot.handle(msg(".mouse")), "cooldown", "too soon for the same command");
  advance(7);
  assert.equal(bot.handle(msg(".mouse")), "queued", "the cooldown is over, so a new viewer is answered");
  advance(60 * 10);
  bot.next();
  assert.equal(bot.handle(msg(".mouse")), "queued", "and again after a long quiet");
});

test("one message is answered once, even when it arrives twice", () => {
  const { bot } = setup();
  const once = msg(".mouse");
  assert.equal(bot.handle(once), "queued");
  assert.equal(bot.handle(once), "duplicate");
  assert.equal(bot.waiting, 1);
});

test("different commands cannot flood the chat: a gap between posts, a short line, and the rest are dropped", () => {
  const { bot, advance } = setup({ maxQueue: 2, gapSeconds: 5 });
  assert.equal(bot.handle(msg(".mouse")), "queued");
  assert.equal(bot.handle(msg(".sens")), "queued");
  assert.equal(bot.handle(msg(".specs")), "dropped", "the line holds two");
  assert.equal(bot.next().trigger, "mouse");
  assert.equal(bot.next(), null, "too soon after the last post");
  advance(4);
  assert.equal(bot.next(), null);
  advance(1);
  assert.equal(bot.next().trigger, "sens");
  assert.deepEqual(bot.stats(), { queued: 2, dropped: 1, posted: 2, waiting: 0 });
});

test("a dropped reply does not use up the cooldown, so the next viewer who asks can be answered", () => {
  const { bot, advance } = setup({ maxQueue: 1 });
  assert.equal(bot.handle(msg(".mouse")), "queued");
  assert.equal(bot.handle(msg(".specs")), "dropped");
  bot.next();
  advance(5);
  assert.equal(bot.handle(msg(".specs")), "queued");
});

test("the bot never answers itself: its own account, and its own reply coming back through chat", () => {
  const { bot } = setup({ ownIds: ["bot-1"] });
  assert.equal(bot.handle({ id: "x1", user: "bot-1", text: ".mouse" }), "own");
  assert.equal(bot.waiting, 0);

  // a reply that itself starts with a command would be answered again, so what was posted is remembered for a minute
  const tricky = createReplyEngine({
    commands: [{ trigger: "mouse", reply: ".mouse is a Viper V3 Pro" }],
    prefix: ".",
    cooldownSeconds: 0,
    gapSeconds: 0,
    now: () => 1_000_000,
  });
  assert.equal(tricky.handle(msg(".mouse")), "queued");
  assert.equal(tricky.next().text, ".mouse is a Viper V3 Pro");
  assert.equal(tricky.handle(msg(".mouse is a Viper V3 Pro")), "own", "its own post coming back is not a viewer's question");
});

test("the reply is one clean line of at most 150 characters", () => {
  const long = "a".repeat(200);
  const bot = createReplyEngine({ commands: [{ trigger: "x", reply: `first line\n${long}` }], prefix: ".", gapSeconds: 0, now: () => 1 });
  bot.handle(msg(".x"));
  const { text } = bot.next();
  assert.ok(Array.from(text).length <= 150);
  assert.ok(!text.includes("\n"));
  assert.ok(text.startsWith("first line aaa"));
});

test("clear is the kill switch: everything waiting is thrown away", () => {
  const { bot } = setup();
  bot.handle(msg(".mouse"));
  bot.handle(msg(".sens"));
  assert.equal(bot.waiting, 2);
  bot.clear();
  assert.equal(bot.waiting, 0);
  assert.equal(bot.next(), null);
});
