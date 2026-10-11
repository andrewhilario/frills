// The private Spotify test page (/spotify/) and the page Spotify sends the person back to (/spotify/callback/). Nothing here is public: the
// pages are not listed, and nothing is sent anywhere but Spotify. The login stays in this browser only.

import { REDIRECT_PATH, SpotifyClient } from "./spotify.js";
import { SpotifyRequests } from "./spotify-requests.js";
import { cleanName, connectTo, statusText } from "./connect.js";
import { relayForPage } from "./tiktok.js";
import { Publisher, bridgeIdentity } from "./spotify-bridge.js";

const root = document.getElementById("spotify");
const $ = (id) => document.getElementById(id);
const status = $("sp-status");
const clientId = root.dataset.client || "";
const client = new SpotifyClient({ clientId, redirectUri: location.origin + REDIRECT_PATH });
const say = (el, text, bad = false) => { el.textContent = text; el.dataset.state = bad ? "error" : ""; };
const clock = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

// A Spotify cover is drawn only from Spotify's own picture server.
const safeCover = (address) => (/^https:\/\/i\.scdn\.co\//.test(address) ? address : "");

async function callback() {
  if (!clientId) return say(status, "This site has no Spotify app set up yet.", true);
  const result = await client.finish(location.search);
  if (result.error) return say(status, result.error, true);
  say(status, "Connected. Taking you back…");
  history.replaceState(null, "", REDIRECT_PATH); // the code in the address is used once and is not kept
  setTimeout(() => location.replace("/spotify/"), 600);
}

function main() {
  const loginBtn = $("sp-login-btn");
  const logoutBtn = $("sp-logout-btn");
  const nowCard = $("sp-now-card");
  const findCard = $("sp-find-card");
  const chatCard = $("sp-chat-card");
  const shareCard = $("sp-share-card");
  let timer = 0;
  let listening = null; // the connection to the chat, while it is on

  const facts = () => {
    const t = client.tokens;
    const rows = [
      ["Spotify app (Client ID)", clientId ? clientId.slice(0, 6) + "…" : "not set"],
      ["Redirect address to register", location.origin + REDIRECT_PATH],
      ["Logged in", client.loggedIn ? "yes" : "no"],
      ["Login ends in", t?.expires ? `${Math.max(0, Math.round((t.expires - Date.now()) / 60000))} min (it renews by itself)` : "-"],
      ["Allowed to", t?.scope || "-"],
      ["Last call", client.last ? `${client.last.method} ${client.last.path} -> ${client.last.status}` : "-"],
    ];
    $("sp-facts").replaceChildren(...rows.flatMap(([k, v]) => {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = k;
      dd.textContent = v;
      return [dt, dd];
    }));
  };

  // ── passing what is playing to the overlay ──────────────────────────────────────────────────────────────────────────────
  const identity = bridgeIdentity();
  const publisher = new Publisher({ code: identity.code, key: identity.key, onError: (status) => say($("sp-share-note"), status === 0 ? "Could not reach Frills to share the song. It will try again." : `Frills could not take the song (error ${status}). It will try again.`, true) });
  const sharing = () => $("sp-sharing").checked;
  function publish(now) {
    if (!sharing() || now.error) return;
    publisher.send(now.title ? { playing: now.playing, title: now.title, artist: now.artist, cover: now.cover, progressMs: now.progressMs, durationMs: now.durationMs } : { playing: false, title: "", artist: "", cover: "", progressMs: 0, durationMs: 0 });
  }
  function showLink() {
    const on = sharing();
    $("sp-link-box").hidden = !on;
    try { localStorage.setItem("frills:spotify:sharing", on ? "1" : "0"); } catch { /* storage can be blocked */ }
    if (!on) { say($("sp-share-note"), "Not sharing."); return; }
    const channel = cleanName("tiktok", channelInput.value);
    $("sp-link").value = `${location.origin}/overlay/songs/?channel=${channel || "yourname"}&platform=tiktok&spotify=${identity.code}`;
    say($("sp-share-note"), "Sharing. Add the link below to your stream.");
    publisher.sent = null; // send the current song at once
  }
  try { $("sp-sharing").checked = localStorage.getItem("frills:spotify:sharing") === "1"; } catch { /* storage can be blocked */ }
  $("sp-sharing").addEventListener("change", showLink);
  $("sp-link").addEventListener("focus", (event) => event.target.select());

  async function refreshNow() {
    if (document.hidden) return;
    const now = await client.nowPlaying();
    publish(now);
    const note = $("sp-now-note");
    if (now.error) { say(note, now.error, true); facts(); return; }
    say(note, "");
    const cover = $("sp-cover");
    const art = safeCover(now.cover ?? "");
    if (art) { cover.src = art; cover.hidden = false; } else cover.hidden = true;
    if (now.playing === false && !now.title) {
      $("sp-title").textContent = "Nothing is playing";
      $("sp-artist").textContent = "Start a song in Spotify and it shows up here within a few seconds.";
      $("sp-time").textContent = "";
      $("sp-bar").style.width = "0";
    } else {
      $("sp-title").textContent = now.title;
      $("sp-artist").textContent = now.artist + (now.playing ? "" : " (paused)");
      $("sp-time").textContent = `${clock(now.progressMs)} / ${clock(now.durationMs)}`;
      $("sp-bar").style.width = now.durationMs ? Math.min(100, (now.progressMs / now.durationMs) * 100).toFixed(1) + "%" : "0";
    }
    facts();
  }

  async function show() {
    const on = client.loggedIn;
    loginBtn.hidden = on;
    logoutBtn.hidden = !on;
    nowCard.hidden = !on;
    findCard.hidden = !on;
    chatCard.hidden = !on;
    shareCard.hidden = !on;
    clearInterval(timer);
    if (!clientId) { say(status, "This site has no Spotify app set up yet.", true); facts(); return; }
    if (!on) { say(status, "Not logged in. Press the button and say yes on Spotify's page."); facts(); return; }
    const me = await client.me();
    if (me.error) say(status, me.error, true); else say(status, `Logged in as ${me.name || "your Spotify account"}.`);
    await refreshNow();
    timer = setInterval(refreshNow, 3000);
  }

  loginBtn.addEventListener("click", async () => {
    if (!clientId) return;
    loginBtn.disabled = true;
    location.assign(await client.begin());
  });
  logoutBtn.addEventListener("click", () => { client.logout(); show(); });

  $("sp-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const note = $("sp-find-note");
    const list = $("sp-results");
    say(note, "Searching…");
    const found = await client.search($("sp-q").value);
    list.replaceChildren();
    if (found.error) { say(note, found.error, true); facts(); return; }
    say(note, found.results.length ? "" : "Nothing found. Try the song and the artist.");
    for (const song of found.results) {
      const li = document.createElement("li");
      li.className = "spotify__result";
      const art = safeCover(song.cover);
      if (art) {
        const img = document.createElement("img");
        img.src = art;
        img.alt = "";
        img.width = 48;
        img.height = 48;
        li.append(img);
      }
      const words = document.createElement("span");
      words.textContent = `${song.title} · ${song.artist}`;
      const add = document.createElement("button");
      add.type = "button";
      add.className = "btn btn--soft btn--sm";
      add.textContent = "Add to queue";
      add.addEventListener("click", async () => {
        add.disabled = true;
        const result = await client.addToQueue(song.uri);
        say(note, result.error ?? `Added “${song.title}” to your Spotify queue. Skip to it in Spotify to hear it.`, Boolean(result.error));
        add.disabled = false;
        facts();
      });
      li.append(words, add);
      list.append(li);
    }
    facts();
  });

  // ── song requests from chat, into the Spotify queue ───────────────────────────────────────────────────────────────────
  const log = $("sp-log");
  const channelInput = $("sp-channel");
  try { channelInput.value = localStorage.getItem("frills:spotify:channel") ?? ""; } catch { /* storage can be blocked */ }
  const requests = new SpotifyRequests(client, {
    onLog: ({ state, text }) => {
      const li = document.createElement("li");
      li.dataset.state = state;
      li.textContent = text;
      log.prepend(li);
      while (log.children.length > 30) log.lastElementChild.remove();
    },
  });
  $("sp-real").addEventListener("change", (event) => { requests.real = event.target.checked; });
  const handle = (message) => requests.handle({ ...message, login: message.login ?? "" });

  $("sp-chat-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const note = $("sp-chat-note");
    const button = $("sp-listen");
    if (listening) { listening.stop(); listening = null; button.textContent = "Start listening"; say(note, "Stopped."); return; }
    const name = cleanName("tiktok", channelInput.value);
    if (!name) { say(note, "Type your TikTok name first.", true); return; }
    try { localStorage.setItem("frills:spotify:channel", name); } catch { /* storage can be blocked */ }
    requests.channel = name;
    button.textContent = "Stop listening";
    const feed = { add: (message) => { handle(message); }, removeById() {}, removeUser() {}, clear() {} };
    listening = connectTo([feed], "tiktok", name, (state) => say(note, statusText({ ...state })), { relay: relayForPage() });
  });

  $("sp-fake-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("sp-fake");
    const text = input.value.trim();
    if (!text) return;
    requests.channel = cleanName("tiktok", channelInput.value) || "you";
    // typed here, so it is the streamer's own message: "!next" works too
    handle({ id: "", user: "pretend-" + Date.now(), name: "Pretend viewer", text, host: ["!next", "!skip"].some((word) => text.trimStart().toLowerCase().startsWith(word)), mod: false });
    input.value = "";
  });

  channelInput.addEventListener("input", () => { if (sharing()) showLink(); });
  if (sharing()) showLink();
  show();
}

if (root.dataset.callback) callback(); else main();
