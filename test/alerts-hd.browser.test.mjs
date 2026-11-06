// The picture on an alert card (trading, profile, polaroid draw it large): the page uses the big picture TikTok sent, falls back to the small one when the big one
// cannot be loaded, and uses the small one when that is all there is. The pictures here are tiny drawn ones (the page accepts those as well as TikTok's own),
// so no network is needed. Skipped on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createHelper } from "../helper/server.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "overlay", "alerts", "index.html"))) throw new Error("dist/ has no alerts overlay. Run `npm run build` first (`npm test` does that for you).");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

const svg = (markup) => "data:image/svg+xml;base64," + Buffer.from(markup).toString("base64");
const SMALL = svg('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>');
const BIG = svg('<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720"><rect width="720" height="720" fill="blue"/></svg>');
const BROKEN = svg("this is not a picture");

class FakeConnection extends EventEmitter {
  async connect() { await sleep(5); }
  disconnect() { this.emit("disconnected"); }
}
const opened = [];
async function withHelper() {
  const made = [];
  const helper = createHelper({ distDir: dist, factory: async () => { const conn = new FakeConnection(); made.push(conn); return conn; }, idleStopMs: 200, offlineWaitMs: 5000 });
  const port = await helper.listen(0);
  opened.push(helper);
  return { base: `http://127.0.0.1:${port}`, made };
}
const until = async (test, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await test()) return; await sleep(30); }
  throw new Error("Timed out");
};

let page;
before(async () => {
  if (skip) return;
  page = await launch();
  await page.viewport(900, 900);
});
after(async () => {
  await page?.close();
  for (const h of opened) await h.close();
});

const follow = (user) => ({ common: { msgId: "f1" }, user: { id: "1", displayId: "pond_pal", nickname: "Pond Pal", ...user } });
/** Opens the alerts overlay in a card style, has a follow arrive from a pretend TikTok, and waits for its picture to settle. */
async function seen(card, user) {
  const { base, made } = await withHelper();
  await page.goto(`${base}/overlay/alerts/?channel=pond_cafe&platform=tiktok&card=${card}&followTime=8`, { settle: 800 });
  await until(() => made.length === 1);
  await sleep(150);
  made[0].emit("follow", follow(user));
  await until(() => page.evaluate('document.querySelector("#alerts .alert__av") !== null'));
  await sleep(500);
  return page.evaluate(`(() => { const img = document.querySelector("#alerts .alert__img"); return { src: img ? img.getAttribute("src") : null, width: img ? img.naturalWidth : 0, pic: document.querySelector("#alerts .alert__av--pic") !== null }; })()`);
}

test("alert pictures: the card draws the big picture when TikTok sent one (trading, profile and polaroid cards), and it is a sharp one", { skip }, async () => {
  for (const card of ["trading", "profile", "polaroid"]) {
    const shown = await seen(card, { avatarThumb: { urlList: [SMALL] }, avatarMedium: { urlList: [BIG] } });
    assert.equal(shown.src, BIG, `${card}: the big picture, not the 100 px one`);
    assert.equal(shown.width, 720, `${card}: drawn from a 720 px picture`);
    assert.equal(shown.pic, true);
  }
});

test("alert pictures: when the big picture cannot be loaded the small one is used, and with only a small one that is what is drawn", { skip }, async () => {
  const fallback = await seen("trading", { avatarThumb: { urlList: [SMALL] }, avatarMedium: { urlList: [BROKEN] } });
  assert.equal(fallback.src, SMALL, "the big one failed, so the small one took its place");
  assert.equal(fallback.pic, true);
  const only = await seen("polaroid", { avatarThumb: { urlList: [SMALL] } });
  assert.equal(only.src, SMALL, "an older relay, or a chatter with no big picture");
  assert.equal(only.pic, true);
  const none = await seen("profile", {});
  assert.deepEqual([none.src, none.pic], [null, false], "no picture at all: the person's initial, as before");
});
