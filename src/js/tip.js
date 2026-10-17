// A small, quiet suggestion for people who have not tried the Quick start: "New here? Get your overlay links in 6 quick questions". It is meant to be
// seen without being in the way:
//   - it fades in a moment after the page has loaded, in the corner, as two small lines of text (nothing dimmed, nothing in the middle)
//   - only on the home page, the overlays page and the guides (never on an editor, an overlay, the Quick start itself or the legal pages)
//   - it takes no focus, covers nothing, and closes with a button, "Not now" or Escape
//   - at most once in a visit, at most twice in all, never again for 30 days once it has been closed, and never again once the Quick start has
//     been opened from it
// The browser remembers one small note (see KEY); nothing leaves the page.
// To look at it whatever is remembered, open one of those pages with ?tip=show: it appears at once and writes nothing down.

export const KEY = "frills:quickstart-tip:v1";
export const PAGES = ["/", "/overlays/", "/guides/obs/", "/guides/setup/", "/guides/tiktok/", "/guides/test/", "/guides/alerts/"];
export const DELAY_MS = 1200; // after the page has loaded
export const QUIET_DAYS = 30;
export const MAX_SHOWS = 2;

/** The note in this browser: { shown: how many times it has appeared, closedAt: when it was closed (ms), done: the Quick start was opened from it }. */
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

/** Whether it may appear now. Everything it depends on is passed in, so this is tested without a page. */
export function mayShow({ path, memory, now, shownThisVisit }) {
  if (!PAGES.includes(path)) return false;
  if (shownThisVisit || memory.done) return false;
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
  const preview = new URLSearchParams(location.search).get("tip") === "show" && PAGES.includes(location.pathname);
  const ask = () => mayShow({ path: location.pathname, memory: readMemory(local), now: Date.now(), shownThisVisit: session.getItem(KEY) === "1" });
  if (!preview && (!ask() || window.innerHeight < 420)) return;

  let tries = 0;
  const trigger = () => {
    if (!preview && !ask()) return;
    const typing = document.activeElement?.matches?.("input, textarea, select, [contenteditable]");
    if (document.hidden || typing) { if (tries++ < 6) window.setTimeout(trigger, 3000); return; } // not now: try again in a moment, a few times at most
    show();
  };
  const start = () => window.setTimeout(trigger, preview ? 0 : DELAY_MS);
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });

  function show() {
    if (!preview) {
      session.setItem(KEY, "1");
      writeMemory(local, { shown: readMemory(local).shown + 1 });
    }
    const close = h("button", { type: "button", className: "tip__close", textContent: "×" });
    close.setAttribute("aria-label", "Close this suggestion");
    const go = h("a", { className: "tip__go", href: "/start/", textContent: "Try the Quick start" });
    go.append(h("span", { textContent: " →" }));
    const later = h("button", { type: "button", className: "tip__later", textContent: "Not now" });
    const card = h("aside", { className: "tip" },
      close,
      h("p", { className: "tip__text" }, h("strong", { textContent: "New here? " }), "Get your overlay links in 6 quick questions."),
      h("div", { className: "tip__row" }, go, later),
    );
    card.setAttribute("aria-label", "A suggestion");
    const dismiss = () => { if (!preview) writeMemory(local, { closedAt: Date.now() }); card.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape" && card.contains(document.activeElement)) dismiss(); };
    close.addEventListener("click", dismiss);
    later.addEventListener("click", dismiss);
    go.addEventListener("click", () => { if (!preview) writeMemory(local, { done: true }); });
    document.addEventListener("keydown", onKey);
    document.body.append(card);
  }
}
