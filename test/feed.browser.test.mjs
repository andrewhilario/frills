// The chat feed's own rules, checked in a real browser: how messages arrive, how many show, how fast, what a moderator can remove, and that
// somebody else's words never become markup. The feed is bundled on the spot and run on a blank page. Skipped on a computer with no Chrome.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { build } from "esbuild";
import { findChrome, launch } from "../scripts/lib/chrome.mjs";

const root = join(import.meta.dirname, "..");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

let page;
before(async () => {
  if (skip) return;
  const script = await build({ absWorkingDir: root, entryPoints: ["src/js/feed.js"], bundle: true, format: "iife", globalName: "FeedLib", write: false, logLevel: "silent" });
  const styles = await build({ absWorkingDir: root, entryPoints: ["src/css/chat.css"], bundle: true, write: false, logLevel: "silent", external: ["/fonts/*"] });
  page = await launch();
  await page.goto("about:blank", { settle: 100 });
  await page.evaluate(script.outputFiles[0].text);
  await page.evaluate(`(() => { const s = document.createElement("style"); s.textContent = ${JSON.stringify(styles.outputFiles[0].text)}; document.head.append(s); })()`);
});
after(async () => { await page?.close(); });

/** Runs a function in the page and gives back what it returns. */
const run = (fn) => page.evaluate(`(async () => { const { Feed } = FeedLib; const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const mk = () => { const h = document.createElement("div"); document.body.append(h); return h; }; return (${fn})(Feed, wait, mk); })()`);

test("a burst is calmed: only the newest twelve wait, and they come out no faster than the gap", { skip }, async () => {
  const r = await run(async (Feed, wait, mk) => {
    const host = mk();
    const feed = new Feed(host, { life: 0, max: 40 });
    const times = [];
    const show = feed.show.bind(feed);
    feed.show = (m) => { times.push(performance.now()); show(m); };
    for (let i = 1; i <= 40; i++) feed.add({ id: "b" + i, user: "u" + i, name: "n" + i, text: "t" + i });
    const waiting = feed.queue.length;
    await wait(12 * 160 + 500);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    return { waiting, shown: [...host.children].map((c) => c.dataset.id), minGap: Math.min(...gaps) };
  });
  assert.equal(r.waiting, 12);
  assert.deepEqual(r.shown, Array.from({ length: 12 }, (_, i) => "b" + (29 + i)));
  assert.ok(r.minGap >= 140, `shortest gap ${r.minGap} ms`);
});

test("a moderator deleting a message fades it, then removes it, and the others stay", { skip }, async () => {
  const r = await run(async (Feed, wait, mk) => {
    const host = mk();
    const feed = new Feed(host, { life: 0, max: 10, gapMs: 20 });
    for (const id of ["a", "b", "c"]) feed.add({ id, user: "u" + id, name: id, text: id });
    await wait(300);
    feed.removeById("b");
    const leaving = host.querySelector("[data-id=b]").classList.contains("leaving");
    await wait(450);
    return { leaving, left: [...host.children].map((c) => c.dataset.id).join(",") };
  });
  assert.deepEqual(r, { leaving: true, left: "a,c" });
});

test("a message deleted while it is still waiting is never shown", { skip }, async () => {
  const left = await run(async (Feed, wait, mk) => {
    const host = mk();
    const feed = new Feed(host, { life: 0, max: 10, gapMs: 200 });
    for (const id of ["q1", "q2", "q3"]) feed.add({ id, user: "u" + id, name: id, text: id });
    feed.removeById("q2");
    await wait(900);
    return [...host.children].map((c) => c.dataset.id).join(",");
  });
  assert.equal(left, "q1,q3");
});

test("a timeout or ban removes everything that person said, and a clear empties the feed", { skip }, async () => {
  const r = await run(async (Feed, wait, mk) => {
    const host = mk();
    const feed = new Feed(host, { life: 0, max: 10, gapMs: 20 });
    feed.add({ id: "1", user: "x", name: "x", text: "one" });
    feed.add({ id: "2", user: "y", name: "y", text: "two" });
    feed.add({ id: "3", user: "x", name: "x", text: "three" });
    await wait(300);
    feed.removeUser("x");
    await wait(450);
    const afterBan = [...host.children].map((c) => c.dataset.user).join(",");
    feed.clear();
    return { afterBan, afterClear: host.children.length };
  });
  assert.deepEqual(r, { afterBan: "y", afterClear: 0 });
});

test("only max messages stay on screen, and each leaves by itself after its time", { skip }, async () => {
  const r = await run(async (Feed, wait, mk) => {
    const a = mk();
    const capped = new Feed(a, { life: 0, max: 3, gapMs: 10 });
    for (let i = 0; i < 6; i++) capped.add({ id: "m" + i, user: "u", name: "u", text: "x" + i });
    await wait(400);
    const showing = [...a.children].filter((c) => !c.classList.contains("leaving")).length;
    const b = mk();
    const brief = new Feed(b, { life: 300, max: 10, gapMs: 10 });
    brief.add({ id: "l", user: "u", name: "u", text: "bye" });
    await wait(200);
    const before = b.children.length;
    await wait(700);
    return { showing, before, after: b.children.length };
  });
  assert.deepEqual(r, { showing: 3, before: 1, after: 0 });
});

test("somebody else's words never become markup", { skip }, async () => {
  const r = await run(async (Feed, wait, mk) => {
    window.__xss = 0;
    const host = mk();
    const feed = new Feed(host, { life: 0, max: 10, gapMs: 10 });
    feed.add({ id: "x", user: "u", name: "<img src=x onerror=window.__xss=1>", text: "<script>window.__xss=2<\/script><b>bold</b>", emotes: [{ id: '1"><img src=x onerror=window.__xss=3>', start: 0, end: 1 }] });
    await wait(300);
    return { xss: window.__xss, injected: host.querySelectorAll("img:not(.emote), script, b").length, name: host.querySelector(".name").textContent, badEmoteAsPicture: host.querySelectorAll("img.emote").length };
  });
  assert.equal(r.xss, 0);
  assert.equal(r.injected, 0);
  assert.ok(r.name.startsWith("<img"), "the name is shown as the text it is");
  assert.equal(r.badEmoteAsPicture, 0, "an emote id that isn't an id is shown as plain text");
});

test("emotes become pictures from Twitch's address, in the right place, even after an emoji", { skip }, async () => {
  const r = await run(async (Feed, wait, mk) => {
    const host = mk();
    const feed = new Feed(host, { life: 0, max: 10, gapMs: 10 });
    feed.add({ id: "e", user: "u", name: "u", text: "😀 Kappa hi", emotes: [{ id: "25", start: 2, end: 6 }] });
    await wait(200);
    const img = host.querySelector("img.emote");
    return { src: img?.src, alt: img?.alt, text: host.querySelector(".txt").textContent };
  });
  assert.equal(r.src, "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0");
  assert.equal(r.alt, "Kappa");
  assert.equal(r.text, "😀  hi");
});

test("older messages glide up when a new one arrives, and stay still for people who ask for less motion", { skip }, async () => {
  const r = await run(async (Feed, wait, mk) => {
    const tall = () => { const h = mk(); h.className = "chatbox"; h.style.height = "400px"; return h; };
    const gliding = (host) => host.querySelector("[data-id=old]").getAnimations().length;
    const trial = async (options, beforeSecond) => {
      const host = tall();
      const feed = new Feed(host, { life: 0, max: 10, gapMs: 10, ...options });
      feed.add({ id: "old", user: "u", name: "old", text: "first" });
      await wait(100);
      beforeSecond?.(host);
      feed.add({ id: "new", user: "u", name: "new", text: "second" });
      await wait(40);
      return { host, now: gliding(host) };
    };
    const normal = await trial({});
    await wait(400);
    const settled = gliding(normal.host);
    const off = await trial({ glide: false });
    const still = await trial({}, (host) => host.classList.add("is-static"));
    const realMatchMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: true });
    const reduced = await trial({});
    window.matchMedia = realMatchMedia;
    return { normal: normal.now, settled, off: off.now, still: still.now, reduced: reduced.now };
  });
  assert.deepEqual(r, { normal: 1, settled: 0, off: 0, still: 0, reduced: 0 });
});

test("a profile picture takes the round badge once it has loaded, and the letter stays if it can't", { skip }, async () => {
  const r = await run(async (Feed, wait, mk) => {
    const good = "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#9c6"/></svg>');
    const broken = "data:image/svg+xml;base64,AAAA"; // not a picture at all
    const host = mk();
    const feed = new Feed(host, { life: 0, max: 10, gapMs: 10 });
    feed.add({ id: "p1", user: "u1", name: "Ann", text: "has a picture", avatar: good });
    feed.add({ id: "p2", user: "u2", name: "Bob", text: "picture is broken", avatar: broken });
    feed.add({ id: "p3", user: "u3", name: "Cy", text: "has none" });
    await wait(500);
    const badge = (id) => host.querySelector("[data-id=" + id + "] .av");
    const state = (id) => ({ letter: badge(id).firstChild.textContent, img: Boolean(badge(id).querySelector("img")), shown: badge(id).classList.contains("has-img") });
    const first = state("p1");
    const style = getComputedStyle(badge("p1").querySelector("img"));
    const covers = { position: style.position, fit: style.objectFit, opacity: style.opacity, referrer: badge("p1").querySelector("img").referrerPolicy, alt: badge("p1").querySelector("img").alt };
    const second = state("p2");
    const third = state("p3");
    feed.configure({ pictures: false });
    feed.add({ id: "p4", user: "u4", name: "Di", text: "pictures are off", avatar: good });
    await wait(300);
    return { first, covers, second, third, off: Boolean(badge("p4").querySelector("img")) };
  });
  assert.deepEqual(r.first, { letter: "A", img: true, shown: true });
  assert.deepEqual(r.covers, { position: "absolute", fit: "cover", opacity: "1", referrer: "no-referrer", alt: "" });
  assert.deepEqual(r.second, { letter: "B", img: false, shown: false }, "a picture that won't load is dropped and the letter stays");
  assert.deepEqual(r.third, { letter: "C", img: false, shown: false });
  assert.equal(r.off, false, "with profile pictures turned off no picture is even requested");
});

test("the moderator icon can be swapped and hidden while the chat is running", { skip }, async () => {
  const r = await run(async (Feed, wait, mk) => {
    const host = mk();
    const feed = new Feed(host, { life: 0, max: 10, gapMs: 10, modIcon: "shield" });
    feed.add({ id: "i", user: "u", name: "u", text: "hi", mod: true });
    await wait(200);
    const shield = Boolean(host.querySelector('.ico path[d^="M12 2 4"]'));
    feed.configure({ modIcon: "frog" });
    const frog = Boolean(host.querySelector(".ico circle"));
    feed.configure({ modIcon: "none" });
    return { shield, frog, hidden: getComputedStyle(host.querySelector(".ico")).display === "none" };
  });
  assert.deepEqual(r, { shield: true, frog: true, hidden: true });
});
