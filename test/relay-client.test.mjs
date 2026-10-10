// The page's side of the relay: where TikTok chat can come from (the helper on this PC, else the site's shared relay), what is shown while
// waiting in line, and that a TikTok connection made through the relay goes to the relay's address. No browser, no network: fetch and
// EventSource are pretend.

import test from "node:test";
import assert from "node:assert/strict";
import { findTikTokSource } from "../src/js/tiktok.js";
import { connectTo, statusText } from "../src/js/connect.js";

const answer = (body, ok = true) => ({ ok, json: async () => body });

/** Node has no EventSource to replace, so one is put there for the test and taken away after. */
function stubEventSource(t, Pretend) {
  globalThis.EventSource = Pretend;
  t.after(() => { delete globalThis.EventSource; });
}

/** Replaces fetch for one test. `routes` maps an address to what it answers (a body, or "down" for a network error). */
function pretendFetch(t, routes) {
  const asked = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    asked.push(url);
    const what = routes[url];
    if (what === undefined || what === "down") throw new TypeError("fetch failed");
    return what;
  });
  return asked;
}

test("TikTok chat is looked for on the page's own address first, then at the site's relay", async (t) => {
  pretendFetch(t, { "/tiktok/ping": answer({ ok: true, name: "frills-helper" }), "https://relay.test/tiktok/ping": answer({ ok: true, name: "frills-relay" }) });
  assert.deepEqual(await findTikTokSource("https://relay.test"), { kind: "helper", base: "", features: ["chat"] }, "a helper on this PC wins, and one that says nothing about features can only send chat");
  pretendFetch(t, { "/tiktok/ping": answer({ ok: true, name: "frills-helper", features: ["chat", "alerts"] }) });
  assert.deepEqual((await findTikTokSource("")).features, ["chat", "alerts"], "a newer one lists what it can send");
});

test("with no helper the relay is used, and with neither there is nothing", async (t) => {
  pretendFetch(t, { "/tiktok/ping": answer({ ok: false, name: "frills-site" }), "https://relay.test/tiktok/ping": answer({ ok: true, name: "frills-relay", slots: { used: 1, max: 30, waiting: 0 } }) });
  assert.deepEqual(await findTikTokSource("https://relay.test/"), { kind: "relay", base: "https://relay.test", features: ["chat"] }, "a trailing slash is tidied");
  assert.equal(await findTikTokSource(""), null, "no relay named, so only the page's own address is asked");
  const asked = pretendFetch(t, { "/tiktok/ping": "down", "https://relay.test/tiktok/ping": answer({}, false) });
  assert.equal(await findTikTokSource("https://relay.test"), null);
  assert.deepEqual(asked, ["/tiktok/ping", "https://relay.test/tiktok/ping"]);
});

test("something else answering at the address is not mistaken for a helper or a relay", async (t) => {
  pretendFetch(t, { "/tiktok/ping": answer({ ok: true, name: "something-else" }) });
  assert.equal(await findTikTokSource(""), null);
  pretendFetch(t, { "/tiktok/ping": answer("not an object") });
  assert.equal(await findTikTokSource(""), null);
});

test("waiting in line reads as a place, and the number of people", () => {
  assert.equal(statusText({ state: "queued", platform: "tiktok", position: 3, total: 12 }), "The free relay is full. Waiting for a spot: 3 of 12…");
  assert.equal(statusText({ state: "queued", platform: "tiktok" }), "The free relay is full. Waiting for a spot…");
  assert.equal(statusText({ state: "helper-lost", platform: "tiktok", detail: "Lost the free Frills relay. This reconnects by itself." }), "Lost the free Frills relay. This reconnects by itself.");
});

test("a TikTok connection through the relay opens the relay's address, passes on the line, and stops cleanly", async (t) => {
  pretendFetch(t, { "/tiktok/ping": answer({ ok: false }), "https://relay.test/tiktok/ping": answer({ ok: true, name: "frills-relay" }) });
  const sources = [];
  class PretendEventSource {
    constructor(url) { this.url = url; this.readyState = 1; this.handlers = {}; sources.push(this); }
    addEventListener(name, fn) { (this.handlers[name] ??= []).push(fn); }
    close() { this.closed = true; }
    send(name, data) { (this.handlers[name] ?? []).forEach((fn) => fn({ data: JSON.stringify(data) })); }
  }
  stubEventSource(t, PretendEventSource);
  const status = [];
  const messages = [];
  const conn = connectTo([{ add: (m) => messages.push(m), removeById() {}, removeUser() {}, clear() {} }], "tiktok", "@Pond.Pal", (s) => status.push(`${s.state}${s.position ? ":" + s.position + "/" + s.total : ""}`), { relay: "https://relay.test" });
  assert.deepEqual(status, ["connecting"], "it says connecting at once, while it looks");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, "https://relay.test/tiktok/stream?user=pond.pal");
  sources[0].send("status", { state: "queued", position: 2, total: 5 });
  sources[0].send("status", { state: "connected" });
  sources[0].send("chat", { id: "1", name: "Ann", text: "hello" });
  assert.deepEqual(status.slice(-2), ["queued:2/5", "connected"]);
  assert.equal(messages[0].text, "hello");
  conn.stop();
  assert.equal(sources[0].closed, true);
});

test("stopping before the search for a source has finished opens nothing, and nowhere to read from is said plainly", async (t) => {
  pretendFetch(t, { "/tiktok/ping": "down" });
  let opened = 0;
  stubEventSource(t, class { constructor() { opened++; } });
  const status = [];
  const early = connectTo([], "tiktok", "pond.pal", (s) => status.push(s.state), { relay: "" });
  early.stop();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(opened, 0);
  assert.deepEqual(status, ["connecting"]);

  const last = [];
  connectTo([], "tiktok", "pond.pal", (s) => last.push(s), { relay: "" });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(last.at(-1).state, "error");
  assert.equal(last.at(-1).fatal, true);
  assert.match(last.at(-1).detail, /needs the Frills helper running on this PC/);

  const withRelay = [];
  connectTo([], "tiktok", "pond.pal", (s) => withRelay.push(s), { relay: "https://relay.test" });
  await new Promise((r) => setTimeout(r, 20));
  assert.match(withRelay.at(-1).detail, /relay isn’t answering|relay isn't answering/);
});
