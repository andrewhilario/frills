// The TikTok parts that need no browser and no network: what counts as a TikTok name, how a message from the helper is checked, how
// TikTok's own events become Frills messages, and how the links and status lines read.

import test from "node:test";
import assert from "node:assert/strict";
import { acceptMessage, cleanTikTokUser, connectTikTok, isAvatarUrl } from "../src/js/tiktok.js";
import { cleanName, statusText } from "../src/js/connect.js";
import { overlayUrl } from "../src/js/settings.js";
import { matchaOverlayUrl } from "../src/js/matcha.js";
import { classify } from "../helper/rooms.mjs";
import { avatarUrl, mapChat, mapDelete, mapGift } from "../helper/map.mjs";

test("a TikTok name is letters, numbers, underscores and dots, with or without an @ or a link around it", () => {
  assert.equal(cleanTikTokUser("  @Some_Name.9 "), "some_name.9");
  assert.equal(cleanTikTokUser("tv_asahi_news"), "tv_asahi_news");
  assert.equal(cleanTikTokUser("https://www.tiktok.com/@officialgeilegisela/live"), "officialgeilegisela");
  assert.equal(cleanTikTokUser("tiktok.com/@a.b?lang=en"), "a.b");
  for (const bad of ["", "a", "x".repeat(25), "has space", "name.", "a\r\nb", "naïve", "../x", "@", null, undefined]) assert.equal(cleanTikTokUser(bad), "", String(bad));
});

test("cleanName picks the rules of the chosen platform", () => {
  assert.equal(cleanName("tiktok", "@Pond.Pal"), "pond.pal"); // a dot is fine on TikTok
  assert.equal(cleanName("twitch", "@Pond.Pal"), ""); // and not on Twitch
  assert.equal(cleanName("twitch", "#Pond_Pal"), "pond_pal");
});

test("a message from the helper is checked field by field before it is drawn", () => {
  assert.deepEqual(acceptMessage({ id: "1", user: "9", name: "Mochi", text: "hi!", mod: true, gifter: true, extra: "<img>" }), {
    id: "1", user: "9", name: "Mochi", text: "hi!", color: null, mod: true, gift: false, gifter: true, avatar: "", emotes: [], source: "tiktok",
  });
  assert.equal(acceptMessage({ id: "1", name: "Mochi", text: "   " }), null);
  assert.equal(acceptMessage({ id: "1", name: "", text: "hi" }), null);
  assert.equal(acceptMessage(null), null);
  assert.equal(acceptMessage("hi"), null);
  const long = acceptMessage({ name: "n".repeat(200), text: "t".repeat(2000) });
  assert.equal(long.text.length, 300);
  assert.equal(long.name.length, 60);
  const sneaky = acceptMessage({ name: "x", text: "y", mod: "yes", gift: 1, emotes: [{ id: "1", start: 0, end: 0 }], color: "#ff0000" });
  assert.equal(sneaky.mod, false, "only a real true counts");
  assert.equal(sneaky.gift, false);
  assert.deepEqual(sneaky.emotes, []);
  assert.equal(sneaky.color, null, "TikTok has no name colours");
});

// What tiktok-live-connector 2.5.0 really sends (shape taken from a live room on 2026-10-07; the words here are made up).
const chat = (over = {}) => ({
  common: { msgId: "7000000000000000001", createTime: "1790000000000" },
  user: { id: "6800000000000000001", idStr: "", displayId: "pond.pal", nickname: "Pond Pal", userRole: 0, isFollower: false },
  content: "hello from the pond",
  userIdentity: { isGiftGiverOfAnchor: false, isSubscriberOfAnchor: false, isMutualFollowingWithAnchor: false, isFollowerOfAnchor: false, isModeratorOfAnchor: false, isAnchor: false },
  emotes: [],
  ...over,
});

test("a TikTok chat event becomes a Frills message", () => {
  assert.deepEqual(mapChat(chat()), { id: "7000000000000000001", user: "6800000000000000001", name: "Pond Pal", text: "hello from the pond", mod: false, gifter: false, gift: false, avatar: "" });
  const mod = mapChat(chat({ userIdentity: { isModeratorOfAnchor: true, isGiftGiverOfAnchor: true } }));
  assert.equal(mod.mod, true);
  assert.equal(mod.gifter, true);
});

test("a chat event with no text or no person is skipped, and odd text is tidied to one line", () => {
  assert.equal(mapChat(chat({ content: "" })), null);
  assert.equal(mapChat(chat({ content: "   \n  " })), null);
  assert.equal(mapChat(chat({ user: undefined })), null);
  assert.equal(mapChat(null), null);
  assert.equal(mapChat(chat({ content: "two\nlines\t and   spaces\u0007" })).text, "two lines and spaces");
  assert.equal(mapChat(chat({ content: "x".repeat(900) })).text.length, 300);
});

test("a name falls back to the @name, and older library shapes still work", () => {
  assert.equal(mapChat(chat({ user: { id: "1", displayId: "pond.pal", nickname: "" } })).name, "pond.pal");
  const old = mapChat({ comment: "old shape", msgId: "5", user: { userId: "77", uniqueId: "someone", nickname: "Someone" } });
  assert.deepEqual(old, { id: "5", user: "77", name: "Someone", text: "old shape", mod: false, gifter: false, gift: false, avatar: "" });
});

const PICTURE = "https://p16-common-sign.tiktokcdn-us.com/tos-useast5-avt-0068-tx/abc~tplv-tiktokx-cropcenter:100:100.webp?dr=1&x-expires=1790000000&x-signature=zzz";

test("only pictures from TikTok's picture servers, or a drawing inside the address, are accepted", () => {
  assert.equal(isAvatarUrl(PICTURE), true);
  assert.equal(isAvatarUrl("https://p19-common-sign.tiktokcdn.com/a~tplv.jpeg?x=1"), true);
  assert.equal(isAvatarUrl("https://p16-common-sign.tiktokcdn-eu.com/a.webp"), true);
  assert.equal(isAvatarUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="), true);
  for (const bad of [
    "http://p16.tiktokcdn.com/a.webp", // not https
    "https://evil.example/a.webp",
    "https://tiktokcdn.com.evil.example/a.webp", // a look-alike host
    "https://nottiktokcdn.com/a.webp",
    "https://user:pass@p16.tiktokcdn.com/a.webp",
    "https://p16.tiktokcdn.com/a.heic", // a browser can't draw it
    "javascript:alert(1)",
    "data:text/html;base64,PGI+",
    "data:image/svg+xml,<svg onload=alert(1)>", // not base64
    "https://p16.tiktokcdn.com/" + "a".repeat(700),
    "", null, undefined, 42, {},
  ]) assert.equal(isAvatarUrl(bad), false, String(bad).slice(0, 60));
});

test("a message from the helper keeps a good picture address and drops a bad one", () => {
  assert.equal(acceptMessage({ name: "Ann", text: "hi", avatar: PICTURE }).avatar, PICTURE);
  assert.equal(acceptMessage({ name: "Ann", text: "hi", avatar: "https://evil.example/a.webp" }).avatar, "");
  assert.equal(acceptMessage({ name: "Ann", text: "hi" }).avatar, "");
});

test("the profile picture is the first address that may be loaded, skipping ones a browser can't draw", () => {
  const user = (list) => ({ avatarThumb: { urlList: list } });
  assert.equal(avatarUrl(user([PICTURE, "https://p16-common-sign.tiktokcdn.com/b.jpeg"])), PICTURE);
  assert.equal(avatarUrl(user(["https://p16-common-sign.tiktokcdn.com/a.heic", "https://p16-common-sign.tiktokcdn.com/b.jpeg"])), "https://p16-common-sign.tiktokcdn.com/b.jpeg");
  assert.equal(avatarUrl(user(["https://evil.example/a.webp", PICTURE])), PICTURE, "a stranger's address is passed over");
  assert.equal(avatarUrl({ avatarThumb: { urlList: [] }, avatarMedium: { urlList: [PICTURE] } }), PICTURE, "the medium size is the fallback");
  assert.equal(avatarUrl(user(["https://evil.example/a.webp"])), "");
  assert.equal(avatarUrl({}), "");
  assert.equal(avatarUrl(null), "");
  assert.equal(mapChat(chat({ user: { id: "1", displayId: "pond.pal", nickname: "Pond Pal", avatarThumb: { urlList: [PICTURE] } } })).avatar, PICTURE);
  assert.equal(mapGift({ common: { msgId: "g" }, user: { id: "7", displayId: "ann", nickname: "Ann", avatarThumb: { urlList: [PICTURE] } }, gift: { name: "Rose", type: 2 }, repeatCount: 1 }).avatar, PICTURE);
});

test("a gift shows once: a streak waits for its last event, a single gift shows straight away", () => {
  const gift = (over = {}) => ({ common: { msgId: "g1" }, user: { id: "1", displayId: "a", nickname: "Ann" }, gift: { name: "Rose", type: 1 }, repeatCount: 3, repeatEnd: 0, ...over });
  assert.equal(mapGift(gift()), null, "a streak still counting");
  const done = mapGift(gift({ repeatEnd: 1 }));
  assert.equal(done.text, "sent Rose ×3");
  assert.equal(done.gift, true);
  assert.equal(done.gifter, true);
  assert.equal(mapGift(gift({ gift: { name: "Heart", type: 2 }, repeatCount: 0 })).text, "sent Heart ×1");
  assert.equal(mapGift(gift({ gift: {}, repeatEnd: 1 })).text, "sent a gift ×3");
  assert.equal(mapGift({ gift: { name: "Rose" } }), null, "nobody sent it");
  assert.equal(mapGift(gift({ gift: { name: "Rose", type: 2 }, repeatCount: 1e9 })).text, "sent Rose ×9999");
});

test("a moderator's delete event lists what to remove", () => {
  assert.deepEqual(mapDelete({ deleteMsgIds: ["1", "2"], deleteUserIds: ["9"] }), { ids: ["1", "2"], users: ["9"] });
  assert.deepEqual(mapDelete({}), { ids: [], users: [] });
  assert.deepEqual(mapDelete(null), { ids: [], users: [] });
});

test("errors from the connector are sorted into the three that need different handling", () => {
  const named = (name, message = "") => Object.assign(new Error(message), { name });
  class UserOfflineError extends Error {}
  class SignatureRateLimitError extends Error {}
  assert.equal(classify(new UserOfflineError("offline")).kind, "offline");
  assert.equal(classify(new SignatureRateLimitError("slow down")).kind, "limited");
  assert.equal(classify(named("Error", "HTTP 429 Too Many Requests")).kind, "limited");
  assert.equal(classify(named("SetupError", "run npm run tiktok:setup")).kind, "fatal");
  assert.equal(classify(named("InvalidUniqueIdError")).kind, "fatal");
  assert.equal(classify(new Error("socket hang up")).kind, "failed");
  assert.equal(classify(undefined).kind, "failed");
});

test("TikTok links carry the platform and Twitch links stay as they were", () => {
  assert.equal(overlayUrl("http://127.0.0.1:8765/overlay/", { channel: "pond.pal", platform: "tiktok" }), "http://127.0.0.1:8765/overlay/?channel=pond.pal&platform=tiktok");
  assert.equal(overlayUrl("https://x.test/overlay/", { channel: "somename" }), "https://x.test/overlay/?channel=somename");
  assert.equal(overlayUrl("https://x.test/overlay/", { channel: "", platform: "tiktok" }), "https://x.test/overlay/?", "no name, no platform part");
  assert.match(matchaOverlayUrl("http://127.0.0.1:8765/overlay/", { channel: "pond.pal", platform: "tiktok" }), /^http:\/\/127\.0\.0\.1:8765\/overlay\/\?channel=pond\.pal&platform=tiktok&style=latte/);
  assert.doesNotMatch(matchaOverlayUrl("https://x.test/overlay/", { channel: "somename" }), /platform/);
});

test("status lines read the same for both platforms and name the right kind of account", () => {
  assert.equal(statusText({ state: "connecting", channel: "pond.pal", platform: "tiktok" }), "Connecting to @pond.pal…");
  assert.equal(statusText({ state: "connecting", channel: "pondpal" }), "Connecting to #pondpal…");
  assert.equal(statusText({ state: "connected", channel: "pond.pal", platform: "tiktok" }), "Reading @pond.pal's LIVE chat");
  assert.equal(statusText({ state: "connected", channel: "frills_demo", platform: "tiktok", detail: "Practice chat made up by the Frills helper." }), "Practice chat made up by the Frills helper.", "a detail from the helper wins");
  assert.match(statusText({ state: "offline", channel: "pond.pal", platform: "tiktok" }), /@pond\.pal isn't live right now/);
  assert.match(statusText({ state: "limited", platform: "tiktok" }), /busy/);
  assert.match(statusText({ state: "helper-lost", platform: "tiktok" }), /Frills helper/);
  assert.equal(statusText({ state: "error", detail: "Nope" }), "Nope");
  assert.equal(statusText({ state: "whatever" }), "");
});

// A pretend EventSource, so the page side can be checked without a page or a helper.
function fakeEventSource() {
  const handlers = {};
  const source = {
    readyState: 1,
    closed: false,
    onerror: null,
    addEventListener: (name, fn) => { (handlers[name] ??= []).push(fn); },
    close() { this.closed = true; },
    send: (name, data) => (handlers[name] ?? []).forEach((fn) => fn({ data: typeof data === "string" ? data : JSON.stringify(data) })),
  };
  return source;
}

test("the page side turns the helper's events into feed calls and status lines", () => {
  const source = fakeEventSource();
  let url = "";
  const seen = { messages: [], removed: [], cleared: [], status: [] };
  const conn = connectTikTok({
    user: "@Pond.Pal",
    eventSourceFactory: (u) => { url = u; return source; },
    onMessage: (m) => seen.messages.push(m),
    onRemove: (r) => seen.removed.push(r),
    onClear: (c) => seen.cleared.push(c),
    onStatus: (s) => seen.status.push(`${s.state}${s.fatal ? "!" : ""}`),
  });
  assert.equal(url, "/tiktok/stream?user=pond.pal");
  source.send("status", { state: "connected" });
  source.send("chat", { id: "1", user: "9", name: "Ann", text: "hi", mod: true });
  source.send("chat", { id: "2", name: "", text: "dropped: no name" });
  source.send("chat", "{ this is not json");
  source.send("remove", { id: "1" });
  source.send("clear", { user: "9" });
  source.send("status", { state: "error", detail: "TikTok doesn't know that name.", fatal: true });
  assert.deepEqual(seen.status, ["connecting", "connected", "error!"]);
  assert.deepEqual(seen.messages.map((m) => m.text), ["hi"]);
  assert.equal(seen.messages[0].mod, true);
  assert.deepEqual(seen.removed, [{ id: "1" }]);
  assert.deepEqual(seen.cleared, [{ user: "9" }]);
  // the browser retrying by itself is "lost the helper"; the browser giving up is an error
  source.readyState = 0;
  source.onerror();
  source.readyState = 2;
  source.onerror();
  assert.deepEqual(seen.status.slice(3), ["helper-lost", "error!"]);
  conn.stop();
  assert.equal(source.closed, true);
  source.send("chat", { id: "3", name: "Late", text: "after stop" });
  assert.equal(seen.messages.length, 1, "nothing is drawn after stop");
  assert.equal(seen.status.at(-1), "stopped");
});

test("a bad TikTok name fails at once, without opening a connection", () => {
  let opened = false;
  const status = [];
  connectTikTok({ user: "no spaces allowed", eventSourceFactory: () => { opened = true; return fakeEventSource(); }, onStatus: (s) => status.push(s) });
  assert.equal(opened, false);
  assert.equal(status[0].state, "error");
  assert.equal(status[0].fatal, true);
});
