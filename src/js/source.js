// "Where does chat come from": made-up practice messages until a real account is connected, TikTok first and Twitch beside it.
// Fills a container and wires it to one or more feeds.

import { PLATFORMS, cleanName, connectTo, statusText } from "./connect.js";
import { findTikTokSource, relayForPage } from "./tiktok.js";
import { fakeSource, testMessage } from "./fake.js";
import { chips } from "./ui.js";
import { PLATFORM_NAMES, noteFor, scoped } from "./both.js";
import { el } from "./feed.js";

const COPY = {
  tiktok: { label: "Your TikTok @name", bad: "TikTok names are letters, numbers, _ and . only.", max: 100 },
  twitch: { label: "Your Twitch channel", bad: "Channel names are letters, numbers and _ only.", max: 26 },
};
const NO_TIKTOK_RELAY = "The free Frills relay isn’t answering right now. Wait a minute and press Connect again.";
const NO_TIKTOK_HELPER = "TikTok chat needs the Frills helper running on this PC. It isn't answering here.";

/**
 * The "where does chat come from" control. `host` is an empty element. Options: feeds, pace (a function giving [min, max] ms between
 * practice messages), platform and channel (to start with), autoconnect, waitlistUrl (shown beside the helper note when set).
 */
export function mountSource(host, { feeds, pace, channel = "", twitch = "", platform = "tiktok", autoconnect = false, waitlistUrl = "", platforms = PLATFORMS, events: eventsOf = [], onAlert, onInfo, onFound, onState, tools: showTools = true, idleHint = "Until you connect, the preview shows made-up messages." } = {}) {
  const list = Array.isArray(feeds) ? feeds : [feeds];
  // "both": one chat that reads a TikTok account and a Twitch channel together (only where the page offers it, with platforms including "both")
  let current = PLATFORMS.includes(platform) || (platform === "both" && platforms.includes("both")) ? platform : "tiktok";
  const firstKey = () => (current === "both" ? "tiktok" : current); // the first box is TikTok's in "both"
  const usesTikTok = () => current === "tiktok" || current === "both";
  const values = { tiktok: "", twitch: "" };
  if (current === "both") { values.tiktok = channel; values.twitch = twitch; } else values[current] = channel;
  let practice = null;
  let conn = null;
  const relay = relayForPage(); // the site’s shared relay for TikTok, when it has one and this is the site itself
  let helper = null; // null until checked; then whether TikTok chat can come from somewhere (the helper on this PC, or the relay)
  let found = null; // where it can come from: { kind: "helper" | "relay", base }
  let turn = 0;
  let silence = 0; // the timer that says "nothing has arrived yet" // a click that is still waiting on the helper check gives way to a newer one
  const listeners = new Set();
  const changed = () => listeners.forEach((fn) => fn());
  // What the page waits for besides chat, in words ("follows", "gifts and likes"), so the status says that and not "chat".
  const eventsNow = () => (typeof eventsOf === "function" ? eventsOf() : eventsOf); // a page can change what it wants (the goal's type)
  const WORDS = { follow: "follows", gift: "gifts", share: "shares", like: "likes", sub: "subs", subgift: "gifted subs", bits: "bits", raid: "raids" };
  const wantsNow = () => {
    const names = eventsNow().map((kind) => WORDS[kind]).filter(Boolean);
    return names.length ? (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0]) : "";
  };

  const platformRow = el("div", { className: "chips" });
  platformRow.setAttribute("role", "group");
  platformRow.setAttribute("aria-label", "Where you stream");
  const label = el("label", { className: "ctl__label", htmlFor: "source-channel" });
  const input = el("input", { type: "text", id: "source-channel", placeholder: "yourname", autocomplete: "off", spellcheck: false, value: channel });
  input.setAttribute("autocapitalize", "none");
  input.setAttribute("aria-describedby", "source-status");
  const label2 = el("label", { className: "ctl__label", htmlFor: "source-channel-2", textContent: COPY.twitch.label });
  const input2 = el("input", { type: "text", id: "source-channel-2", placeholder: "yourchannel", autocomplete: "off", spellcheck: false, value: current === "both" ? twitch : "", maxLength: COPY.twitch.max });
  input2.setAttribute("autocapitalize", "none");
  const second = el("div", { className: "source__second" }, label2, el("div", { className: "source__row" }, input2));
  second.hidden = current !== "both";
  const go = el("button", { type: "button", className: "btn btn--soft btn--sm", textContent: "Connect" });
  const status = el("p", { className: "source__status", id: "source-status" });
  status.setAttribute("role", "status");
  const hint = el("p", { className: "source__hint", textContent: idleHint });
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
  const turns = new WeakMap(); // for each feed, a stand-in that gives the made-up messages to TikTok and Twitch in turn
  const alternating = (feed) => {
    if (!turns.has(feed)) {
      const a = scoped(feed, "tiktok");
      const b = scoped(feed, "twitch");
      let turn = 0;
      turns.set(feed, { add: (m) => (turn++ % 2 ? b : a).add(m), removeById() {}, removeUser() {}, clear: () => feed.clear() });
    }
    return turns.get(feed);
  };
  const practiceFeeds = () => (current === "both" ? list.map(alternating) : list);
  const startPractice = () => { if (!practice) practice = fakeSource(practiceFeeds(), pace); };
  const stopPractice = () => { practice?.stop(); practice = null; };
  const showHelperNote = () => {
    helperNote.hidden = !(usesTikTok() && helper === false && !relay); // with a relay there is no helper to talk about
    relayNote.hidden = !(usesTikTok() && found?.kind === "relay");
  };

  /** Asks the helper whether it is there. Asked again each time while the answer is no, so starting it later works without a reload. */
  async function ensureHelper() {
    if (helper === true) return true;
    found = await findTikTokSource(relay);
    helper = Boolean(found);
    showHelperNote();
    onFound?.(found);
    return helper;
  }

  function disconnect(message = "Disconnected") {
    turn += 1;
    clearTimeout(silence);
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
    if (current === "both") return connectBoth();
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
        setStatus("error", relay ? NO_TIKTOK_RELAY : NO_TIKTOK_HELPER);
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
    clearTimeout(silence);
    const events = eventsNow();
    const wants = wantsNow();
    let chatSeen = false;
    const seen = () => {
      chatSeen = true;
      clearTimeout(silence);
      if (current === "tiktok" && !pretend && status.dataset.state !== "error") setStatus("connected", statusText({ state: "reading", platform: current, channel: name, wants }));
    };
    let pretend = false; // the practice account says so itself, and keeps saying it
    let lost = false; // the connection dropped: when it comes back, its "connected" must be shown even though chat had been seen before
    conn = connectTo(list, current, name, (s) => {
      onState?.(s.state);
      if (s.state === "connected" && s.detail) pretend = true;
      if (s.state === "helper-lost" || s.state === "reconnecting") lost = true;
      if (s.state === "connected" && chatSeen && !lost) return; // already reading: a status repeat does not take that back
      if (s.state === "connected") lost = false;
      setStatus(s.state, statusText({ ...s, wants }));
      // TikTok can accept a connection to an account that is not LIVE, and then nothing ever arrives. After a while of nothing, say so.
      clearTimeout(silence);
      if (s.platform === "tiktok" && s.state === "connected" && !s.detail) {
        silence = setTimeout(() => { if (!chatSeen && conn) setStatus("silent", statusText({ state: "silent", wants })); }, 20000);
      }
      if (s.fatal) {
        fatal = true;
        disconnect(statusText({ ...s, wants }));
        setStatus("error", statusText({ ...s, wants }));
      }
    }, {
      relay,
      events,
      // TikTok says the room is LIVE: that is reading it, even before anyone says or does anything.
      onInfo: (info) => { if (info.live) seen(); onInfo?.(info); },
      // Anything arriving proves the account is LIVE and we are reading it: a follow or a like counts, not only a chat message.
      onAlert: onAlert && ((event) => { seen(); onAlert(event); }),
      onFirstMessage: seen,
    });
    if (fatal) conn = null;
  }

  /** Both chats at once: each connects on its own into the same feeds, marked as its own, and the status says which one is not ready yet. */
  async function connectBoth() {
    const tiktok = cleanName("tiktok", input.value);
    const twitch = cleanName("twitch", input2.value);
    input.toggleAttribute("aria-invalid", !tiktok);
    input2.toggleAttribute("aria-invalid", !twitch);
    if (!tiktok || !twitch) {
      setStatus("error", !tiktok ? COPY.tiktok.bad : COPY.twitch.bad);
      return;
    }
    const mine = ++turn;
    setStatus("connecting", "Looking for where TikTok chat can come from…");
    const there = await ensureHelper();
    if (mine !== turn) return;
    if (!there) {
      setStatus("error", relay ? NO_TIKTOK_RELAY : NO_TIKTOK_HELPER);
      return;
    }
    conn?.stop();
    stopPractice();
    list.forEach((f) => f.clear());
    burstBtn.hidden = true;
    hint.hidden = true;
    go.textContent = "Disconnect";
    const parts = {};
    let fatal = false;
    const report = () => {
      const problem = noteFor(parts, statusText);
      setStatus(problem ? "connecting" : "connected", problem || "Reading TikTok and Twitch chat. Their messages arrive here together.");
      onState?.(problem ? "connecting" : "connected");
    };
    const join = (platform, name) => connectTo(list.map((f) => scoped(f, platform)), platform, name, (s) => {
      parts[platform] = s;
      if (s.fatal) {
        fatal = true;
        disconnect(`${PLATFORM_NAMES[platform]}: ${statusText(s)}`);
        setStatus("error", `${PLATFORM_NAMES[platform]}: ${statusText(s)}`);
        return;
      }
      report();
    }, { relay, onInfo });
    const a = join("tiktok", tiktok);
    const b = join("twitch", twitch);
    conn = { stop() { a.stop(); b.stop(); } };
    if (fatal) conn = null;
  }

  function setPlatform(id) {
    if (id === current) return;
    if (conn) disconnect();
    const wasBoth = current === "both";
    if (current === "both") { values.tiktok = input.value; values.twitch = input2.value; } else values[current] = input.value;
    current = id;
    if (id === "both") { input.value = values.tiktok; input2.value = values.twitch; } else input.value = values[id];
    second.hidden = id !== "both";
    input.removeAttribute("aria-invalid");
    input2.removeAttribute("aria-invalid");
    label.textContent = COPY[firstKey()].label;
    input.maxLength = COPY[firstKey()].max;
    setStatus("idle", "");
    showHelperNote();
    stopPractice();
    if (wasBoth !== (id === "both")) list.forEach((f) => f.clear()); // (the old made-up messages have no platform icon, so they go)
    startPractice(); // (in "both" the made-up messages now take turns being TikTok's and Twitch's)
    if (usesTikTok() && helper !== true) ensureHelper();
    changed();
  }

  const platformChips = chips(
    platformRow,
    [{ id: "tiktok", name: "TikTok" }, { id: "twitch", name: "Twitch" }, { id: "both", name: "Both" }].filter((p) => platforms.includes(p.id)),
    current,
    (item) => setPlatform(item.id),
  );

  go.addEventListener("click", () => (conn ? disconnect() : connectNow()));
  input.addEventListener("keydown", (e) => e.key === "Enter" && (conn ? null : connectNow()));
  input.addEventListener("input", () => { input.removeAttribute("aria-invalid"); changed(); });
  input2.addEventListener("keydown", (e) => e.key === "Enter" && (conn ? null : connectNow()));
  input2.addEventListener("input", () => { input2.removeAttribute("aria-invalid"); changed(); });
  testBtn.addEventListener("click", () => practiceFeeds().forEach((f) => f.add(testMessage())));
  burstBtn.addEventListener("click", () => practice?.burst());

  label.textContent = COPY[firstKey()].label;
  input.maxLength = COPY[firstKey()].max;
  host.classList.add("source");
  if (platforms.length < 2) platformRow.hidden = true; // nothing to choose between
  host.append(platformRow, label, el("div", { className: "source__row" }, input, go), second, status, helperNote, relayNote, hint, ...(showTools ? [tools] : []));
  startPractice();
  if (usesTikTok()) ensureHelper();
  if (autoconnect && channel) connectNow();

  return {
    get connected() { return Boolean(conn); },
    get features() { return found?.features ?? null; }, // what the program we found can send (null until we have looked)
    get usesRelay() { return Boolean(relay); }, // TikTok chat comes from the site’s relay, so links work on any PC
    get platform() { return current; },
    get channel() { return input.value; },
    cleanChannel: () => cleanName(firstKey(), input.value),
    /** In "both": the two cleaned names ({ tiktok, twitch }, each "" until it is acceptable). */
    cleanChannels: () => ({ tiktok: cleanName("tiktok", input.value), twitch: cleanName("twitch", input2.value) }),
    get twitchChannel() { return input2.value; },
    onChange: (fn) => listeners.add(fn),
    setPlatform: (id) => { platformChips.set(id); setPlatform(id); },
    /** Connects again (for a page whose settings changed what it waits for). Does nothing when not connected. */
    restart: () => { if (conn) { disconnect(); connectNow(); } },
  };
}
