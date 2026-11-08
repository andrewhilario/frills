// The chat bot runner with a pretend TikTok: it does nothing unless it is given a file; for the channels in the file it answers a viewer's
// command in chat with the streamer's own reply, spaced out and capped; it never answers itself; and it stops when the signing service
// refuses. No network and no TikTok login are used.

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createBotRunner, loadBots, parseLink } from "../helper/bot.mjs";
import { defaultActionsConfig, encodeCommands } from "../src/js/actions.js";

class FakeConnection extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
    this.fail = null;
    this.closed = false;
  }
  async connect() {}
  disconnect() {
    this.closed = true;
    this.emit("disconnected");
  }
  async sendMessage(text) {
    if (this.fail) throw this.fail;
    this.sent.push(text);
  }
}

const link = (extra = {}) =>
  encodeCommands({
    ...defaultActionsConfig(),
    chat: true,
    cooldown: 0,
    commands: [
      { trigger: "mouse", title: "Mouse", text: "card", icon: "x", reply: "Viper V3 Pro at 800 DPI" },
      { trigger: "sens", title: "Sens", text: "card", icon: "x", reply: "0.31 at 800 DPI" },
      { trigger: "rank", title: "Rank", text: "card", icon: "x", reply: "" },
    ],
    ...extra,
  });
const entry = (extra = {}) => ({ channel: "pond.pal", link: link(), sessionId: "SESSION", ttTargetIdc: "IDC", ...extra });

function setup(bots, tuning = {}) {
  const conns = [];
  const logs = [];
  let text = JSON.stringify({ bots });
  const runner = createBotRunner({
    readText: () => text,
    factory: async () => {
      const conn = new FakeConnection();
      conns.push(conn);
      return conn;
    },
    log: (line) => logs.push(line),
    tickMs: 5,
    reloadMs: 1e9,
    retryMs: [5],
    gapSeconds: 0.05,
    ...tuning,
  });
  return { runner, conns, logs, setText: (t) => (text = t) };
}
let serial = 0;
const chat = (conn, content, login = "ann") => {
  const id = `m${++serial}`;
  conn.emit("chat", { common: { msgId: id }, user: { id, displayId: login, nickname: login }, content });
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (check, ms = 2000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await check()) return;
    await sleep(5);
  }
  throw new Error("Timed out");
};

test("with no file nothing runs", () => {
  const runner = createBotRunner({});
  runner.start();
  assert.equal(runner.count, 0);
  runner.stop();
});

test("a viewer's command is answered in chat with the streamer's own reply, and other chat posts nothing", async () => {
  const { runner, conns } = setup([entry()]);
  runner.start();
  await until(() => conns.length === 1);
  chat(conns[0], "hello chat");
  chat(conns[0], ".rank what rank are you");
  await sleep(120);
  assert.deepEqual(conns[0].sent, [], "not a command, and a command with no chat reply");
  chat(conns[0], ".mouse what mouse is that?");
  await until(() => conns[0].sent.length === 1);
  assert.deepEqual(conns[0].sent, ["Viper V3 Pro at 800 DPI"]);
  runner.stop();
});

test("different commands are spaced out, not posted together", async () => {
  const { runner, conns } = setup([entry()], { gapSeconds: 0.3 });
  runner.start();
  await until(() => conns.length === 1);
  chat(conns[0], ".mouse");
  chat(conns[0], ".sens");
  await until(() => conns[0].sent.length === 1);
  await sleep(100);
  assert.equal(conns[0].sent.length, 1, "the second waits for the gap");
  await until(() => conns[0].sent.length === 2);
  assert.deepEqual(conns[0].sent, ["Viper V3 Pro at 800 DPI", "0.31 at 800 DPI"]);
  runner.stop();
});

test("when chat replies are off in the editor, or the link is cut off, no connection is even made", async () => {
  const full = link();
  const { runner, conns, logs } = setup([
    entry({ channel: "off", link: link({ chat: false }) }),
    entry({ channel: "cut", link: full.slice(0, Math.floor(full.length * 0.6)) }),
    entry({ channel: "empty", link: link({ commands: [{ trigger: "mouse", title: "Mouse", text: "card", icon: "x", reply: "" }] }) }),
  ]);
  runner.start();
  await sleep(150);
  assert.equal(conns.length, 0);
  assert.ok(logs.some((l) => /not switched on/.test(l)));
  assert.ok(logs.some((l) => /could not be read/.test(l)));
  assert.ok(logs.some((l) => /no command has a chat reply/.test(l)));
  runner.stop();
});

test("the bot's own account is never answered", async () => {
  const { runner, conns } = setup([entry({ ownLogins: ["@TheBot"] })]);
  runner.start();
  await until(() => conns.length === 1);
  chat(conns[0], ".mouse", "thebot");
  await sleep(150);
  assert.deepEqual(conns[0].sent, []);
  chat(conns[0], ".mouse", "ann");
  await until(() => conns[0].sent.length === 1);
  runner.stop();
});

test("if the signing service refuses (a free plan), it says so and posts nothing more", async () => {
  const { runner, conns, logs } = setup([entry()]);
  runner.start();
  await until(() => conns.length === 1);
  conns[0].fail = Object.assign(new Error("Sending chats requires an API key & a paid plan"), { name: "PremiumFeatureError" });
  chat(conns[0], ".mouse");
  await until(() => logs.some((l) => /refused to send chat/.test(l)));
  conns[0].fail = null;
  chat(conns[0], ".sens");
  await sleep(200);
  assert.deepEqual(conns[0].sent, [], "it stays off, even if the connection would now work");
  runner.stop();
});

test("one account never posts more than the hourly cap", async () => {
  const { runner, conns } = setup([entry()], { maxPerHour: 2, gapSeconds: 0.02 });
  runner.start();
  await until(() => conns.length === 1);
  for (let i = 0; i < 3; i++) {
    chat(conns[0], ".mouse");
    await sleep(40);
  }
  await sleep(200);
  assert.equal(conns[0].sent.length, 2);
  runner.stop();
});

test("changing the file changes the replies without a restart, and removing a channel stops it", async () => {
  const { runner, conns, setText } = setup([entry()]);
  runner.start();
  await until(() => conns.length === 1);

  const newLink = link({ commands: [{ trigger: "mouse", title: "Mouse", text: "card", icon: "x", reply: "A new reply" }] });
  setText(JSON.stringify({ bots: [entry({ link: newLink })] }));
  runner.reloadNow();
  await until(() => conns.length === 2);
  assert.equal(conns[0].closed, true, "the old connection was closed");
  chat(conns[1], ".mouse");
  await until(() => conns[1].sent.length === 1);
  assert.deepEqual(conns[1].sent, ["A new reply"]);

  setText(JSON.stringify({ bots: [] }));
  runner.reloadNow();
  assert.equal(runner.count, 0);
  assert.equal(conns[1].closed, true);
  runner.stop();
});

test("the file is checked: a link can be the c= part or a whole link, and a bot with something missing is left out with a reason", () => {
  const c = link();
  assert.equal(parseLink(c), c);
  assert.equal(parseLink(`https://frills.valwidgets.live/overlay/actions/?c=${encodeURIComponent(c)}&channel=x`), c);
  assert.equal(parseLink(""), "");

  const { bots, problems } = loadBots(JSON.stringify({ bots: [entry(), { channel: "no.session", link: c }, { link: c, sessionId: "a", ttTargetIdc: "b" }, entry({ channel: "@Other", link: "" })] }));
  assert.deepEqual(bots.map((b) => b.channel), ["pond.pal"]);
  assert.equal(problems.length, 3);
  assert.equal(loadBots("not json").problems.length, 1);
});
