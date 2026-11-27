// Shared OBS-style Simple / Advanced setup switcher for every Frills overlay editor.
// - Defaults to "simple" (Quick setup): shows only Starting Looks + 2–5 essential controls + Connect + Copy link.
// - "advanced" unlocks every color, font, spacing, animation, sound, and fine-tuning control.
// - Persisted across all editors in localStorage (`frills:editor-mode:v1`) with zero server calls.

const MODE_STORE_KEY = "frills:editor-mode:v1";

/** Essential controls that remain visible in Simple (Quick setup) mode for each editor kind. */
export const SIMPLE_KEYS = Object.freeze({
  chat: ["deco"],
  alerts: ["card"],
  outline: ["mode", "layout9", "layout16", "boxAspect", "sideMode", "widgetSlotLabel", "frameStyle", "matMode", "artPack", "handle"],
  jar: ["design", "jarSize", "goalBy", "target"],
  goal: ["type", "barStyle", "target", "label"],
  wheel: ["design", "items", "triggerBy", "minDiamonds", "minBits"],
  gifts: ["max", "minDiamonds"],
  likers: ["layout", "max", "period"],
  gifters: ["layout", "max", "period", "twitchMode"],
  labels: ["layout", "rotateSec"],
  gallery: ["mode", "layout", "rotateSec"],
  counter: ["layout", "showViewers", "showLikes"],
  timer: ["layout", "startMinutes", "giftRules", "perDiamonds"],
  songs: ["show", "layout", "command"],
  tts: ["pet", "engine", "voice", "trigger", "command"],
  actions: [],
});

export function readEditorMode() {
  try {
    const saved = localStorage.getItem(MODE_STORE_KEY);
    return saved === "advanced" ? "advanced" : "simple";
  } catch {
    return "simple";
  }
}

function saveEditorMode(mode) {
  try {
    localStorage.setItem(MODE_STORE_KEY, mode);
  } catch { /* storage blocked */ }
}

/**
 * Mounts the Simple / Advanced segmented switch near the top of `.panel`, applies `data-editor-mode`
 * on `document.body`, and returns `{ mode(), setMode(m), markControls(entries), addAdvancePrompt(anchor) }`.
 */
export function mountEditorMode({ kind = "", panel = document.querySelector(".panel"), onChange = null } = {}) {
  let current = readEditorMode();
  const simpleSet = new Set(SIMPLE_KEYS[kind] ?? []);

  const bar = document.createElement("div");
  bar.className = "ed-mode";
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Setup mode");

  const tabs = document.createElement("div");
  tabs.className = "ed-mode__tabs";
  tabs.setAttribute("role", "group");
  tabs.setAttribute("aria-label", "Choose Simple or Advanced setup");

  const btnSimple = document.createElement("button");
  btnSimple.type = "button";
  btnSimple.className = "ed-mode__btn";
  btnSimple.dataset.mode = "simple";
  btnSimple.textContent = "Simple setup";

  const btnAdv = document.createElement("button");
  btnAdv.type = "button";
  btnAdv.className = "ed-mode__btn";
  btnAdv.dataset.mode = "advanced";
  btnAdv.textContent = "Advanced";

  tabs.append(btnSimple, btnAdv);

  const hint = document.createElement("p");
  hint.className = "ed-mode__hint";

  bar.append(tabs, hint);

  if (panel) {
    const intro = panel.querySelector(".panel__intro");
    const watch = panel.querySelector(".watch");
    const anchor = watch || intro;
    if (anchor) anchor.insertAdjacentElement("afterend", bar);
    else panel.prepend(bar);
  }

  const sync = () => {
    document.body.dataset.editorMode = current;
    btnSimple.setAttribute("aria-pressed", String(current === "simple"));
    btnAdv.setAttribute("aria-pressed", String(current === "advanced"));
    hint.textContent = current === "simple"
      ? "Quick setup: pick a look, adjust the essentials, and copy your link. Switch to Advanced anytime for every color, font & slider."
      : "Showing all colors, fonts, animations, and fine-tuning controls.";
    onChange?.(current);
  };

  const setMode = (next) => {
    const clean = next === "advanced" ? "advanced" : "simple";
    if (clean === current) return;
    current = clean;
    saveEditorMode(current);
    sync();
  };

  btnSimple.addEventListener("click", () => setMode("simple"));
  btnAdv.addEventListener("click", () => setMode("advanced"));
  sync();

  /** Tags non-essential control rows with `.ed-adv` so Simple mode hides them cleanly via CSS. */
  const markControls = (rows) => {
    for (const item of rows) {
      const key = item?.control?.key ?? item?.key;
      const row = item?.row;
      if (!row || !key) continue;
      row.classList.toggle("ed-adv", !simpleSet.has(key));
    }
  };

  /** Places an inline "Colors, fonts & more →" shortcut inside a step card (visible in Simple mode only). */
  const addAdvancePrompt = (host, label = "Colors, fonts & more →") => {
    if (!host) return null;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn--soft btn--sm ed-adv-link";
    btn.textContent = label;
    btn.addEventListener("click", () => setMode("advanced"));
    host.insertAdjacentElement("afterend", btn);
    return btn;
  };

  return {
    mode: () => current,
    isSimple: () => current === "simple",
    isEssentialKey: (key) => simpleSet.has(key),
    setMode,
    markControls,
    addAdvancePrompt,
  };
}
