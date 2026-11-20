// Shared Twitch follower auth + EventSub watcher + follow-bridge widget used by editors that support Twitch follows
// (Alerts and Rotating Highlights). Binds to #tw-status, #tw-login-btn, #tw-logout-btn, #tw-test-follower, #follows-on,
// #follows-state, and reads data-client / data-ticker from #main.

import { FollowPublisher, FollowReader, followIdentity, followsOn, setFollowsOn } from "./follow-bridge.js";
import { FollowWatcher, REDIRECT_PATH, beginLogin, clearLogin, loadLogin, validate } from "./twitch-follows.js";

const $ = (id) => document.getElementById(id);

function startClock(tickerJs, fn, every) {
  try {
    if (tickerJs) {
      const worker = new Worker(tickerJs);
      worker.onmessage = fn;
      worker.postMessage({ every });
      return { stop: () => worker.terminate() };
    }
  } catch {}
  const id = setInterval(fn, every);
  return { stop: () => clearInterval(id) };
}

/**
 * Wires the Twitch follows bridge box in an editor.
 * `getPlatform()` returns `"tiktok"` or `"twitch"`.
 * `onFollow(event, { fromWatcher })` receives `{ kind: "follow", id, user, name, avatar: "" }` when a new or test follower arrives.
 * `onChanged()` is called whenever the checkbox state changes and the copied link may need updating.
 */
export function mountFollowBox({ getPlatform, onFollow, onChanged } = {}) {
  const mainEl = $("main");
  const clientId = mainEl?.dataset?.client || "";
  const tickerJs = mainEl?.dataset?.ticker || "";
  const redirectUri = location.origin + REDIRECT_PATH;

  const twStatus = $("tw-status");
  const twLoginBtn = $("tw-login-btn");
  const twLogoutBtn = $("tw-logout-btn");
  const twTestFollowerBtn = $("tw-test-follower");
  const followsBox = $("follows-on");
  const followsNote = $("follows-state");

  const identity = followIdentity();
  let lastError = 0;
  const publisher = new FollowPublisher({
    code: identity.code,
    key: identity.key,
    onError: (status) => { lastError = status; },
  });

  let watcher = null;
  let watcherClock = null;
  let followsTimer = 0;
  let followReader = null;
  const seenFollowIds = new Set();

  function stopWatcher() {
    watcher?.stop();
    watcher = null;
    watcherClock?.stop();
    watcherClock = null;
  }

  function deliver(follow, fromWatcher) {
    if (follow.id && seenFollowIds.has(follow.id)) return;
    if (follow.id) seenFollowIds.add(follow.id);
    onFollow?.({ kind: "follow", id: follow.id, user: follow.user, name: follow.name, avatar: "" }, { fromWatcher });
  }

  async function onTwitchFollow(follow) {
    await publisher.send(follow);
    deliver(follow, true);
  }

  function onWatcherStatus(s) {
    if (!followsNote) return;
    if (s.state === "listening") {
      followsNote.textContent = "The Twitch follows page is running, so new followers will show up in your overlay.";
      followsNote.dataset.state = "";
    } else if (s.state === "expired") {
      followsNote.textContent = "Your Twitch login has ended. Log in again.";
      followsNote.dataset.state = "error";
      stopWatcher();
      clearLogin();
      syncTwitchAuth();
    } else if (s.state === "error") {
      followsNote.textContent = s.detail || "Could not connect to Twitch.";
      followsNote.dataset.state = "error";
    }
  }

  async function startWatcher(login) {
    if (watcher || !clientId) return;
    watcher = new FollowWatcher({
      token: login.token,
      clientId,
      userId: login.userId,
      onFollow: onTwitchFollow,
      onStatus: onWatcherStatus,
    });
    watcher.start();
    publisher.ping();
    watcherClock = startClock(tickerJs, async () => {
      publisher.ping();
      if (Date.now() - (login.checkedAt ?? 0) > 3600 * 1000) {
        login.checkedAt = Date.now();
        const who = await validate(login.token);
        if (who.expired) onWatcherStatus({ state: "expired", detail: who.error });
      }
    }, 30000);
  }

  async function syncTwitchAuth() {
    if (!twStatus) return;
    const login = loadLogin();
    if (!login) {
      twStatus.textContent = clientId ? "Not logged in with Twitch." : "This site has no Twitch app set up yet.";
      twStatus.dataset.state = "";
      if (twLoginBtn) { twLoginBtn.hidden = false; twLoginBtn.disabled = !clientId; }
      if (twLogoutBtn) twLogoutBtn.hidden = true;
      if (twTestFollowerBtn) twTestFollowerBtn.hidden = true;
      stopWatcher();
      return;
    }
    twStatus.textContent = `Logged in as @${login.login}.`;
    twStatus.dataset.state = "";
    if (twLoginBtn) twLoginBtn.hidden = true;
    if (twLogoutBtn) twLogoutBtn.hidden = false;
    if (twTestFollowerBtn) twTestFollowerBtn.hidden = false;

    if (followsBox && !followsBox.checked) {
      followsBox.checked = true;
      setFollowsOn(true);
      onChanged?.();
    }

    const who = await validate(login.token);
    if (who.expired) {
      clearLogin();
      syncTwitchAuth();
      twStatus.textContent = who.error || "The Twitch login has ended. Log in again.";
      twStatus.dataset.state = "error";
      return;
    }

    if (getPlatform?.() === "twitch") startWatcher(login);
  }

  async function checkFollows() {
    clearTimeout(followsTimer);
    if (!followsNote) return;
    if (getPlatform?.() !== "twitch" || !followsBox?.checked) { followsNote.textContent = ""; return; }
    const login = loadLogin();
    if (login && watcher) {
      followsNote.textContent = "The Twitch follows page is running, so new followers will show up in your overlay.";
      followsNote.dataset.state = "";
      followsTimer = setTimeout(checkFollows, 10000);
      return;
    }
    try {
      const res = await fetch("/api/follows/" + identity.code, { cache: "no-store" });
      const data = await res.json();
      const alive = data.updatedAt > 0 && data.now - data.updatedAt < 180000;
      followsNote.textContent = alive
        ? "The Twitch follows page is running, so new followers will show up in your overlay."
        : "The Twitch follows page is not running. Open it, log in, and keep it open while you stream.";
      followsNote.dataset.state = "";
    } catch {
      followsNote.textContent = "";
    }
    followsTimer = setTimeout(checkFollows, 10000);
  }

  function syncFollowReader() {
    followReader?.stop();
    followReader = null;
    if (getPlatform?.() !== "twitch" || !followsBox?.checked) return;
    followReader = new FollowReader({
      code: identity.code,
      onFollow: (f) => deliver(f, false),
    }).start();
  }

  if (followsBox) followsBox.checked = followsOn();

  twLoginBtn?.addEventListener("click", () => {
    if (!clientId) return;
    twLoginBtn.disabled = true;
    try { sessionStorage.setItem("frills:twitch:return", location.pathname + location.search); } catch {}
    location.assign(beginLogin({ clientId, redirectUri }));
  });

  twLogoutBtn?.addEventListener("click", () => {
    stopWatcher();
    clearLogin();
    syncTwitchAuth();
    checkFollows();
  });

  twTestFollowerBtn?.addEventListener("click", async () => {
    const testFollow = { id: `test-${Date.now()}`, user: "frills_test", name: "Frills Test" };
    const sent = await publisher.send(testFollow);
    deliver(testFollow, true);
    if (followsNote) {
      followsNote.textContent = sent
        ? "Test follower sent! It pops up here in the preview and in your live overlay."
        : "Sent to preview. (Could not reach bridge server: " + lastError + ")";
      followsNote.dataset.state = "";
    }
  });

  followsBox?.addEventListener("change", () => {
    setFollowsOn(followsBox.checked);
    onChanged?.();
    checkFollows();
    syncFollowReader();
  });

  function sync() {
    if (getPlatform?.() === "twitch") syncTwitchAuth();
    else stopWatcher();
    checkFollows();
    syncFollowReader();
  }

  return {
    sync,
    codeFor: (platform) => (platform === "twitch" && followsOn() ? identity.code : ""),
    stop() {
      stopWatcher();
      clearTimeout(followsTimer);
      followReader?.stop();
      followReader = null;
    },
  };
}
