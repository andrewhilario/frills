// A small, polite suggestion for people who have not used Frills yet: "New here? Answer 6 quick questions" with a button to the Quick start.
// It is meant not to annoy:
//   - only on the home page, the overlays page and the guides (never on an editor, an overlay, the Quick start itself or the legal pages)
//   - not at once: after 15 seconds on the page, or when the visitor has read most of it, and never while they are typing
//   - a small card in the corner that covers nothing, takes no focus, needs no click to get past, and can be closed with a button or Escape
//   - at most once in a visit, at most twice in all, never again for 30 days once it has been closed, never again once the Quick start has been
//     opened, and never for someone who has already used an editor
// What the browser remembers is one small note (see MEMORY); nothing leaves the page.

export const KEY = "frills:quickstart-tip:v1";
export const PAGES = ["/", "/overlays/", "/guides/obs/", "/guides/setup/", "/guides/tiktok/", "/guides/test/", "/guides/alerts/"];
export const DELAY_MS = 15000;
export const QUIET_DAYS = 30;
export const MAX_SHOWS = 2;
/** The editors save these once someone has used them: a visitor who has one is not new here. */
export const USED = ["frills:editor:v1", "frills:matcha:v1", "frills:alerts:v1", "frills:gifts:v1", "frills:goal:editor:v1", "frills:likers:v1"];

/** The note in this browser: { shown: how many times it has appeared, closedAt: when it was closed (ms), done: the Quick start was opened }. */
export function readMemory(storage) {
  try {
    const note = JSON.parse(storage.getItem(KEY) ?? "null");
    return { shown: Number(note?.shown) || 0, closedAt: Number(note?.closedAt) || 0, done: note?.done === true };
  } catch {
    return { shown: 0, closedAt: 0, done: false };
  }
}
export function writeMemory(storage, change) {
  try { storage.setItem(KEY, JSON.stringify({ ...readMemory(storage), ...change })); } catch { /* storage can be blocked: then it simply is not remembered */ }
}
const usedAnEditor = (storage) => { try { return USED.some((key) => storage.getItem(key) !== null); } catch { return false; } };

/** Whether it may appear now. Everything it depends on is passed in, so this is tested without a page. */
export function mayShow({ path, memory, now, shownThisVisit, usedEditor }) {
  if (!PAGES.includes(path)) return false;
  if (shownThisVisit || usedEditor || memory.done) return false;
  if (memory.shown >= MAX_SHOWS) return false;
  if (memory.closedAt && now - memory.closedAt < QUIET_DAYS * 86400000) return false;
  return true;
}

function h(tag, props = {}, ...kids) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
}

export function initTip() {
  let local;
  let session;
  try { local = window.localStorage; session = window.sessionStorage; } catch { return; } // no storage: no way to be polite, so no suggestion
  const ask = () => mayShow({ path: location.pathname, memory: readMemory(local), now: Date.now(), shownThisVisit: session.getItem(KEY) === "1", usedEditor: usedAnEditor(local) });
  if (!ask() || window.innerHeight < 480) return;

  let timer = 0;
  let waited = 0;
  const trigger = () => {
    window.clearTimeout(timer); // (the timer and the scrolling can both ask: only one try at a time)
    if (!ask()) return stop();
    const typing = document.activeElement?.matches?.("input, textarea, select, [contenteditable]");
    if (document.hidden || typing) { if (waited++ < 6) timer = window.setTimeout(trigger, 5000); return; } // not now: try again in a moment, a few times at most
    stop();
    show();
  };
  const onScroll = () => {
    const page = document.documentElement;
    if ((window.scrollY + window.innerHeight) / page.scrollHeight >= 0.6) trigger();
  };
  const stop = () => { window.clearTimeout(timer); window.removeEventListener("scroll", onScroll); };
  timer = window.setTimeout(trigger, DELAY_MS);
  window.addEventListener("scroll", onScroll, { passive: true });

  function show() {
    session.setItem(KEY, "1");
    writeMemory(local, { shown: readMemory(local).shown + 1 });
    const close = h("button", { type: "button", className: "tip__close", textContent: "×" });
    close.setAttribute("aria-label", "Close this suggestion");
    const later = h("button", { type: "button", className: "btn btn--soft btn--sm", textContent: "Not now" });
    const go = h("a", { className: "btn btn--sm", href: "/start/", textContent: "Try the Quick start" });
    const card = h("aside", { className: "tip" },
      close,
      h("p", { className: "tip__title", textContent: "New here?" }),
      h("p", { className: "tip__text", textContent: "Answer 6 quick questions and get your overlay links in your own style. It takes about a minute." }),
      h("div", { className: "tip__row" }, go, later),
    );
    card.setAttribute("aria-label", "A suggestion");
    const dismiss = () => { writeMemory(local, { closedAt: Date.now() }); card.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape" && card.contains(document.activeElement)) dismiss(); };
    close.addEventListener("click", dismiss);
    later.addEventListener("click", dismiss);
    go.addEventListener("click", () => writeMemory(local, { done: true }));
    document.addEventListener("keydown", onKey);
    document.body.append(card);
  }
}
