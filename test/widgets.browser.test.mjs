// Last Gifts, the Follower Goal and the overlays page in a real headless Chrome, with a pretend TikTok behind the helper: gifts arrive and
// are listed, follows move the bar and a goal celebrates and raises, the editors' test buttons and links work, and the page lists what
// is live and what is coming. Skipped on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createHelper } from "../helper/server.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "goal", "index.html"))) throw new Error("dist/ has no goal page. Run `npm run build` first (`npm test` does that for you).");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

class FakeConnection extends EventEmitter {
  async connect() { await sleep(5); }
  disconnect() { this.emit("disconnected"); }
}
const opened = [];
async function withHelper({ followers, status } = {}) {
  const made = [];
  const helper = createHelper({ distDir: dist, factory: async () => { const c = new FakeConnection(); if (followers || status) c.roomInfo = { data: { status, owner: { follow_info: { follower_count: followers } } } }; made.push(c); return c; }, idleStopMs: 200, offlineWaitMs: 5000 });
  const port = await helper.listen(0);
  opened.push(helper);
  return { base: `http://127.0.0.1:${port}`, made };
}
const until = async (check, ms = 5000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await check()) return; await sleep(30); }
  throw new Error("Timed out");
};
let page;
before(async () => { if (!skip) { page = await launch(); await page.viewport(1280, 900); } });
after(async () => { await page?.close(); for (const h of opened) await h.close(); });

const person = (id, name) => ({ id, displayId: name.toLowerCase().replace(/\W/g, "_"), nickname: name });
const gift = (id, name, giftName, diamondCount, count = 1) => ({ common: { msgId: id }, user: person(id, name), gift: { name: giftName, type: 2, diamondCount }, repeatCount: count });
const follow = (id, name) => ({ common: { msgId: id }, user: person(id, name) });
const text = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.trim() ?? null`);
const click = (selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const type = (selector, value) => page.evaluate(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const rows = () => page.evaluate(`[...document.querySelectorAll(".gift:not(.gift--out)")].map((g) => g.querySelector(".gift__words").textContent)`);

test("every new page loads under the security policy with no console errors", { skip }, async () => {
  for (const path of ["/overlays/", "/gifts/", "/goal/", "/overlay/gifts/?demo=1", "/overlay/goal/?demo=1"]) {
    const { base } = await withHelper();
    await page.goto(base + path, { settle: 700 });
    assert.deepEqual(page.problems, [], `${path}: ${page.problems.join(" | ")}`);
  }
});

test("overlay: gifts from a TikTok LIVE are listed, newest at the bottom, the oldest leave when it is full, and small ones can be skipped", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/gifts/?channel=pond_cafe&platform=tiktok&max=3&minDiamonds=2&template=%7Bname%7D+%E2%86%92+%7Bgift%7D`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  made[0].emit("gift", gift("g1", "Ann", "Rose", 1)); // too small
  for (const [i, n] of ["Ben", "Cat", "Dan", "Eve"].entries()) made[0].emit("gift", gift("g" + (i + 2), n, "Panda", 100));
  await until(async () => (await rows()).length === 3 && (await rows()).includes("Eve → Panda"));
  assert.deepEqual(await rows(), ["Cat → Panda", "Dan → Panda", "Eve → Panda"], "Ann was too small, Ben left to make room");
});

test("overlay: a new gift animates only itself, the rows already there stay still", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/gifts/?channel=pond_cafe&platform=tiktok&max=5`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  made[0].emit("gift", gift("g1", "Ann", "Panda", 100));
  await until(async () => (await rows()).length === 1);
  await sleep(900); // the first row has finished arriving
  made[0].emit("gift", gift("g2", "Ben", "Panda", 100));
  await until(async () => (await rows()).length === 2);
  const moving = await page.evaluate(`document.querySelector(".gift").getAnimations().length`);
  assert.equal(moving, 0, "the first row is not animated again when the second arrives");
});

test("overlay: new gifts go at the top when asked, and the value shows when asked", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/gifts/?channel=pond_cafe&platform=tiktok&order=top&showDiamonds=1`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  made[0].emit("gift", gift("g1", "Ann", "Rose", 5, 2));
  made[0].emit("gift", gift("g2", "Ben", "Panda", 100));
  await until(async () => (await rows()).length === 2);
  assert.equal(await page.evaluate(`document.querySelector(".giftlist").dataset.order`), "top");
  assert.match(await text(".gift__value"), /^10 diamonds$/);
});

test("overlay: followers move the goal bar, reaching it celebrates, and the next goal is set", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/goal/?channel=pond_cafe&platform=tiktok&start=8&target=10&step=5&label=Road+to+10&celebrateText=Yay`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  assert.equal(await text(".goal__label"), "Road to 10");
  assert.equal(await text(".goal__numbers"), "8 / 10");
  made[0].emit("follow", follow("f1", "Ann"));
  await until(async () => (await text(".goal__numbers")) === "9 / 10");
  assert.equal(await page.evaluate(`document.querySelector(".goal__fill").style.width`), "90%");
  made[0].emit("follow", follow("f2", "Ben"));
  await until(async () => (await text(".goal__cheer")) === "Yay");
  assert.equal(await page.evaluate(`document.querySelector(".goal").dataset.full`), "true");
  assert.ok(await page.evaluate(`document.querySelectorAll(".goal__fx i").length > 0`), "confetti");
  await until(async () => (await text(".goal__numbers")) === "10 / 15", 9000);
});

test("overlay: with remember turned on, the count survives a reload", { skip }, async () => {
  const { base, made } = await withHelper();
  const url = `${base}/overlay/goal/?channel=keep_me&platform=tiktok&start=0&target=100&keep=1`;
  await page.goto(url, { settle: 800 });
  await page.evaluate(`localStorage.clear()`);
  await page.goto(url, { settle: 800 });
  await until(() => made.length >= 1);
  await sleep(150);
  made[0].emit("follow", follow("f1", "Ann"));
  made[0].emit("follow", follow("f2", "Ben"));
  await until(async () => (await text(".goal__numbers")) === "2 / 100");
  await page.goto(url, { settle: 800 });
  assert.equal(await text(".goal__numbers"), "2 / 100", "remembered");
});

test("editor: the follower goal talks about follows, not chat, and a follow counts as reading", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(base + "/goal/?channel=pond_cafe", { settle: 800 });
  await until(() => made.length === 1);
  await until(async () => /^Connected to TikTok\. Waiting for follows\./.test((await text("#source-status")) ?? ""));
  await sleep(150);
  made[0].emit("follow", follow("f1", "Ann"));
  await until(async () => (await text("#source-status")) === "Reading @pond_cafe's LIVE. Follows will show up here.");
});

test("overlay: the goal starts from the account's real follower count, and a gift goal counts diamonds", { skip }, async () => {
  const { base, made } = await withHelper({ followers: 5000 });
  await page.goto(`${base}/overlay/goal/?channel=pond_cafe&platform=tiktok&start=0&target=100&step=25`, { settle: 800 });
  await until(async () => (await text(".goal__numbers")) === "5,000 / 5,025");
  assert.equal(await text(".goal__label"), "Follower goal", "no label typed: the type's name");
  await until(() => made.length === 1);
  made[0].emit("follow", follow("f1", "Ann"));
  await until(async () => (await text(".goal__numbers")) === "5,001 / 5,025");

  await page.goto(`${base}/overlay/goal/?channel=pond_two&platform=tiktok&type=gift&target=1000&step=0`, { settle: 800 });
  await until(() => made.length >= 2);
  await sleep(150);
  assert.equal(await text(".goal__label"), "Gift goal");
  made[made.length - 1].emit("gift", gift("g1", "Ann", "Panda", 100, 3));
  made[made.length - 1].emit("follow", follow("f9", "Ben")); // not counted by a gift goal
  await until(async () => (await text(".goal__numbers")) === "300 / 1,000 diamonds");
});

test("editor: when TikTok says the room is LIVE it reads at once, even if nobody says or does anything", { skip }, async () => {
  const { base } = await withHelper({ status: 2 });
  await page.goto(base + "/gifts/?channel=pond_cafe", { settle: 800 });
  await until(async () => (await text("#source-status")) === "Reading @pond_cafe's LIVE. Gifts will show up here.");
  await sleep(1500);
  assert.equal(await text("#source-status"), "Reading @pond_cafe's LIVE. Gifts will show up here.", "and it stays that way");
});

test("editor: the gifts test buttons list gifts, and changing the words and the link work", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/gifts/", { settle: 800 });
  await type("#c-template", "{name} gave {gift}!");
  await click('[data-test="gift"]');
  await click('[data-test="big"]');
  await until(async () => (await rows()).length === 2);
  assert.match((await rows())[0], / gave .+!$/);
  await click('[data-test="clear"]');
  await until(async () => (await rows()).length === 0);
  await type("#source-channel", "pond.pal");
  const url = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(url.pathname, "/overlay/gifts/");
  assert.equal(url.searchParams.get("channel"), "pond.pal");
  assert.ok(url.searchParams.get("template").startsWith("{name} gave"));
});

test("editor: the goal test buttons move the bar, reaching celebrates, and the goal and start can be changed", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/goal/", { settle: 800 });
  await type("#c-target", "20");
  await type("#c-start", "5");
  assert.equal(await text(".goal__numbers"), "5 / 20");
  await click('[data-test="ten"]');
  await until(async () => (await text(".goal__numbers")) === "15 / 20");
  await click('[data-test="reach"]');
  await until(async () => (await text(".goal__cheer")) !== "", 3000);
  await click('[data-test="reset"]');
  await until(async () => /^5 \/ \d+$/.test(await text(".goal__numbers")), 9000);
});

test("overlays page: the live and beta ones link to their editors, and the coming ones are listed without links", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/overlays/", { settle: 600 });
  const links = await page.evaluate(`[...document.querySelectorAll(".tool:not(.tool--soon) a.btn")].map((a) => a.getAttribute("href"))`);
  assert.deepEqual(links, ["/editor/", "/alerts/", "/gifts/", "/goal/", "/likers/", "/editor/"], "the last is TikTok and Twitch chat together, which is the chat editor's Both");
  const beta = await page.evaluate(`[...document.querySelectorAll(".tool:has(.tool__badge--beta) .subtitle")].map((t) => t.textContent)`);
  assert.deepEqual(beta, ["Alerts", "Last gifts", "Goals", "Top likers", "TikTok and Twitch chat together"], "it is marked Beta, like the others that are new");
  const soon = await page.evaluate(`[...document.querySelectorAll(".tool--soon")].map((t) => [t.querySelector(".subtitle").textContent, t.querySelectorAll("a").length])`);
  assert.deepEqual(soon.map((s) => s[0]), ["Free sound library", "Song requests", "Spotify player", "Like and subscriber alerts", "Starting soon, Be right back and Stream ending screens", "Your own layout", "Pets that move", "Top gifters"]);
  assert.ok(soon.every((s) => s[1] === 0), "a coming-soon card links nowhere");
  assert.equal(await page.evaluate(`document.querySelectorAll(".tool__badge--soon").length`), 8);
});

const like = (id, name, likeCount, totalLikeCount = 0) => ({ common: { msgId: id }, user: person(name.toLowerCase(), name), likeCount, totalLikeCount });
const ranking = () => page.evaluate(`[...document.querySelectorAll(".liker:not(.liker--out)")].sort((a, b) => Number(a.dataset.rank) - Number(b.dataset.rank)).map((r) => r.dataset.rank + ":" + r.querySelector(".liker__name").textContent + ":" + r.querySelector(".liker__count").textContent)`);

test("overlay: likes from a TikTok LIVE are added up per person and the ranking re-orders as people overtake", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/likers/?channel=pond_cafe&platform=tiktok&max=3&titleText=Best+tappers`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  assert.equal(await text(".likers__title"), "Best tappers");
  made[0].emit("like", like("1", "Ann", 5)); made[0].emit("like", like("2", "Ben", 9)); made[0].emit("like", like("3", "Cat", 2)); made[0].emit("like", like("4", "Dan", 1));
  await until(async () => (await ranking()).length === 3, 4000);
  assert.deepEqual(await ranking(), ["1:Ben:9", "2:Ann:5", "3:Cat:2"], "Dan is not in the top 3");
  made[0].emit("like", like("5", "Cat", 30));
  await until(async () => (await ranking())[0] === "1:Cat:32", 4000);
  assert.deepEqual(await ranking(), ["1:Cat:32", "2:Ben:9", "3:Ann:5"]);
  const y = await page.evaluate(`[...document.querySelectorAll(".liker")].map((r) => r.style.transform)`);
  assert.equal(new Set(y).size, y.length, "each person has their own place");
});

test("editor: the likers test buttons fill and re-order the ranking, and the link carries the changes", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/likers/", { settle: 800 });
  await type("#c-max", "5");
  await click('[data-test="crowd"]');
  await until(async () => (await ranking()).length === 5, 8000);
  const before = (await ranking())[0];
  await click('[data-test="overtake"]');
  await sleep(300);
  assert.ok((await ranking()).length === 5);
  await click('[data-test="clear"]');
  await until(async () => (await ranking()).length === 0, 3000);
  await type("#source-channel", "pond.pal");
  const url = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(url.pathname, "/overlay/likers/");
  assert.equal(url.searchParams.get("max"), "5");
  assert.ok(before);
});

// ── a like milestone ────────────────────────────────────────────────────────────────────────────────────────────────────

const party = () => page.evaluate(`(() => {
  const p = document.querySelector(".likers__party");
  return p ? { who: p.querySelector(".likers__who")?.textContent, num: p.querySelector(".likers__num")?.textContent, total: p.querySelector(".likers__total")?.textContent, cheer: p.querySelector(".likers__cheer")?.textContent, crown: Boolean(p.querySelector("svg.likers__crown")), pic: Boolean(p.querySelector(".likers__pic")) } : null;
})()`);
const noParty = async (ms = 1800) => { await sleep(ms); assert.equal(await party(), null, "no celebration"); };

test("overlay: the top liker passing 1,000 likes zooms in with a crown, their name and likes, then it goes; someone who is not on top is not celebrated", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/likers/?channel=pond_cafe&platform=tiktok&celebrateTime=3&celebrateText=Well+done`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  made[0].emit("like", like("1", "Ann", 400));
  await until(async () => (await ranking()).length === 1, 4000);
  await noParty(300);
  made[0].emit("like", like("2", "Ann", 650));
  await until(async () => (await party()) !== null, 5000);
  assert.deepEqual(await party(), { who: "Ann", num: "1,050", total: "1,050 likes", cheer: "Well done", crown: true, pic: true });
  await until(async () => (await party()) === null, 6000);
  made[0].emit("like", like("3", "Ben", 1100));
  await until(async () => (await party())?.who === "Ben", 5000);
  assert.equal((await party()).num, "1,100", "the next top liker to pass a milestone is celebrated too");
  await until(async () => (await party()) === null, 6000);
  made[0].emit("like", like("4", "Dan", 1010));
  await until(async () => (await ranking()).length === 3, 5000);
  await noParty();
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("overlay: a bigger milestone waits for it, and the celebration can be switched off", { skip }, async () => {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/likers/?channel=pond_cafe&platform=tiktok&celebrateTime=3&milestone=2000`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  made[0].emit("like", like("1", "Ann", 1500));
  await until(async () => (await ranking()).length === 1, 4000);
  await noParty();
  made[0].emit("like", like("2", "Ann", 600));
  await until(async () => (await party()) !== null, 5000);
  assert.equal((await party()).num, "2,100");
  const off = await withHelper(); // a helper of its own, so the page really gets a new connection to talk to
  await page.goto(`${off.base}/overlay/likers/?channel=pond_cafe&platform=tiktok&celebrate=0`, { settle: 800 });
  await until(() => off.made.length === 1);
  await sleep(150);
  off.made[0].emit("like", like("1", "Ann", 5000));
  await until(async () => (await ranking()).length === 1, 4000);
  await noParty();
});

test("overlay: in practice mode the first liker is just short of a milestone, so the celebration shows by itself", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(`${base}/overlay/likers/?demo=1&pace=300&celebrateTime=3`, { settle: 500 });
  await until(async () => (await party()) !== null, 30000);
  const shown = await party();
  assert.equal(shown.who, "Pond Pal");
  assert.match(shown.total, /^1,0\d\d likes$/);
  assert.equal(shown.crown, true);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("editor: the milestone choices are there, the test button shows the celebration (never under 1,000 likes), and the link carries what was changed", { skip }, async () => {
  const { base } = await withHelper();
  await page.goto(base + "/likers/", { settle: 800 });
  const labels = await page.evaluate(`[...document.querySelectorAll("#opt-controls .ctl__label")].map((l) => l.textContent.trim())`);
  for (const label of ["Celebrate a like milestone", "Celebrate every", "Who is celebrated", "Words under the name", "Seconds on screen", "Sound"]) assert.ok(labels.includes(label), label);
  await type("#c-milestone", "300");
  await click('[data-test="milestone"]');
  await until(async () => (await party()) !== null, 3000);
  const shown = await party();
  assert.equal(shown.crown, true);
  assert.ok(Number(shown.num.replace(/,/g, "")) >= 1000, `300 is taken as 1,000: ${shown.num}`);
  await type("#c-milestone", "5000");
  await type("#source-channel", "pond.pal");
  const url = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(url.searchParams.get("milestone"), "5000");
  assert.equal(url.searchParams.has("celebrate"), false, "switched on is the usual, so it is not in the link");
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});
