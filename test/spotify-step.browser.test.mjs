// The "Connect Spotify" step of the Song requests editor in a real headless Chrome, with Frills' Worker and Spotify faked (a script put in before the
// page's own code runs answers their addresses and writes down every call). Frills keeps the Spotify login (worker/spotify.mjs), so the step:
// logged out offers the login and says what will be kept; connected says who, shows the song playing, keeps the two switches in the Worker (not in the
// browser) and puts the code in the overlay link; a login found only in this browser is handed over when asked (or by itself right after Log in);
// a pretend viewer's !sr and !next go to the Worker, which practices until the queue switch is on; Disconnect deletes it; a login that ran out and a
// Worker that cannot keep logins are said plainly. Also the login's way back to the page it started from, and the old private test page, whose
// time display used to break. Skipped on a computer with no Chrome or Edge.

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
// What runs before the page's own code: a fetch that plays Frills' Worker (status, login, switches, try-it, the song playing) and Spotify, a saved
// login in this browser when asked, and the note the page leaves between pressing Log in and coming back.
const stub = ({ server = null, login = false, session = null, loginReply = null, keep = false, statusReply = null, settingsReply = null }) => `(() => {
  ${login ? `if (!JSON.parse(localStorage.getItem("frills:spotify:tokens") || "null")?.access) localStorage.setItem("frills:spotify:tokens", JSON.stringify({ access: "A", refresh: "R".repeat(40), expires: Date.now() + 3600000, scope: "" }));` : ""}
  ${session ? `localStorage.setItem("frills:spotify:session", JSON.stringify(${JSON.stringify(session)}));` : ""}
  ${keep ? `sessionStorage.setItem("frills:spotify:keep", "1");` : ""}
  window.__calls = [];
  window.__server = ${JSON.stringify(server ? { connected: true, state: "ok", name: "Tester", share: true, queue: false, log: [], ...server } : { connected: false })};
  window.__loginReply = ${JSON.stringify(loginReply)};
  window.__statusReply = ${JSON.stringify(statusReply)};
  window.__settingsReply = ${JSON.stringify(settingsReply)};
  const real = window.fetch.bind(window);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  window.fetch = async (input, options = {}) => {
    const url = String(typeof input === "string" ? input : input.url);
    const method = (options.method ?? "GET").toUpperCase();
    if (!(url.includes("api.spotify.com") || url.includes("accounts.spotify.com") || url.includes("/api/nowplaying/") || url.includes("/api/spotify/") || url.includes("/api/songs"))) return real(input, options);
    window.__calls.push({ method, url, body: options.body ? String(options.body) : "" });
    const s = window.__server;
    const action = url.includes("/api/spotify/") ? url.split("/").pop() : "";
    if (action === "status") return json(window.__statusReply ?? (s.connected ? { ok: true, connected: true, state: s.state, name: s.name, share: s.share, queue: s.queue, log: s.log } : { ok: true, connected: false }), window.__statusReply ? 503 : 200);
    if (action === "login") {
      if (method === "DELETE") { window.__server = { connected: false }; return json({ ok: true }); }
      if (window.__loginReply) return json(window.__loginReply.body, window.__loginReply.status);
      window.__server = { connected: true, state: "ok", name: "Tester", share: true, queue: false, log: [] };
      return json({ ok: true, name: "Tester", share: true, queue: false });
    }
    if (action === "settings") {
      if (window.__settingsReply) return json(window.__settingsReply.body, window.__settingsReply.status);
      Object.assign(s, JSON.parse(options.body));
      return json({ ok: true, share: s.share, queue: s.queue });
    }
    if (action === "request" || action === "next") {
      const b = JSON.parse(options.body);
      const text = action === "next"
        ? b.name + " used !next: " + (s.queue ? "skipped to the next song." : "(Practice: nothing was skipped.)")
        : (s.queue ? b.name + ": “Levitating” · Dua Lipa was added to your Spotify queue." : b.name + " asked for “Levitating” · Dua Lipa. (Practice: not added to your queue.)");
      return json({ ok: true, entry: { at: Date.now(), state: "ok", text } });
    }
    if (url.includes("/api/nowplaying/")) return method === "GET" ? (s.connected && s.share ? json({ ok: true, now: Date.now(), updatedAt: Date.now(), data: { playing: true, title: "Without Me", artist: "Dayseeker", cover: "https://i.scdn.co/image/b", progressMs: 10000, durationMs: 225000 } }) : json({ ok: false }, 404)) : json({ ok: true });
    if (url.includes("accounts.spotify.com/api/token")) return json({ access_token: "A", refresh_token: "R".repeat(40), expires_in: 3600, scope: "" });
    if (url.includes("/api/songs")) return json({ ok: true, results: [{ id: "1", title: "Levitating", artist: "Dua Lipa", cover: "", seconds: 203, link: "", trackId: "" }] });
    if (url.endsWith("/v1/me")) return json({ display_name: "Tester" });
    if (url.includes("/me/player/currently-playing")) return json({ is_playing: true, progress_ms: 10000, item: { id: "x", uri: "${TRACK}", name: "Without Me", duration_ms: 225000, artists: [{ name: "Dayseeker" }], album: { images: [{ url: "https://i.scdn.co/image/a" }, { url: "https://i.scdn.co/image/b" }, { url: "https://i.scdn.co/image/c" }] } } });
    if (url.includes("/v1/search")) return json({ tracks: { items: [] } });
    if (url.includes("/me/player/queue") || url.includes("/me/player/next")) return new Response(null, { status: 204 });
    return json({}, 404);
  };
})()`;

let installed = null;
/** Opens a page with the faked Worker and Spotify; a fresh browser memory unless the test carries on from the one before. */
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
const worker = async (action) => (await calls()).filter((c) => c.url.includes("/api/spotify/") && c.url.endsWith("/" + action));
const typeChannel = (name) => page.evaluate(`(() => { const i = document.getElementById("source-channel"); i.value = ${JSON.stringify(name)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const link = async () => new URL(await page.evaluate('document.getElementById("link").value'));
const say = async (viewer, line) => page.evaluate(`(() => { document.getElementById("spx-try-name").value = ${JSON.stringify(viewer)}; const t = document.getElementById("spx-try-text"); t.value = ${JSON.stringify(line)}; document.getElementById("spx-try").requestSubmit(); })()`);
const shown = (...ids) => page.evaluate(`[${ids.map((id) => `!document.getElementById("spx-${id}").hidden`).join(", ")}].join()`);
const code = async () => (await worker("status"))[0].url.split("/").at(-2);
/** Waits until the step says who Frills is keeping the login for; if it never does, the error says what the page shows and what was asked. */
async function connected() {
  try {
    await page.waitFor(`document.getElementById("spx-status").textContent.includes("as Tester")`);
  } catch (error) {
    const seen = (await calls()).map((c) => c.method + " " + c.url.slice(0, 60)).join(", ");
    throw new Error(`${error.message}. The step says "${await text("spx-status")}"; calls: ${seen || "none"}; problems: ${page.problems.join(" | ")}`);
  }
}
const logText = () => page.evaluate('[...document.querySelectorAll("#spx-log li")].map((li) => li.textContent).join(" | ")');

test("song requests: logged out, the Spotify step offers the login, says what Frills will keep, hides the rest, and only asks Frills who is connected", { skip }, async () => {
  await open("/songs/", { server: null });
  assert.equal(await shown("login", "keep", "logout", "on", "keep-note"), "true,false,false,false,true");
  assert.equal(await page.evaluate('!document.getElementById("spotify-step").hidden'), true);
  assert.match(await text("spx-status"), /Not connected/);
  assert.match(await text("spx-keep-note"), /Frills keeps your Spotify login on its server, encrypted/);
  assert.match(await text("spx-keep-note"), /Disconnect.*deletes it at once.*14 days/);
  assert.deepEqual((await calls()).map((c) => c.method + " " + c.url.split("/").at(-1)), ["GET status"], "one question to Frills, nothing to Spotify");
  assert.equal(await page.evaluate('document.querySelector("#spotify-step h2").textContent.replace(/\\s+/g, " ").trim()'), "Connect Spotify (optional)");
  assert.equal(await page.evaluate('document.querySelector("#s5").textContent'), "Add it to your stream", "the link step is step 5 now");
  assert.equal(await page.evaluate('document.getElementById("spotify-step").hasAttribute("data-ticker")'), false, "the step no longer needs a clock to stay awake in the background");
});

test("song requests: the overlays page links to #spotify-step, and opening it scrolls the Spotify step into view", { skip }, async () => {
  await open("/songs/#spotify-step", { server: null });
  await page.waitFor(`(() => { const r = document.getElementById("spotify-step").getBoundingClientRect(); return r.top >= -5 && r.top < window.innerHeight; })()`);
  assert.equal(await page.evaluate("document.getElementById(\"spotify-step\").hidden"), false);
});

test("song requests: connected, it says who, that the page can be closed, shows the song, and the link carries the code (nothing is sent to Spotify or to the old post box from here)", { skip }, async () => {
  await open("/songs/", { server: {} });
  await connected();
  assert.match(await text("spx-status"), /Frills keeps your login, so you can close this page/);
  await page.waitFor(`document.getElementById("spx-title").textContent === "Without Me"`);
  assert.equal(await text("spx-artist"), "Dayseeker");
  assert.equal(await page.evaluate('document.getElementById("spx-cover").src'), "https://i.scdn.co/image/b");
  assert.equal(await shown("login", "keep", "logout", "on", "keep-note"), "false,false,true,true,false");
  assert.equal(await page.evaluate('document.getElementById("c-spShare").checked'), true, "sharing is as Frills keeps it");
  assert.equal(await page.evaluate('document.getElementById("c-spQueue").checked'), false, "and the Spotify queue is never touched until asked");
  assert.match(await text("spx-share-note"), /^Sharing\..*even with this page closed/);
  const all = await calls();
  assert.equal(all.some((c) => c.url.includes("api.spotify.com") || c.url.includes("accounts.spotify.com")), false, "this page does not talk to Spotify any more");
  assert.equal(all.some((c) => c.method === "PUT" && c.url.includes("/api/nowplaying/")), false, "and does not post the song: Frills reads it itself");
  assert.equal(await page.evaluate('localStorage.getItem("frills:spotify:sharing")'), "1");
  await typeChannel("pond_cafe");
  assert.equal((await link()).searchParams.get("spotify"), await code(), "the code rides in the link, so the overlay can read the song and pass requests on");
  assert.deepEqual(problems(), [], problems().join(" | "));
});

test("song requests: the two switches are kept by Frills, and the code stays in the link either way", { skip }, async () => {
  await open("/songs/", { server: {} });
  await connected();
  await typeChannel("pond_cafe");
  await page.evaluate('document.getElementById("c-spShare").click()');
  await page.waitFor(`document.getElementById("spx-share-note").textContent.startsWith("Not sharing")`);
  assert.deepEqual((await worker("settings")).map((c) => JSON.parse(c.body)), [{ share: false }]);
  assert.equal((await link()).searchParams.get("spotify"), await code(), "the overlay still needs the code to pass requests on");
  await page.evaluate('document.getElementById("c-spShare").click()');
  await page.waitFor(`document.getElementById("spx-share-note").textContent.startsWith("Sharing")`);
  await page.evaluate('document.getElementById("c-spQueue").click()');
  await page.waitFor(`document.getElementById("spx-queue-note").textContent.startsWith("On.")`);
  assert.match(await text("spx-queue-note"), /even with this page closed/);
  assert.deepEqual((await worker("settings")).map((c) => JSON.parse(c.body)), [{ share: false }, { share: true }, { queue: true }]);
  assert.equal(await page.evaluate('localStorage.getItem("frills:spotify:queue")'), null, "the switch is no longer a note in this browser");
  assert.deepEqual(problems(), [], problems().join(" | "));
});

test("song requests: a switch Frills would not change goes back and says why", { skip }, async () => {
  await open("/songs/", { server: {}, settingsReply: { status: 403, body: { ok: false, error: "wrong_key" } } });
  await connected();
  await page.evaluate('document.getElementById("c-spQueue").click()');
  await page.waitFor(`document.getElementById("spx-queue-note").dataset.state === "error"`);
  assert.match(await text("spx-queue-note"), /not the one that connected Spotify/);
  assert.equal(await page.evaluate('document.getElementById("c-spQueue").checked'), false, "the switch is back where it was");
});

test("song requests: a pretend viewer's !sr and !next go to Frills, which only practices until the queue switch is on", { skip }, async () => {
  await open("/songs/", { server: {} });
  await connected();
  await say("Bob", "!sr levitating dua lipa");
  await page.waitFor(`document.getElementById("spx-log").textContent.includes("Practice")`);
  assert.deepEqual((await worker("request")).map((c) => JSON.parse(c.body)), [{ query: "levitating dua lipa", name: "Bob", test: true }]);
  assert.match(await logText(), /Added to the song list on your stream/, "the song list on the stream got it");
  await page.evaluate('document.getElementById("c-spQueue").click()');
  await page.waitFor(`document.getElementById("spx-queue-note").textContent.startsWith("On.")`);
  await say("Ann", "!sr dance monkey");
  await page.waitFor(`document.getElementById("spx-log").textContent.includes("was added to your Spotify queue")`);
  assert.equal((await worker("request")).length, 2);
  await say("Someone", "hello there");
  assert.match(await logText(), /not a command/);
  assert.equal((await worker("request")).length, 2, "chat that is not a command asks Frills nothing");
  await say("Streamer", "!next");
  await page.waitFor(`document.getElementById("spx-log").textContent.includes("skipped to the next song")`);
  assert.deepEqual((await worker("next")).map((c) => JSON.parse(c.body)), [{ name: "Streamer", test: true }]);
  assert.equal((await calls()).some((c) => c.url.includes("api.spotify.com")), false, "never straight to Spotify");
  assert.deepEqual(problems(), [], problems().join(" | "));
});

test("song requests: what Frills wrote down while the page was closed is listed, once", { skip }, async () => {
  const log = [{ at: 2000, state: "error", text: "Ann asked for “x”: Spotify has no device to play on." }, { at: 1000, state: "ok", text: "Bob: “Levitating” · Dua Lipa was added to your Spotify queue." }];
  await open("/songs/", { server: { log } });
  await connected();
  assert.equal(await page.evaluate('[...document.querySelectorAll("#spx-log li")].map((li) => li.dataset.state).join()'), "error,ok", "the newest first");
  assert.match(await logText(), /no device to play on/);
  await page.evaluate("window.__server.log = window.__server.log.slice()");
  await sleep(300);
  assert.equal(await page.evaluate('document.querySelectorAll("#spx-log li").length'), 2, "not listed twice");
});

test("song requests: a login found only in this browser is handed to Frills when the person asks, and then removed from this browser", { skip }, async () => {
  await open("/songs/", { server: null, login: true });
  await page.waitFor(`!document.getElementById("spx-keep").hidden`);
  assert.equal(await shown("login", "keep", "logout", "on"), "false,true,true,false");
  assert.match(await text("spx-status"), /logged in to Spotify in this browser, but Frills is not keeping the login yet/);
  assert.equal((await worker("login")).length, 0, "nothing is handed over by itself");
  await page.evaluate('document.getElementById("spx-keep").click()');
  await connected();
  const [sent] = (await worker("login")).map((c) => JSON.parse(c.body));
  assert.deepEqual(Object.keys(sent).sort(), ["access", "clientId", "expires", "refresh"]);
  assert.equal(sent.refresh, "R".repeat(40));
  assert.equal(sent.clientId.length, 32);
  assert.equal(await page.evaluate('localStorage.getItem("frills:spotify:tokens")'), null, "this browser no longer holds the login");
  await typeChannel("pond_cafe");
  assert.equal((await link()).searchParams.get("spotify"), await code());
  assert.deepEqual(problems(), [], problems().join(" | "));
});

test("song requests: back from Spotify's page after Log in, the login is handed to Frills by itself", { skip }, async () => {
  await open("/songs/", { server: null, login: true, keep: true });
  await connected();
  assert.equal((await worker("login")).length, 1);
  assert.equal(await page.evaluate('sessionStorage.getItem("frills:spotify:keep")'), null, "the note is used once");
  assert.equal(await page.evaluate('localStorage.getItem("frills:spotify:tokens")'), null);
});

test("song requests: Frills refusing a login (not on the app's allowlist) is said in words, and the useless login is dropped", { skip }, async () => {
  await open("/songs/", { server: null, login: true, loginReply: { status: 403, body: { ok: false, error: "not_allowed", message: "Spotify said no. This Spotify account has to be on the app's allowlist in the Spotify dashboard." } } });
  await page.waitFor(`!document.getElementById("spx-keep").hidden`);
  await page.evaluate('document.getElementById("spx-keep").click()');
  await page.waitFor(`document.getElementById("spx-status").dataset.state === "error"`);
  assert.match(await text("spx-status"), /allowlist/);
  assert.equal(await page.evaluate('localStorage.getItem("frills:spotify:tokens")'), null, "Spotify will not accept it, so it is gone");
  assert.equal(await shown("login", "keep", "on"), "true,false,false");
});

test("song requests: a login that ran out asks to log in again, and keeps the code in the link", { skip }, async () => {
  await open("/songs/", { server: { state: "expired" } });
  await page.waitFor(`document.getElementById("spx-status").textContent.includes("ran out")`);
  assert.equal(await page.evaluate('document.getElementById("spx-status").dataset.state'), "error");
  assert.equal(await shown("login", "keep", "logout", "on"), "true,false,true,false", "Log in again, or Disconnect to delete what Frills keeps");
  await typeChannel("pond_cafe");
  assert.equal((await link()).searchParams.get("spotify"), await code());
});

test("song requests: when Frills cannot keep logins yet, the step says so and does not offer a login that would go nowhere", { skip }, async () => {
  await open("/songs/", { server: null, statusReply: { ok: false, error: "not_ready" } });
  await page.waitFor(`document.getElementById("spx-status").dataset.state === "error"`);
  assert.match(await text("spx-status"), /cannot keep Spotify logins on this site yet/);
  assert.equal(await shown("login", "keep", "logout", "on", "keep-note"), "false,false,false,false,false");
});

test("song requests: Disconnect deletes what Frills keeps and drops the code from the link", { skip }, async () => {
  await open("/songs/", { server: {} });
  await connected();
  await typeChannel("pond_cafe");
  assert.equal((await link()).searchParams.has("spotify"), true);
  await page.evaluate('document.getElementById("spx-logout").click()');
  await page.waitFor(`document.getElementById("spx-status").textContent.startsWith("Not connected")`);
  assert.equal((await worker("login")).filter((c) => c.method === "DELETE").length, 1);
  assert.equal(await shown("login", "keep", "logout", "on"), "true,false,false,false");
  assert.equal(await page.evaluate('localStorage.getItem("frills:spotify:sharing")'), "0");
  assert.equal((await link()).searchParams.has("spotify"), false);
});

test("the login brings the person back to the Song requests editor when they started there, and to the test page otherwise", { skip }, async () => {
  const session = { verifier: "v".repeat(64), state: "st", at: Date.now() };
  await open("/songs/", { server: null });
  await page.evaluate('sessionStorage.setItem("frills:spotify:return", "/songs/")');
  await open("/spotify/callback/?code=abc&state=st", { server: null, session }, { fresh: false });
  await page.waitFor('location.pathname === "/songs/"', { timeout: 6000 });
  assert.equal(await page.evaluate('sessionStorage.getItem("frills:spotify:return")'), null, "the note is used once");
  await open("/spotify/callback/?code=abc&state=st", { server: null, session }, { fresh: false });
  await page.waitFor('location.pathname === "/spotify/"', { timeout: 6000 });
  await page.evaluate('sessionStorage.setItem("frills:spotify:return", "//evil.example/")');
  await open("/spotify/callback/?code=abc&state=st", { server: null, session }, { fresh: false });
  await page.waitFor('location.pathname === "/spotify/"', { timeout: 6000 });
});

test("the Spotify test page shows the song's title and time while it plays (the time display used to break)", { skip }, async () => {
  await open("/spotify/", { server: null, login: true });
  await page.waitFor(`document.getElementById("sp-title").textContent === "Without Me"`);
  assert.equal(await text("sp-time"), "0:10 / 3:45");
  await sleep(300);
  assert.deepEqual(problems(), [], problems().join(" | "));
});
