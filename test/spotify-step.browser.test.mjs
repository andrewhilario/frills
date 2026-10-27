// The "Connect Spotify" step of the Song requests editor in a real headless Chrome, with Spotify and the post box faked (a script put in before the
// page's own code runs answers their addresses and writes down every call): logged out it offers the login and shows nothing else of Spotify;
// logged in it says who, shows the song playing, shares it (on the first time, with a switch), puts the code in the link only while sharing,
// adds a pretend viewer's !sr song to the Spotify queue when asked and only practices otherwise, and the login brings the person back to the
// page they started on. Also the old test page, whose time display used to break. Skipped on a computer with no Chrome or Edge.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch, sleep } from "../scripts/lib/chrome.mjs";
import { createStatic } from "../scripts/lib/static.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "songs", "index.html"))) throw new Error("dist/ has no songs page. Run `npm run build` first (`npm test` does that for you).");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

let server;
let base;
let page;
before(async () => {
  if (skip) return;
  server = http.createServer(createStatic(dist));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  page = await launch();
  await page.viewport(1100, 900);
});
after(async () => {
  await page?.close();
  server?.closeAllConnections?.();
  server?.close();
});

const TRACK = "spotify:track:" + "a".repeat(22);
// What runs before the page's own code: a fetch that answers Spotify and the post box, and (when asked) a saved login.
const stub = ({ login, session = null }) => `(() => {
  ${login ? `if (!JSON.parse(localStorage.getItem("frills:spotify:tokens") || "null")?.access) localStorage.setItem("frills:spotify:tokens", JSON.stringify({ access: "A", refresh: "R", expires: Date.now() + 3600000, scope: "" }));` : ""}
  ${session ? `localStorage.setItem("frills:spotify:session", JSON.stringify(${JSON.stringify(session)}));` : ""}
  window.__calls = [];
  const real = window.fetch.bind(window);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  window.fetch = async (input, options = {}) => {
    const url = String(typeof input === "string" ? input : input.url);
    const method = (options.method ?? "GET").toUpperCase();
    if (!/^https:\\/\\/(api|accounts)\\.spotify\\.com\\//.test(url) && !url.includes("/api/nowplaying/") && !url.includes("/api/songs")) return real(input, options);
    window.__calls.push({ method, url, body: options.body ? String(options.body) : "" });
    if (url.includes("accounts.spotify.com/api/token")) return json({ access_token: "A", refresh_token: "R", expires_in: 3600, scope: "" });
    if (url.includes("/api/nowplaying/")) return json({ ok: true });
    if (url.includes("/api/songs")) return json({ ok: true, results: [{ id: "1", title: "Levitating", artist: "Dua Lipa", cover: "", seconds: 203, link: "", trackId: "" }] });
    if (url.endsWith("/v1/me")) return json({ display_name: "Tester" });
    if (url.includes("/me/player/currently-playing")) return json({ is_playing: true, progress_ms: 10000, item: { id: "x", uri: "${TRACK}", name: "Without Me", duration_ms: 225000, artists: [{ name: "Dayseeker" }], album: { images: [{ url: "https://i.scdn.co/image/a" }, { url: "https://i.scdn.co/image/b" }, { url: "https://i.scdn.co/image/c" }] } } });
    if (url.includes("/v1/search")) return json({ tracks: { items: [{ id: "x", uri: "spotify:track:" + (btoa(new URL(url).searchParams.get("q")).replace(/[^A-Za-z0-9]/g, "") + "x".repeat(22)).slice(0, 22), name: "Levitating", duration_ms: 200000, artists: [{ name: "Dua Lipa" }], album: { images: [] } }] } });
    if (url.includes("/me/player/queue") || url.includes("/me/player/next")) return new Response(null, { status: 204 });
    return json({}, 404);
  };
})()`;

let installed = null;
/** Opens a page with the faked Spotify; a fresh browser memory unless the test carries on from the one before. */
async function open(path, options = {}, { fresh = true } = {}) {
  if (installed) await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: installed });
  if (fresh) {
    await page.goto(`${base}/privacy/`, { settle: 100 });
    await page.evaluate("localStorage.clear(); sessionStorage.clear()");
  }
  installed = (await page.send("Page.addScriptToEvaluateOnNewDocument", { source: stub(options) })).identifier;
  await page.goto(`${base}${path}`, { settle: 500 });
}
const problems = () => page.problems.filter((p) => !p.includes("i.scdn.co"));
const text = (id) => page.evaluate(`document.getElementById(${JSON.stringify(id)}).textContent`);
const calls = () => page.evaluate("window.__calls");
const typeChannel = (name) => page.evaluate(`(() => { const i = document.getElementById("source-channel"); i.value = ${JSON.stringify(name)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const link = async () => new URL(await page.evaluate('document.getElementById("link").value'));
const say = async (viewer, line) => page.evaluate(`(() => { document.getElementById("spx-try-name").value = ${JSON.stringify(viewer)}; const t = document.getElementById("spx-try-text"); t.value = ${JSON.stringify(line)}; document.getElementById("spx-try").requestSubmit(); })()`);
/** Waits until the step says who is logged in; if it never does, the error says what the page shows and what was asked of Spotify. */
async function connected() {
  try {
    await page.waitFor(`document.getElementById("spx-status").textContent.includes("as Tester")`);
  } catch (error) {
    const seen = (await calls()).map((c) => c.method + " " + c.url.slice(0, 60)).join(", ");
    throw new Error(`${error.message}. The step says "${await text("spx-status")}"; calls: ${seen || "none"}; saved login: ${await page.evaluate('localStorage.getItem("frills:spotify:tokens")')}; problems: ${page.problems.join(" | ")}`);
  }
}
const logText = () => page.evaluate('[...document.querySelectorAll("#spx-log li")].map((li) => li.textContent).join(" | ")');

test("song requests: logged out, the Spotify step offers the login, hides the rest, and talks to nobody", { skip }, async () => {
  await open("/songs/", { login: false });
  const shown = await page.evaluate(`({ step: !document.getElementById("spotify-step").hidden, login: !document.getElementById("spx-login").hidden, logout: !document.getElementById("spx-logout").hidden, on: !document.getElementById("spx-on").hidden, status: document.getElementById("spx-status").textContent })`);
  assert.deepEqual({ ...shown, status: undefined }, { step: true, login: true, logout: false, on: false, status: undefined });
  assert.match(shown.status, /Not connected/);
  assert.deepEqual(await calls(), [], "no call to Spotify before anyone logs in");
  assert.equal(await page.evaluate('document.querySelector("#spotify-step h2").textContent.replace(/\\s+/g, " ").trim()'), "Connect Spotify (optional)");
  assert.equal(await page.evaluate('document.querySelector("#s5").textContent'), "Add it to your stream", "the link step is step 5 now");
});

test("song requests: the overlays page links to #spotify-step, and opening it scrolls the Spotify step into view", { skip }, async () => {
  await open("/songs/#spotify-step", { login: false });
  await page.waitFor(`(() => { const r = document.getElementById("spotify-step").getBoundingClientRect(); return r.top >= -5 && r.top < window.innerHeight; })()`);
  assert.equal(await page.evaluate("document.getElementById(\"spotify-step\").hidden"), false);
});

test("song requests: logged in, it says who, shows the song, starts sharing the first time, and the link carries the code only while sharing", { skip }, async () => {
  await open("/songs/", { login: true });
  await connected();
  await page.waitFor(`document.getElementById("spx-title").textContent === "Without Me"`);
  assert.equal(await text("spx-artist"), "Dayseeker");
  assert.equal(await page.evaluate('document.getElementById("spx-cover").src'), "https://i.scdn.co/image/b");
  assert.equal(await page.evaluate('[document.getElementById("spx-login").hidden, document.getElementById("spx-logout").hidden, document.getElementById("spx-on").hidden].join()'), "true,false,false");
  assert.equal(await page.evaluate('localStorage.getItem("frills:spotify:sharing")'), "1", "the first time, sharing starts on");
  assert.equal(await page.evaluate('document.getElementById("c-spShare").checked'), true, "with its switch showing it");
  assert.equal(await page.evaluate('document.getElementById("c-spQueue").checked'), false, "but the Spotify queue is never touched until asked");
  await page.waitFor(`window.__calls.some((c) => c.method === "PUT" && c.url.includes("/api/nowplaying/"))`);
  const put = (await calls()).find((c) => c.method === "PUT" && c.url.includes("/api/nowplaying/"));
  assert.deepEqual([JSON.parse(put.body).title, JSON.parse(put.body).artist, JSON.parse(put.body).playing], ["Without Me", "Dayseeker", true], "the song is passed to the overlay");
  const code = put.url.split("/").pop();
  await typeChannel("pond_cafe");
  assert.equal((await link()).searchParams.get("spotify"), code, "the code rides in the link");
  await page.evaluate('document.getElementById("c-spShare").click()');
  assert.equal((await link()).searchParams.has("spotify"), false, "not sharing: no code in the link");
  assert.equal(await page.evaluate('localStorage.getItem("frills:spotify:sharing")'), "0");
  assert.match(await text("spx-share-note"), /Not sharing/);
  await page.evaluate('document.getElementById("c-spShare").click()');
  assert.equal((await link()).searchParams.get("spotify"), code, "and back on again");
  assert.deepEqual(problems(), [], problems().join(" | "));
});

test("song requests: a pretend viewer's !sr goes to the Spotify queue only when that is on, is only practiced otherwise, and !next skips", { skip }, async () => {
  await open("/songs/", { login: true });
  await connected();
  await say("Bob", "!sr levitating dua lipa");
  await page.waitFor(`document.getElementById("spx-log").textContent.includes("Practice")`);
  assert.equal((await calls()).some((c) => c.url.includes("/me/player/queue")), false, "the switch is off: nothing was added to Spotify's queue");
  assert.match(await logText(), /Added to the song list on your stream/, "but the song list on the stream got it");
  await page.evaluate('document.getElementById("c-spQueue").click()');
  assert.match(await text("spx-queue-note"), /^On\./);
  await say("Ann", "!sr dance monkey");
  await page.waitFor(`window.__calls.some((c) => c.method === "POST" && c.url.includes("/me/player/queue"))`);
  const queued = (await calls()).find((c) => c.url.includes("/me/player/queue"));
  assert.match(queued.url, /uri=spotify%3Atrack%3A[A-Za-z0-9]{22}$/, "the first match is the one added");
  const searched = (await calls()).filter((c) => c.url.includes("/v1/search")).map((c) => new URL(c.url).searchParams.get("q"));
  assert.deepEqual(searched, ["levitating dua lipa", "dance monkey"], "the viewer's words are what is searched for (the practice one too)");
  await page.waitFor(`document.getElementById("spx-log").textContent.includes("was added to your Spotify queue")`);
  await say("Someone", "hello there");
  assert.match(await logText(), /not a command/);
  await say("Streamer", "!next");
  await page.waitFor(`window.__calls.some((c) => c.method === "POST" && c.url.includes("/me/player/next"))`);
  assert.match(await logText(), /skipped to the next song/);
  assert.equal(await page.evaluate('localStorage.getItem("frills:spotify:queue")'), "1", "the choice is remembered");
  assert.deepEqual(problems(), [], problems().join(" | "));
});

test("song requests: Disconnect forgets the login and stops sharing", { skip }, async () => {
  await open("/songs/", { login: true });
  await connected();
  await page.evaluate('document.getElementById("spx-logout").click()');
  assert.equal(await page.evaluate('localStorage.getItem("frills:spotify:tokens")'), null);
  assert.equal(await page.evaluate('localStorage.getItem("frills:spotify:sharing")'), "0");
  assert.equal(await page.evaluate('[document.getElementById("spx-login").hidden, document.getElementById("spx-on").hidden].join()'), "false,true");
  await typeChannel("pond_cafe");
  assert.equal((await link()).searchParams.has("spotify"), false);
});

test("the login brings the person back to the Song requests editor when they started there, and to the test page otherwise", { skip }, async () => {
  const session = { verifier: "v".repeat(64), state: "st", at: Date.now() };
  await open("/songs/", { login: false });
  await page.evaluate('sessionStorage.setItem("frills:spotify:return", "/songs/")');
  await open("/spotify/callback/?code=abc&state=st", { login: false, session }, { fresh: false });
  await page.waitFor('location.pathname === "/songs/"', { timeout: 6000 });
  assert.equal(await page.evaluate('sessionStorage.getItem("frills:spotify:return")'), null, "the note is used once");
  await open("/spotify/callback/?code=abc&state=st", { login: false, session }, { fresh: false });
  await page.waitFor('location.pathname === "/spotify/"', { timeout: 6000 });
  await page.evaluate('sessionStorage.setItem("frills:spotify:return", "//evil.example/")');
  await open("/spotify/callback/?code=abc&state=st", { login: false, session }, { fresh: false });
  await page.waitFor('location.pathname === "/spotify/"', { timeout: 6000 });
});

test("the Spotify test page shows the song's title and time while it plays (the time display used to break)", { skip }, async () => {
  await open("/spotify/", { login: true });
  await page.waitFor(`document.getElementById("sp-title").textContent === "Without Me"`);
  assert.equal(await text("sp-time"), "0:10 / 3:45");
  await sleep(300);
  assert.deepEqual(problems(), [], problems().join(" | "));
});
