// The private Twitch follows page (/twitch/) and the page Twitch sends the person back to (/twitch/callback/). Nothing here is public: the pages are
// not listed. The Twitch login stays in this browser; only each new follower's name goes to Frills (the post box), so the alerts overlay can show it.

import { FollowWatcher, REDIRECT_PATH, beginLogin, clearLogin, finishLogin, loadLogin, saveLogin, validate } from "./twitch-follows.js";
import { FollowPublisher, followIdentity } from "./follow-bridge.js";

const root = document.getElementById("twitch");
const $ = (id) => document.getElementById(id);
const clientId = root.dataset.client || "";
const redirectUri = location.origin + REDIRECT_PATH;
const say = (el, text, bad = false) => { el.textContent = text; el.dataset.state = bad ? "error" : ""; };

async function callback() {
  const status = $("tw-status");
  if (!clientId) return say(status, "This site has no Twitch app set up yet.", true);
  const result = finishLogin(location.hash, location.search);
  history.replaceState(null, "", REDIRECT_PATH); // the login in the address is used once and is not left there
  if (result.error) return say(status, result.error, true);
  const who = await validate(result.token);
  if (who.error) return say(status, who.error, true);
  if (!who.scopes.includes("moderator:read:followers")) return say(status, "Twitch did not allow seeing your followers. Try again and say yes to that.", true);
  if (who.clientId !== clientId) return say(status, "That login belongs to a different app, so it was ignored.", true);
  saveLogin({ token: result.token, login: who.login, userId: who.userId, savedAt: Date.now() });
  say(status, "Connected. Taking you back…");
  setTimeout(() => location.replace("/twitch/"), 600);
}

function main() {
  const loginBtn = $("tw-login-btn");
  const logoutBtn = $("tw-logout-btn");
  const listenCard = $("tw-listen-card");
  const identity = followIdentity();
  const publisher = new FollowPublisher({ code: identity.code, key: identity.key });
  let watcher = null;
  let clock = null;
  let login = loadLogin();
  let state = { state: "idle", detail: "" };
  let last = null; // the last thing sent to the post box
  const recent = [];

  /** A clock from a worker, which browsers do not slow down in a background tab; the page's own timer is the fallback. */
  function startClock(fn, every) {
    try {
      const worker = new Worker(root.dataset.ticker);
      worker.onmessage = fn;
      worker.postMessage({ every });
      return { stop: () => worker.terminate() };
    } catch {
      const id = setInterval(fn, every);
      return { stop: () => clearInterval(id) };
    }
  }

  function facts() {
    const rows = [
      ["Twitch app (Client ID)", clientId ? clientId.slice(0, 6) + "…" : "not set"],
      ["Redirect address to register", redirectUri],
      ["Logged in as", login?.login || "-"],
      ["Allowed to", login ? "see who follows your channel" : "-"],
      ["Listening", state.state],
      ["Last sent to your alerts", last ?? "-"],
    ];
    $("tw-facts").replaceChildren(...rows.flatMap(([k, v]) => {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = k;
      dd.textContent = v;
      return [dt, dd];
    }));
  }

  function drawRecent() {
    $("tw-recent").replaceChildren(...recent.map((r) => { const li = document.createElement("li"); li.textContent = `${r.name} followed at ${r.when}`; return li; }));
  }

  const words = {
    connecting: "Connecting to Twitch…",
    listening: "Listening. A new follower will show up here and in your alerts.",
    reconnecting: "Lost the connection to Twitch. Trying again by itself…",
    expired: "The Twitch login has ended. Log in again.",
    error: "Something went wrong.",
    stopped: "Stopped.",
  };

  function onStatus(s) {
    state = s;
    say($("tw-listen-status"), s.detail && s.state !== "listening" ? s.detail : words[s.state] ?? "", s.state === "expired" || s.state === "error");
    if (s.state === "expired") { stopListening(); clearLogin(); login = null; show(); say($("tw-status"), s.detail || words.expired, true); }
    facts();
  }

  async function onFollow(follow) {
    recent.unshift({ name: follow.name, when: new Date().toLocaleTimeString() });
    recent.length = Math.min(recent.length, 8);
    drawRecent();
    const sent = await publisher.send(follow);
    last = `${follow.name} (${sent ? "sent" : "waiting to be sent"})`;
    facts();
  }

  function stopListening() {
    watcher?.stop();
    watcher = null;
    clock?.stop();
    clock = null;
  }

  async function startListening() {
    stopListening();
    watcher = new FollowWatcher({ token: login.token, clientId, userId: login.userId, onFollow, onStatus });
    watcher.start();
    publisher.ping();
    clock = startClock(async () => {
      publisher.ping(); // "still here", so the alerts editor can tell something is listening
      if (Date.now() - (login.checkedAt ?? 0) > 3600 * 1000) { // Twitch asks apps to check the login once an hour
        login.checkedAt = Date.now();
        const who = await validate(login.token);
        if (who.expired) onStatus({ state: "expired", detail: who.error });
      }
    }, 30000);
  }

  async function show() {
    const on = Boolean(login);
    loginBtn.hidden = on;
    logoutBtn.hidden = !on;
    listenCard.hidden = !on;
    if (!on) {
      say($("tw-status"), clientId ? "Not logged in." : "This site has no Twitch app set up yet.", !clientId);
      loginBtn.disabled = !clientId;
      facts();
      return;
    }
    say($("tw-status"), `Logged in as ${login.login}.`);
    facts();
    const who = await validate(login.token);
    if (who.expired) { clearLogin(); login = null; return show().then(() => say($("tw-status"), who.error, true)); }
    if (who.error) say($("tw-status"), `Logged in as ${login.login}. ${who.error}`, true);
    startListening();
    return undefined;
  }

  loginBtn.addEventListener("click", () => {
    if (!clientId) return;
    loginBtn.disabled = true;
    location.assign(beginLogin({ clientId, redirectUri }));
  });
  logoutBtn.addEventListener("click", () => { stopListening(); clearLogin(); login = null; show(); });
  $("tw-test").addEventListener("click", async () => {
    const note = $("tw-test-note");
    const sent = await publisher.send({ id: `test-${Date.now()}`, user: "frills_test", name: "Frills Test" });
    say(note, sent ? "Sent. Look at your alerts overlay (or the preview in the alerts editor)." : "Could not send it. Try again in a moment.", !sent);
  });
  show();
}

if (root.dataset.callback === "1") callback();
else main();
