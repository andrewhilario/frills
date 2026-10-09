// Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";


import * as Twitch from "../src/js/twitch.js";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MOD_LINE =
  "@badge-info=;badges=moderator/1,subscriber/6;color=#1E90FF;display-name=Some\\sMod;emotes=25:0-4,12-16/1902:6-10;first-msg=0;id=abc-123;mod=1;room-id=1;subscriber=1;user-id=2 " +
  ":somemod!somemod@somemod.tmi.twitch.tv PRIVMSG #chan :Kappa Keepo Kappa : colon";

test("parseIrc reads tags, prefix, command, channel and text", () => {
  const p = Twitch.parseIrc(MOD_LINE);
  assert.equal(p.command, "PRIVMSG");
  assert.equal(p.prefix, "somemod!somemod@somemod.tmi.twitch.tv");
  assert.deepEqual(p.params, ["#chan"]);
  assert.equal(p.trailing, "Kappa Keepo Kappa : colon");
  assert.equal(p.tags["display-name"], "Some Mod");
  assert.equal(p.tags.mod, "1");
  assert.equal(p.tags["badge-info"], "");
});

test("parseIrc undoes tag escapes", () => {
  const p = Twitch.parseIrc("@a=x\\:y\\sz\\\\w\\rq\\nr\\qs;b :srv CMD");
  assert.equal(p.tags.a, "x;y z\\w\rq\nrqs"); // \: \s \\ \r \n, and an unknown escape (\q) just loses its backslash
  assert.equal(p.tags.b, "");
  const lone = Twitch.parseIrc("@a=end\\ :srv CMD");
  assert.equal(lone.tags.a, "end"); // a lone backslash at the end is dropped
});

test("parseIrc handles PING, numerics and junk", () => {
  assert.deepEqual(Twitch.parseIrc("PING :tmi.twitch.tv"), { tags: {}, prefix: "", command: "PING", params: [], trailing: "tmi.twitch.tv" });
  const welcome = Twitch.parseIrc(":tmi.twitch.tv 001 justinfan1 :Welcome, GLHF!");
  assert.equal(welcome.command, "001");
  assert.deepEqual(welcome.params, ["justinfan1"]);
  assert.equal(welcome.trailing, "Welcome, GLHF!");
  assert.equal(Twitch.parseIrc(""), null);
  assert.equal(Twitch.parseIrc("@only-tags"), null);
  assert.equal(Twitch.parseIrc(":only-prefix"), null);
});

test("toChatMessage shapes a moderator's message", () => {
  const m = Twitch.toChatMessage(Twitch.parseIrc(MOD_LINE));
  assert.equal(m.id, "abc-123");
  assert.equal(m.user, "somemod");
  assert.equal(m.name, "Some Mod");
  assert.equal(m.text, "Kappa Keepo Kappa : colon");
  assert.equal(m.color, "#1E90FF");
  assert.equal(m.mod, true);
  assert.equal(m.subscriber, true);
  assert.equal(m.broadcaster, false);
  assert.equal(m.first, false);
  assert.equal(m.gift, false);
  assert.equal(m.source, "twitch");
  assert.deepEqual(m.emotes, [
    { id: "25", start: 0, end: 4 },
    { id: "1902", start: 6, end: 10 },
    { id: "25", start: 12, end: 16 },
  ]);
});

test("moderator comes from the mod tag or the badge; the broadcaster is not a moderator", () => {
  const badgeOnly = Twitch.toChatMessage(Twitch.parseIrc("@badges=moderator/1 :a!a@a PRIVMSG #c :hi"));
  assert.equal(badgeOnly.mod, true);
  const tagOnly = Twitch.toChatMessage(Twitch.parseIrc("@mod=1 :a!a@a PRIVMSG #c :hi"));
  assert.equal(tagOnly.mod, true);
  const host = Twitch.toChatMessage(Twitch.parseIrc("@badges=broadcaster/1;mod=0 :a!a@a PRIVMSG #c :hi"));
  assert.equal(host.mod, false);
  assert.equal(host.broadcaster, true);
  const vip = Twitch.toChatMessage(Twitch.parseIrc("@badges=vip/1 :a!a@a PRIVMSG #c :hi"));
  assert.equal(vip.vip, true);
  assert.equal(vip.mod, false);
});

test("a name falls back to the login, and a bad colour is dropped", () => {
  const m = Twitch.toChatMessage(Twitch.parseIrc("@color=red;display-name= :LoginName!x@x PRIVMSG #c :hi"));
  assert.equal(m.name, "loginname");
  assert.equal(m.user, "loginname");
  assert.equal(m.color, null);
  for (const bad of ["", "#12345", "#GGGGGG", "url(x)"]) {
    assert.equal(Twitch.toChatMessage(Twitch.parseIrc(`@color=${bad} :a!a@a PRIVMSG #c :hi`)).color, null);
  }
});

test("/me messages lose their wrapper, and emote positions are relative to what is left", () => {
  const m = Twitch.toChatMessage(Twitch.parseIrc("@emotes=25:6-10 :a!a@a PRIVMSG #c :\u0001ACTION waves Kappa\u0001"));
  assert.equal(m.text, "waves Kappa");
  assert.equal(m.action, true);
  assert.equal(Array.from(m.text).slice(m.emotes[0].start, m.emotes[0].end + 1).join(""), "Kappa");
  const open = Twitch.toChatMessage(Twitch.parseIrc(":a!a@a PRIVMSG #c :\u0001ACTION no closing mark"));
  assert.equal(open.text, "no closing mark");
});

test("emote positions count code points, so an emoji before an emote doesn't shift it", () => {
  const text = "😀 Kappa";
  const emotes = Twitch.parseEmotes("25:2-6", text);
  assert.equal(Array.from(text).slice(emotes[0].start, emotes[0].end + 1).join(""), "Kappa");
});

test("bad emote data is ignored instead of breaking the message", () => {
  assert.deepEqual(Twitch.parseEmotes("25:0-99", "hi"), []);
  assert.deepEqual(Twitch.parseEmotes("25:5-2", "hello world"), []);
  assert.deepEqual(Twitch.parseEmotes("nonsense", "hello"), []);
  assert.deepEqual(Twitch.parseEmotes("", "hello"), []);
  assert.deepEqual(Twitch.parseEmotes("25:x-y/1902:0-1", "hello"), [{ id: "1902", start: 0, end: 1 }]);
});

test("cheering with bits marks the message as a gift", () => {
  assert.equal(Twitch.toChatMessage(Twitch.parseIrc("@bits=100 :a!a@a PRIVMSG #c :cheer100 nice")).gift, true);
  assert.equal(Twitch.toChatMessage(Twitch.parseIrc("@bits=0 :a!a@a PRIVMSG #c :hi")).gift, false);
});

test("only chat messages become messages", () => {
  assert.equal(Twitch.toChatMessage(Twitch.parseIrc(":tmi.twitch.tv ROOMSTATE #c")), null);
  assert.equal(Twitch.toChatMessage(null), null);
});

test("cleanChannel accepts a channel name and nothing that could be a command", () => {
  assert.equal(Twitch.cleanChannel("  #Shroud "), "shroud");
  assert.equal(Twitch.cleanChannel("some_name9"), "some_name9");
  for (const bad of ["", "bad name", "a\r\nJOIN #x", "x".repeat(26), "#", "naïve", null, undefined]) assert.equal(Twitch.cleanChannel(bad), "");
});

// ── The connection, with a pretend socket ──────────────────────────────────────────────────────────────────────────────

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.closed = false;
  }
  send(line) { this.sent.push(line); }
  close() { this.closed = true; this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(...lines) { this.onmessage?.({ data: lines.join("\r\n") + "\r\n" }); }
  hangUp() { this.readyState = 3; this.onclose?.({}); }
}

function setup(options = {}) {
  const sockets = [];
  const log = { messages: [], removed: [], cleared: [], status: [], last: null };
  const conn = Twitch.connect({
    channel: "#Shroud",
    socketFactory: (url) => { const s = new FakeSocket(url); sockets.push(s); return s; },
    onMessage: (m) => log.messages.push(m),
    onRemove: (r) => log.removed.push(r),
    onClear: (c) => log.cleared.push(c),
    onStatus: (s) => { log.status.push(s.state); log.last = s; },
    reconnectBase: 5,
    ...options,
  });
  return { sockets, log, conn };
}

const JOIN = ":justinfan12345!justinfan12345@justinfan12345.tmi.twitch.tv JOIN #shroud";

test("connect says hello the way a guest viewer does, then reports connected once", () => {
  const { sockets, log, conn } = setup();
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].url, "wss://irc-ws.chat.twitch.tv:443");
  sockets[0].open();
  const [cap, pass, nick, join] = sockets[0].sent;
  assert.equal(cap, "CAP REQ :twitch.tv/tags twitch.tv/commands");
  assert.equal(pass, "PASS SCHMOOPIIE");
  assert.match(nick, /^NICK justinfan\d{5}$/);
  assert.equal(join, "JOIN #shroud");
  sockets[0].receive(JOIN, ":justinfan12345.tmi.twitch.tv 366 justinfan12345 #shroud :End of /NAMES list", "@room-id=1 :tmi.twitch.tv ROOMSTATE #shroud");
  assert.deepEqual(log.status, ["connecting", "connected"]);
  conn.stop();
});

test("connect answers pings with the same words", () => {
  const { sockets, conn } = setup();
  sockets[0].open();
  sockets[0].receive("PING :tmi.twitch.tv");
  assert.equal(sockets[0].sent.at(-1), "PONG :tmi.twitch.tv");
  sockets[0].receive("PING :other");
  assert.equal(sockets[0].sent.at(-1), "PONG :other");
  conn.stop();
});

test("connect passes chat messages on, even several in one frame, and ignores the rest", () => {
  const { sockets, log, conn } = setup();
  sockets[0].open();
  sockets[0].receive(JOIN, "@id=1 :a!a@a PRIVMSG #shroud :one", "@id=2;mod=1 :b!b@b PRIVMSG #shroud :two", ":tmi.twitch.tv USERSTATE #shroud");
  assert.deepEqual(log.messages.map((m) => [m.id, m.text, m.mod]), [["1", "one", false], ["2", "two", true]]);
  conn.stop();
});

test("moderator actions come through as removals", () => {
  const { sockets, log, conn } = setup();
  sockets[0].open();
  sockets[0].receive(
    "@login=baduser;target-msg-id=msg-77 :tmi.twitch.tv CLEARMSG #shroud :something rude",
    "@ban-duration=600;target-user-id=9 :tmi.twitch.tv CLEARCHAT #shroud :BadUser",
    "@room-id=1 :tmi.twitch.tv CLEARCHAT #shroud",
  );
  assert.deepEqual(log.removed, [{ id: "msg-77" }]);
  assert.deepEqual(log.cleared, [{ user: "baduser" }, { user: "" }]);
  conn.stop();
});

test("connect tries again by itself when the server hangs up", async () => {
  const { sockets, log, conn } = setup();
  sockets[0].open();
  sockets[0].receive(JOIN);
  sockets[0].hangUp();
  assert.equal(log.status.at(-1), "reconnecting");
  await wait(60);
  assert.equal(sockets.length, 2);
  sockets[1].open();
  sockets[1].receive(JOIN);
  assert.equal(log.status.at(-1), "connected");
  conn.stop();
});

test("RECONNECT from Twitch moves to a new connection, and the old one can no longer speak", async () => {
  const { sockets, log, conn } = setup();
  sockets[0].open();
  sockets[0].receive(JOIN, ":tmi.twitch.tv RECONNECT");
  assert.equal(sockets[0].closed, true);
  await wait(60);
  assert.equal(sockets.length, 2);
  sockets[0].receive("@id=old :a!a@a PRIVMSG #shroud :from the old one");
  assert.equal(log.messages.length, 0);
  conn.stop();
});

test("stop ends everything and doesn't reconnect", async () => {
  const { sockets, log, conn } = setup();
  sockets[0].open();
  conn.stop();
  assert.equal(sockets[0].closed, true);
  sockets[0].hangUp();
  await wait(60);
  assert.equal(sockets.length, 1);
  assert.equal(log.status.at(-1), "stopped");
});

test("a bad channel name fails at once, without ever opening a socket", () => {
  const { sockets, log } = setup({ channel: "not a channel" });
  assert.equal(sockets.length, 0);
  assert.deepEqual(log.status, ["error"]);
  assert.equal(log.last.fatal, true);
});

test("if Twitch refuses the guest login, it says so and stops instead of retrying forever", async () => {
  const { sockets, log } = setup();
  sockets[0].open();
  sockets[0].receive(":tmi.twitch.tv NOTICE * :Login authentication failed");
  await wait(60);
  assert.equal(sockets[0].closed, true);
  assert.equal(sockets.length, 1);
  assert.equal(log.last.state, "error");
  assert.equal(log.last.fatal, true);
});

test("a connection that goes quiet is replaced, and pings are sent while it waits", (t) => {
  // Pretend time, so the result can't depend on how busy the computer is (the browser tests run beside this one): ten pretend
  // milliseconds are exactly ten.
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const { sockets, conn } = setup({ pingEvery: 10, silentAfter: 25 });
  sockets[0].open();
  t.mock.timers.tick(10);
  assert.ok(sockets[0].sent.includes("PING :tmi.twitch.tv"), "a ping goes out while it waits");
  t.mock.timers.tick(30); // forty milliseconds of silence in all, more than silentAfter: it is given up on
  assert.equal(sockets[0].closed, true);
  t.mock.timers.tick(20); // the short wait before trying again
  assert.ok(sockets.length >= 2, "and a new connection is made");
  conn.stop();
});
