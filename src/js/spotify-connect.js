// The "Connect Spotify" step of the Song requests editor: log in with Spotify, show the song that is playing on the stream, let chat's !sr songs go
// into the streamer's own Spotify queue, and try it with a pretend viewer.
//
// Frills keeps the Spotify login (worker/spotify.mjs), so all of this works with this page closed. The page logs in to Spotify as it always did (the
// PKCE login, no secret, in spotify.js), then hands the login over once ("Let Frills keep my login", or by itself right after Log in); from then
// on Frills' Worker asks Spotify what is playing and adds the songs, and the streaming app's overlay passes viewers' !sr and !next on
// (spotify-forward.js). This page only changes the two switches, shows what happened and disconnects. The login is removed from this browser as
// soon as Frills has it. Only the song's title, artist, cover and position reach the overlay.

import { CLIENT_ID_FORMAT, DENIED_FRILLS, DENIED_OWN, REDIRECT_PATH, SpotifyClient, ownClientId, saveOwnClientId } from "./spotify.js";
import { SpotifyServer } from "./spotify-server.js";
import { bridgeIdentity, rememberReturn, watchSpotify } from "./spotify-bridge.js";
import { buildControl } from "./ui.js";
import { SONGS, onScreenWords, parseCommand } from "./songs.js";

export const SHARING = "frills:spotify:sharing"; // "1" while Frills keeps this browser's Spotify login: the overlay link then carries the code
const KEEP = "frills:spotify:keep"; // in this tab, from pressing Log in until the login has been handed to Frills
const STEPS = "frills:spotify:steps"; // the steps of making an own Spotify app that the person ticked as done (a list of step numbers)
const get = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const put = (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage can be blocked; the choice lasts until the page closes */ } };

// A Spotify cover is drawn only from Spotify's own picture server.
const safeCover = (address) => (/^https:\/\/i\.scdn\.co\//.test(address) ? address : "");

const SHARE_ON = "Sharing. The song playing shows on your stream, even with this page closed.";
const SHARE_OFF = "Not sharing. Your stream shows only the songs viewers ask for.";
const QUEUE_ON = "On. A viewer's !sr song goes to the end of your Spotify queue, even with this page closed. This needs Spotify Premium, Spotify open on a device, and your song requests overlay open in your streaming app.";
const QUEUE_OFF = "Off. Songs viewers ask for only go to the list on your stream.";
const SEEN_FRESH_MS = 150000; // the overlay says hello every minute: not heard for two and a half is "not open"

/**
 * Sets up the step inside `root` (the section, with the ids spx-*). `hear(message)` gives a chat message to the on-screen queue and returns what it
 * did; `refresh()` makes the editor rebuild its link. Returns { handle(message), setSettings(settings), loggedIn }. (`handle` is kept for the editor's
 * sake and does nothing: the overlay passes chat on to Frills, not this page.)
 */
export function mountSpotify(root, { hear, refresh = () => {} } = {}) {
  const none = { handle() {}, setSettings() {}, loggedIn: () => false };
  const siteId = root?.dataset.client || "";
  if (!root || !siteId) return none; // no Spotify app on this site: the step stays hidden
  let clientId = ownClientId() || siteId; // the streamer's own Spotify app when they made one (the panel below), else Frills' own, which lets in only a few people
  root.hidden = false;
  const $ = (id) => document.getElementById("spx-" + id);
  const redirect = location.origin + REDIRECT_PATH;
  let client = new SpotifyClient({ clientId, redirectUri: redirect });
  const identity = bridgeIdentity();
  const server = new SpotifyServer({ code: identity.code, key: identity.key });
  const say = (el, text, bad = false) => { el.textContent = text; el.dataset.state = bad ? "error" : ""; };

  // ── the nine steps: the ones to do by hand can be ticked off (kept in this browser), the others tick themselves ─────────────────────────────────
  const ticked = () => { try { return new Set(JSON.parse(get(STEPS) ?? "[]").map(String)); } catch { return new Set(); } };
  const boxes = [...root.querySelectorAll("[data-done]")];
  for (const box of boxes) {
    box.addEventListener("change", () => {
      const now = ticked();
      box.checked ? now.add(box.dataset.done) : now.delete(box.dataset.done);
      put(STEPS, JSON.stringify([...now]));
      if (box.dataset.done === "6") $("steps").querySelector('[data-step="6"]').removeAttribute("data-flag");
      paintSteps();
    });
  }
  /** Ticks and the count: step 7 is done once a Client ID is kept, 8 once logged in, 9 once connected. */
  function paintSteps() {
    const by = ticked();
    if (ownClientId()) by.add("7");
    const finished = new Set(by);
    if (state.mode === "local" || state.mode === "connected" || state.mode === "expired") finished.add("8");
    if (state.mode === "connected") finished.add("9");
    for (const box of boxes) box.checked = by.has(box.dataset.done);
    for (const li of root.querySelectorAll("[data-step]")) li.dataset.finished = String(finished.has(li.dataset.step));
    $("progress").textContent = state.mode === "connected" ? "(all done)" : `(${finished.size} of 9 done)`;
  }
  /** Spotify turned the login away: say which app it was, point at the step to check, and open what is needed. */
  function denied() {
    const own = Boolean(ownClientId());
    say($("status"), own ? DENIED_OWN : DENIED_FRILLS, true);
    $("own").open = true;
    $("help").open = true;
    if (own) { // the step that fixes it, marked, and un-ticked so it can be done again
      const li = $("steps").querySelector('[data-step="6"]');
      li.dataset.flag = "check";
      const now = ticked();
      now.delete("6");
      put(STEPS, JSON.stringify([...now]));
      paintSteps();
      li.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }
  }

  // ── the streamer's own Spotify app: free, with them as its only user, so there is no list to be on ──────────────────────────────────────────────
  function paintOwn() {
    const own = ownClientId();
    $("own-redirect").textContent = redirect;
    $("own-id").value = own;
    $("own-back").hidden = !own;
    say($("own-status"), own ? `Using your own Spotify app (${own.slice(0, 6)}…). Now do step 6 if you have not, then step 8.` : "Using Frills' Spotify app, which lets in only a short list of people.");
    paintSteps();
  }
  function useOwn(id) {
    saveOwnClientId(id);
    clientId = ownClientId() || siteId;
    client.logout(); // a login made with the other app is no use to this one
    client = new SpotifyClient({ clientId, redirectUri: redirect });
    paintOwn();
    return load();
  }
  $("own-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const id = $("own-id").value.trim();
    if (!CLIENT_ID_FORMAT.test(id)) { say($("own-status"), "That does not look like a Client ID. It is 32 letters and numbers, and it is on the app's Settings page in the Spotify dashboard.", true); $("own-id").focus(); return; }
    useOwn(id);
  });
  $("own-back").addEventListener("click", () => useOwn(""));
  $("own-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(redirect); $("own-copy").textContent = "Copied"; } catch { $("own-copy").textContent = "Select it and copy"; }
  });

  let settings = SONGS.defaults;
  let state = { mode: "loading" }; // off | local | connected | expired | unavailable, as Frills last said
  let reader = null; // reads what is playing the way the overlay does, to show it here

  // ── what is playing, as the overlay sees it ────────────────────────────────────────────────────────────────────────────
  function paintSong(song) {
    const art = safeCover(song?.cover ?? "");
    if (art) { $("cover").src = art; $("cover").hidden = false; } else $("cover").hidden = true;
    if (!song?.title) {
      $("title").textContent = "Nothing is playing";
      $("artist").textContent = state.share === false ? "Sharing is off, so your stream does not show the song." : "Start a song in Spotify and it shows up here within a few seconds.";
    } else {
      $("title").textContent = song.title;
      $("artist").textContent = song.artist + (song.playing ? "" : " (paused)");
    }
  }

  // ── the two switches (kept by Frills, so they hold with this page closed) ────────────────────────────────────────────────
  const share = buildControl({ key: "spShare", type: "toggle", label: "Show what is playing on my stream" }, true, async (on) => {
    const done = await server.settings({ share: on });
    if (!done.ok) { say($("share-note"), done.message, true); share.write(!on); return; }
    state.share = on;
    say($("share-note"), on ? SHARE_ON : SHARE_OFF);
  });
  const queue = buildControl({ key: "spQueue", type: "toggle", label: "Add songs my viewers ask for to my Spotify queue" }, false, async (on) => {
    const done = await server.settings({ queue: on });
    if (!done.ok) { say($("queue-note"), done.message, true); queue.write(!on); return; }
    state.queue = on;
    say($("queue-note"), on ? QUEUE_ON : QUEUE_OFF);
    paintOverlay();
  });
  share.row.append($("share-note")); // each switch says what it did right under itself
  queue.row.append($("queue-note"));
  $("switches").append(share.row, queue.row);

  // ── what happened, and trying it with a pretend viewer ─────────────────────────────────────────────────────────────────
  const log = $("log");
  const seen = new Set(); // entries Frills wrote down that are already listed
  const line = (stateName, text) => {
    const li = document.createElement("li");
    li.dataset.state = stateName;
    li.textContent = text;
    log.prepend(li);
    while (log.children.length > 20) log.lastElementChild.remove();
  };
  const entry = (e) => {
    const id = `${e.at}|${e.text}`;
    if (seen.has(id)) return;
    seen.add(id);
    line(e.state, e.text);
  };
  const entries = (list) => { for (const e of [...(list ?? [])].reverse()) entry(e); }; // Frills lists the newest first

  const nameBox = buildControl({ key: "spName", type: "text", label: "Viewer name", max: 30 }, "Pretend viewer", () => {}, { id: "spx-try-name" });
  const textBox = buildControl({ key: "spText", type: "text", label: "What the viewer types", max: 120, hint: "For example !sr levitating dua lipa. Type !next to skip, as yourself." }, "", () => {}, { id: "spx-try-text" });
  $("viewer-fields").append(nameBox.row, textBox.row);
  $("try").addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = $("try-text").value.trim();
    if (!text) return;
    const name = $("try-name").value.trim() || "Pretend viewer";
    const command = parseCommand(text, settings);
    const message = { id: "", user: "try-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, text, mod: false, host: command?.kind === "next" };
    const words = onScreenWords(hear(message));
    if (words) line("info", words);
    $("try-text").value = "";
    if (state.mode !== "connected" || !(command?.kind === "request" || command?.kind === "next")) return;
    const done = command.kind === "next" ? await server.next({ name }) : await server.request({ query: command.query, name });
    if (done.entry) entry(done.entry);
    else line(done.ok ? "info" : "error", done.message ?? "Nothing happened.");
  });

  // ── what to show for each state ────────────────────────────────────────────────────────────────────────────────────────
  function render() {
    const { mode } = state;
    const kept = mode === "connected" || mode === "expired";
    $("login").hidden = !(mode === "off" || mode === "expired");
    $("login").disabled = false;
    $("keep").hidden = mode !== "local";
    $("keep").disabled = false;
    $("logout").hidden = !(kept || mode === "local");
    $("on").hidden = mode !== "connected";
    $("keep-note").hidden = !(mode === "off" || mode === "expired" || mode === "local");
    if (mode === "off") say($("status"), "Not connected. Spotify asks you to say yes on its own page, and Frills never sees your password.");
    if (mode === "local") say($("status"), "You are logged in to Spotify in this browser, but Frills is not keeping the login yet.");
    if (mode === "expired") say($("status"), "Your Spotify login ran out. Press Log in with Spotify again.", true);
    if (mode === "unavailable") say($("status"), state.message, true);
    paintSteps();
    if (mode === "connected") {
      say($("status"), `Connected to Spotify as ${state.name || "your account"}. Frills keeps your login, so you can close this page.`);
      share.write(state.share);
      queue.write(state.queue);
      say($("share-note"), state.share ? SHARE_ON : SHARE_OFF);
      say($("queue-note"), state.queue ? QUEUE_ON : QUEUE_OFF);
      entries(state.log);
      paintOverlay();
      if (!reader) reader = watchSpotify(identity.code, paintSong);
    } else {
      reader?.stop();
      reader = null;
      paintOverlay();
    }
    // the overlay link carries the code while Frills keeps a login for it: the overlay needs it to read the song and to pass requests on
    const was = get(SHARING) === "1";
    put(SHARING, kept ? "1" : "0");
    if (was !== kept) refresh();
  }

  /** What Frills says about this browser's login, as a state to show. */
  function normalize(answer) {
    if (!answer.ok) return { mode: "unavailable", message: answer.message };
    if (!answer.connected) return { mode: client.loggedIn ? "local" : "off" };
    return { mode: answer.state === "ok" ? "connected" : "expired", name: answer.name, share: answer.share, queue: answer.queue, log: answer.log, overlayAt: answer.overlayAt, now: answer.now };
  }

  /** Is the song requests overlay open with Spotify in its link? Frills notes when it last said hello; this says it in words, and what to check when it is not. */
  function paintOverlay() {
    const note = $("overlay-note");
    if (state.mode !== "connected") { note.textContent = ""; return; }
    const age = state.overlayAt && state.now ? state.now - state.overlayAt : Infinity;
    if (age < SEEN_FRESH_MS) {
      note.dataset.state = "ok";
      note.textContent = state.queue ? "Your song requests overlay is open in your streaming app. Viewers’ !sr can reach your Spotify queue." : "Your song requests overlay is open in your streaming app. Switch on adding to your Spotify queue (above) to let viewers’ !sr reach it.";
    } else {
      note.dataset.state = "error";
      note.textContent = "Frills cannot see your song requests overlay with Spotify in its link, so viewers’ !sr cannot reach your Spotify. Check: (1) the overlay is open in your streaming app and visible there (if it has been open for a long time, refresh the browser source once); (2) its link was copied after you connected Spotify: copy your link again in step 5 and paste it into the app in place of the old one.";
    }
  }

  async function load() {
    state = normalize(await server.status());
    render();
  }

  // Every few seconds: new lines for the log, and a change of state (the login ran out, or was disconnected somewhere else).
  setInterval(async () => {
    if (state.mode !== "connected" && state.mode !== "expired") return;
    const next = normalize(await server.status());
    if (next.mode !== state.mode) { state = next; render(); } else if (next.mode === "connected") {
      state.overlayAt = next.overlayAt;
      state.now = next.now;
      entries(next.log);
      paintOverlay();
    }
  }, 5000);

  // ── logging in, handing the login to Frills, and disconnecting ──────────────────────────────────────────────────────────
  async function keepLogin() {
    const login = client.tokens;
    if (!login?.refresh) { client.logout(); await load(); say($("status"), "There is no Spotify login in this browser to give to Frills. Press Log in with Spotify.", true); return; }
    $("keep").disabled = true;
    say($("status"), "Giving your login to Frills…");
    const done = await server.keep({ clientId, refresh: login.refresh, access: login.access, expires: login.expires });
    if (done.ok) client.logout(); // Frills has it: this browser does not need to
    else if (done.error === "not_allowed" || done.error === "bad_login") client.logout(); // Spotify will not accept it, so it is no use to anyone
    await load();
    if (done.error === "not_allowed") denied(); // Spotify turned this person away: say which app it was, and show what to check
    else if (!done.ok) say($("status"), done.message, true);
  }

  $("login").addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    rememberReturn("/songs/"); // the callback page brings the person back here
    try { sessionStorage.setItem(KEEP, "1"); } catch { /* the person presses the button that keeps the login instead */ }
    location.assign(await client.begin());
  });
  $("keep").addEventListener("click", keepLogin);
  $("logout").addEventListener("click", async () => {
    $("logout").disabled = true;
    const done = await server.disconnect();
    if (!done.ok) { $("logout").disabled = false; say($("status"), done.message, true); return; }
    client.logout();
    await load();
  });

  // Back from Spotify's page after Log in: the login is in this browser now, and the person already agreed to Frills keeping it, so it is handed over.
  let justLoggedIn = false;
  try { justLoggedIn = sessionStorage.getItem(KEEP) === "1"; sessionStorage.removeItem(KEEP); } catch { /* nothing remembered */ }
  paintOwn();
  load().then(() => {
    if (state.mode !== "connected" && state.mode !== "expired") $("own").open = true; // not connected yet: the steps are open to follow
    if (justLoggedIn && state.mode === "local") return keepLogin();
  });

  return { handle() {}, setSettings(next) { settings = next; }, loggedIn: () => state.mode === "connected" };
}
