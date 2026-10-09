// "Where does chat come from": made-up practice messages until a real account is connected, TikTok first and Twitch beside it.
// Fills a container and wires it to one or more feeds.

import { PLATFORMS, cleanName, connectTo, statusText } from "./connect.js";
import { findTikTokSource, relayForPage } from "./tiktok.js";
import { fakeSource, testMessage } from "./fake.js";
import { chips } from "./ui.js";
import { el } from "./feed.js";

const COPY = {
  tiktok: { label: "Your TikTok @name", bad: "TikTok names are letters, numbers, _ and . only.", max: 100 },
  twitch: { label: "Your Twitch channel", bad: "Channel names are letters, numbers and _ only.", max: 26 },
};

/**
 * The "where does chat come from" control. `host` is an empty element. Options: feeds, pace (a function giving [min, max] ms between
 * practice messages), platform and channel (to start with), autoconnect, waitlistUrl (shown beside the helper note when set).
 */
export function mountSource(host, { feeds, pace, channel = "", platform = "tiktok", autoconnect = false, waitlistUrl = "" }) {
  const list = Array.isArray(feeds) ? feeds : [feeds];
  let current = PLATFORMS.includes(platform) ? platform : "tiktok";
  const values = { tiktok: "", twitch: "" };
  values[current] = channel;
  let practice = null;
  let conn = null;
  const relay = relayForPage(); // the site’s shared relay for TikTok, when it has one and this is the site itself
  let helper = null; // null until checked; then whether TikTok chat can come from somewhere (the helper on this PC, or the relay)
  let found = null; // where it can come from: { kind: "helper" | "relay", base }
  let turn = 0; // a click that is still waiting on the helper check gives way to a newer one
  const listeners = new Set();
  const changed = () => listeners.forEach((fn) => fn());

  const platformRow = el("div", { className: "chips" });
  platformRow.setAttribute("role", "group");
  platformRow.setAttribute("aria-label", "Where you stream");
  const label = el("label", { className: "ctl__label", htmlFor: "source-channel" });
  const input = el("input", { type: "text", id: "source-channel", placeholder: "yourname", autocomplete: "off", spellcheck: false, value: channel });
  input.setAttribute("autocapitalize", "none");
  input.setAttribute("aria-describedby", "source-status");
  const go = el("button", { type: "button", className: "btn btn--soft btn--sm", textContent: "Connect" });
  const status = el("p", { className: "source__status", id: "source-status" });
  status.setAttribute("role", "status");
  const hint = el("p", { className: "source__hint", textContent: "Until you connect, the preview shows made-up messages." });
  const helperNote = el("p", { className: "source__hint source__helper" }, "TikTok chat comes through the free Frills helper, a small program on your PC (in testing). It isn’t answering at this address, so open the editor from the helper. ");
  helperNote.append(el("a", { href: "/guides/tiktok/", textContent: "How to set it up" }));
  helperNote.append(".");
  helperNote.hidden = true;
  const relayNote = el("p", { className: "source__hint source__relay", textContent: "TikTok chat is coming through the free Frills relay (beta). When it is full you wait in line for a spot, and the line moves as people finish." });
  relayNote.hidden = true;
  if (waitlistUrl) helperNote.append(" ", el("a", { href: waitlistUrl, textContent: "Join the waitlist", rel: "noopener" }), ".");
  const testBtn = el("button", { type: "button", className: "btn btn--outline btn--sm", textContent: "Send a test message" });
  const burstBtn = el("button", { type: "button", className: "btn btn--outline btn--sm", textContent: "Try a busy chat" });
  const tools = el("div", { className: "source__tools" }, testBtn, burstBtn);

  const setStatus = (state, text) => {
    status.dataset.state = state;
    status.textContent = text;
  };
  const startPractice = () => { if (!practice) practice = fakeSource(list, pace); };
  const stopPractice = () => { practice?.stop(); practice = null; };
  const showHelperNote = () => {
    helperNote.hidden = !(current === "tiktok" && helper === false);
    relayNote.hidden = !(current === "tiktok" && found?.kind === "relay");
  };

  /** Asks the helper whether it is there. Asked again each time while the answer is no, so starting it later works without a reload. */
  async function ensureHelper() {
    if (helper === true) return true;
    found = await findTikTokSource(relay);
    helper = Boolean(found);
    showHelperNote();
    return helper;
  }

  function disconnect(message = "Disconnected") {
    turn += 1;
    conn?.stop();
    conn = null;
    go.textContent = "Connect";
    burstBtn.hidden = false;
    hint.hidden = false;
    setStatus("idle", message);
    list.forEach((f) => f.clear());
    startPractice();
  }

  async function connectNow() {
    const name = cleanName(current, input.value);
    if (!name) {
      input.setAttribute("aria-invalid", "true");
      setStatus("error", COPY[current].bad);
      return;
    }
    input.removeAttribute("aria-invalid");
    const mine = ++turn;
    if (current === "tiktok") {
      setStatus("connecting", "Looking for where TikTok chat can come from…");
      const there = await ensureHelper();
      if (mine !== turn) return; // the person changed their mind while we looked
      if (!there) {
        setStatus("error", "TikTok chat needs the Frills helper running on this PC. It isn't answering here.");
        return;
      }
    }
    conn?.stop();
    stopPractice();
    list.forEach((f) => f.clear());
    burstBtn.hidden = true;
    hint.hidden = true;
    go.textContent = "Disconnect";
    let fatal = false; // the connection gave up for good (Twitch refused the guest login, TikTok name not accepted)
    conn = connectTo(list, current, name, (s) => {
      setStatus(s.state, statusText(s));
      if (s.fatal) {
        fatal = true;
        disconnect(statusText(s));
        setStatus("error", statusText(s));
      }
    }, { relay });
    if (fatal) conn = null;
  }

  function setPlatform(id) {
    if (id === current) return;
    if (conn) disconnect();
    values[current] = input.value;
    current = id;
    input.value = values[id];
    input.removeAttribute("aria-invalid");
    label.textContent = COPY[id].label;
    input.maxLength = COPY[id].max;
    setStatus("idle", "");
    showHelperNote();
    if (id === "tiktok" && helper !== true) ensureHelper();
    changed();
  }

  const platformChips = chips(
    platformRow,
    [{ id: "tiktok", name: "TikTok" }, { id: "twitch", name: "Twitch" }],
    current,
    (item) => setPlatform(item.id),
  );

  go.addEventListener("click", () => (conn ? disconnect() : connectNow()));
  input.addEventListener("keydown", (e) => e.key === "Enter" && (conn ? null : connectNow()));
  input.addEventListener("input", () => { input.removeAttribute("aria-invalid"); changed(); });
  testBtn.addEventListener("click", () => list.forEach((f) => f.add(testMessage())));
  burstBtn.addEventListener("click", () => practice?.burst());

  label.textContent = COPY[current].label;
  input.maxLength = COPY[current].max;
  host.classList.add("source");
  host.append(platformRow, label, el("div", { className: "source__row" }, input, go), status, helperNote, relayNote, hint, tools);
  startPractice();
  if (current === "tiktok") ensureHelper();
  if (autoconnect && channel) connectNow();

  return {
    get connected() { return Boolean(conn); },
    get platform() { return current; },
    get channel() { return input.value; },
    cleanChannel: () => cleanName(current, input.value),
    onChange: (fn) => listeners.add(fn),
    setPlatform: (id) => { platformChips.set(id); setPlatform(id); },
  };
}
