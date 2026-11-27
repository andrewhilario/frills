// Shared Overlay Width & Size Setup Guide popup (<dialog>) + visible size bar for every Frills editor.
// Solves the #1 streamer setup mistake: pasting a Frills link into OBS (default 800x600) or TikTok LIVE Studio
// (default tiny box) without setting the right Width x Height.
// - Visible live dimension badge + "Size guide" button right in the final Copy-link step.
// - Automatically pops up a clear <dialog> guide right after copying a link (with a "Don't auto-open" option).
// - Zero inline styles (strict CSP), 100% client-side, native <dialog> focus & Escape handling.

const QUIET_KEY = "frills:size-guide:quiet:v1";
let dlgSeq = 0;

const CANVAS_SIZES = {
  vertical: { width: 1080, height: 1920, label: "Vertical 9:16 (TikTok LIVE)" },
  landscape: { width: 1920, height: 1080, label: "Landscape 16:9 (OBS / Twitch)" },
  square: { width: 1080, height: 1080, label: "Square 1:1" },
};

const CHAT_PRESETS = [
  { id: "narrow", label: "Compact", width: 360, height: 700 },
  { id: "standard", label: "Standard", width: 440, height: 800 },
  { id: "wide", label: "Wide", width: 560, height: 900 },
];

function isQuiet() {
  try { return localStorage.getItem(QUIET_KEY) === "1"; } catch { return false; }
}

function setQuiet(on) {
  try {
    if (on) localStorage.setItem(QUIET_KEY, "1");
    else localStorage.removeItem(QUIET_KEY);
  } catch { /* storage blocked */ }
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "className") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("aria-") || k.startsWith("data-") || k === "role" || k === "for") node.setAttribute(k, String(v));
    else node[k] = v;
  }
  for (const child of children) {
    if (child != null) node.append(child);
  }
  return node;
}

/**
 * Mounts:
 * 1) A clearly visible recommended Width x Height callout bar + "How to set size" button inside `.linkfield`.
 * 2) A native `<dialog>` popup that opens automatically when the user copies their link (unless silenced) or clicks the button.
 *
 * Options:
 * - `mode`: `"chat"` | `"scene"` | `"outline"`
 * - `anchor`: the `.linkfield` container
 * - `copyBtn`: the `#copy-link` button (optional)
 * - `getSize`: `() => ({ width, height, label?, canvas?, appHint? })`
 * - `onPreset`: optional `(preset) => void` when user picks a quick size preset inside the modal
 */
export function mountSizeGuide({ mode = "scene", anchor, copyBtn = null, getSize, onPreset = null } = {}) {
  if (!anchor || typeof getSize !== "function") return { sync() {}, open() {} };

  const actions = anchor.querySelector(".linkfield__actions");
  let activeApp = "tiktok";

  // ── 1. Always-visible Size Callout Bar inside the Copy-link step ──────────────────────────────────────────────
  const bar = el("div", { className: "size-bar", role: "note", "aria-label": "Recommended overlay size" });
  const barMeta = el("div", { className: "size-bar__meta" });
  const barKicker = el("span", { className: "size-bar__kicker", text: "Browser source size" });
  const barValue = el("strong", { className: "size-bar__value" });
  barMeta.append(barKicker, barValue);

  const openBtn = el("button", {
    type: "button",
    className: "btn btn--soft btn--sm size-bar__btn",
    text: "Size guide",
  });
  bar.append(barMeta, openBtn);

  if (actions) actions.insertAdjacentElement("beforebegin", bar);
  else anchor.append(bar);

  // ── 2. Native <dialog> Popup Modal ────────────────────────────────────────────────────────────────────────────
  const titleId = `size-dlg-title-${++dlgSeq}`;
  const dlg = el("dialog", { className: "size-dlg", "aria-labelledby": titleId });
  const inner = el("div", { className: "size-dlg__inner" });

  const head = el("div", { className: "size-dlg__head" });
  const headText = el("div", { className: "size-dlg__head-text" });
  const statusPill = el("span", { className: "size-dlg__pill", text: "Overlay size guide" });
  const titleEl = el("h2", { className: "size-dlg__title", id: titleId, text: "Set your overlay width & height" });
  headText.append(statusPill, titleEl);

  const closeX = el("button", {
    type: "button",
    className: "size-dlg__close",
    "aria-label": "Close size guide",
    text: "×",
  });
  head.append(headText, closeX);

  // Two large tabular-nums dimension boxes: WIDTH & HEIGHT
  const dims = el("div", { className: "size-dlg__dims" });
  const wCard = el("div", { className: "size-dlg__dim" });
  const wVal = el("strong", { className: "size-dlg__num" });
  wCard.append(el("span", { className: "size-dlg__dim-lbl", text: "Width" }), wVal);

  const times = el("span", { className: "size-dlg__times", "aria-hidden": "true", text: "×" });

  const hCard = el("div", { className: "size-dlg__dim" });
  const hVal = el("strong", { className: "size-dlg__num" });
  hCard.append(el("span", { className: "size-dlg__dim-lbl", text: "Height" }), hVal);
  dims.append(wCard, times, hCard);

  const noteEl = el("p", { className: "size-dlg__note" });

  // Optional quick size presets (Chat widths OR Scene vertical/landscape/square)
  const presetsWrap = el("div", { className: "size-dlg__presets", role: "group", "aria-label": "Quick size presets" });
  const presetBtns = [];
  if (mode === "chat") {
    for (const p of CHAT_PRESETS) {
      const b = el("button", { type: "button", className: "chip size-dlg__preset", text: `${p.label} (${p.width}px)` });
      b.dataset.presetId = p.id;
      b.dataset.width = String(p.width);
      b.addEventListener("click", () => {
        onPreset?.(p);
        render();
      });
      presetBtns.push(b);
      presetsWrap.append(b);
    }
  } else if (mode === "scene") {
    for (const [id, info] of Object.entries(CANVAS_SIZES)) {
      const short = id === "vertical" ? "Vertical 9:16" : id === "landscape" ? "Landscape 16:9" : "Square 1:1";
      const b = el("button", { type: "button", className: "chip size-dlg__preset", text: short });
      b.dataset.presetId = id;
      b.addEventListener("click", () => {
        onPreset?.({ id, ...info });
        render();
      });
      presetBtns.push(b);
      presetsWrap.append(b);
    }
  }

  // App tabs: TikTok LIVE Studio vs OBS / Streamlabs
  const appTabs = el("div", { className: "size-dlg__tabs", role: "tablist", "aria-label": "Choose your streaming app" });
  const tabTikTok = el("button", { type: "button", className: "size-dlg__tab", role: "tab", text: "TikTok Studio" });
  const tabObs = el("button", { type: "button", className: "size-dlg__tab", role: "tab", text: "OBS / Streamlabs" });
  appTabs.append(tabTikTok, tabObs);

  const stepsList = el("ol", { className: "size-dlg__steps" });
  const tipBox = el("p", { className: "size-dlg__tip" });

  const foot = el("div", { className: "size-dlg__foot" });
  const quietLabel = el("label", { className: "size-dlg__quiet" });
  const quietCheck = el("input", { type: "checkbox" });
  quietCheck.checked = isQuiet();
  quietCheck.addEventListener("change", () => setQuiet(quietCheck.checked));
  quietLabel.append(quietCheck, " Don’t pop up after copying");

  const doneBtn = el("button", { type: "button", className: "btn btn--sm size-dlg__done", text: "Got it" });
  foot.append(quietLabel, doneBtn);

  inner.append(head, dims, noteEl);
  if (presetBtns.length) inner.append(presetsWrap);
  inner.append(appTabs, stepsList, tipBox);
  dlg.append(inner, foot);
  document.body.append(dlg);

  const buildStep = (strongLead, rest) => {
    const li = el("li");
    li.append(el("strong", { text: strongLead }), rest);
    return li;
  };

  function render() {
    const info = getSize() || { width: 1080, height: 1920 };
    const w = Math.round(Number(info.width) || 1080);
    const h = Math.round(Number(info.height) || 1920);
    barValue.textContent = `${w} × ${h} px`;
    wVal.textContent = `${w} px`;
    hVal.textContent = `${h} px`;

    if (mode === "chat") {
      noteEl.textContent = "Set Width directly inside your Browser / Link source Properties — the chat overlay automatically populates and wraps to whatever width you enter (no need to stretch the corners).";
      for (const b of presetBtns) {
        b.setAttribute("aria-pressed", String(Number(b.dataset.width) === w));
      }
    } else if (mode === "outline") {
      noteEl.textContent = info.label
        ? `Matched to your ${info.label} outline. Set Width and Height right inside your source’s Properties — it automatically populates the frame to fit so the cutouts line up cleanly.`
        : "Set Width and Height right inside your source’s Properties — the outline automatically populates to fit so your cutouts line up cleanly.";
    } else {
      noteEl.textContent = "Set Width and Height right inside your source’s Properties — the overlay automatically populates to match your stream canvas. Everything outside the widget stays transparent.";
      for (const b of presetBtns) {
        b.setAttribute("aria-pressed", String(b.dataset.presetId === (info.canvas || "vertical")));
      }
    }

    tabTikTok.setAttribute("aria-selected", String(activeApp === "tiktok"));
    tabObs.setAttribute("aria-selected", String(activeApp === "obs"));

    stepsList.replaceChildren();
    if (activeApp === "tiktok") {
      stepsList.append(
        buildStep("Add a Link source: ", "Click Add Source → Link (called Browser or Web page in some versions) and paste your copied link."),
        buildStep(`Set Width ${w} × Height ${h} in Properties: `, "Open the source’s Properties / Size fields and type these numbers — the overlay automatically populates to fit the width you set."),
        mode === "chat"
          ? buildStep("Change width anytime in Properties: ", "Want wider or narrower bubbles later? Just update Width inside Properties and chat automatically refills the new width.")
          : buildStep("Fill the whole scene: ", "If LIVE Studio spawns the link as a tiny box in the corner, resize it to cover your full canvas. The background is see-through."),
      );
      tipBox.textContent = "Tip: You can change Width inside the source’s Properties anytime and Frills automatically populates to fit it — avoid dragging corners to stretch.";
    } else {
      stepsList.append(
        buildStep("Add a Browser source: ", "In Sources, click + → Browser, give it a name, and paste your link into URL."),
        buildStep(`Set Width ${w} and Height ${h} in Properties: `, "OBS defaults to 800 × 600 — type these numbers right inside Properties and the overlay automatically populates to match."),
        mode === "chat"
          ? buildStep("Change width inside Properties (don’t stretch): ", "Adjust Properties → Width anytime to make chat wider or narrower; it automatically reflows without blurring text.")
          : buildStep("Keep it live across scenes: ", "Leave Shutdown source and Refresh browser unticked so your counters, jars, and alerts stay active when switching scenes."),
      );
      tipBox.textContent = "Tip: Set Width directly in Browser source Properties and Frills automatically populates it. Right-click → Transform → Fit to Screen if off-center.";
    }
  }

  tabTikTok.addEventListener("click", () => { activeApp = "tiktok"; render(); });
  tabObs.addEventListener("click", () => { activeApp = "obs"; render(); });

  function open({ copied = false } = {}) {
    const info = getSize() || {};
    if (info.appHint === "obs" || info.canvas === "landscape") activeApp = "obs";
    else if (info.appHint === "tiktok" || info.canvas === "vertical") activeApp = "tiktok";
    statusPill.textContent = copied ? "Link copied — next step" : "Overlay size guide";
    statusPill.dataset.state = copied ? "copied" : "info";
    titleEl.textContent = copied ? "Set this width & height in your app" : "Set your overlay width & height";
    quietCheck.checked = isQuiet();
    render();
    if (!dlg.open) {
      if (typeof dlg.showModal === "function") dlg.showModal();
      else dlg.setAttribute("open", "");
      doneBtn.focus({ preventScroll: true });
    }
  }

  function close() {
    if (dlg.open) {
      if (typeof dlg.close === "function") dlg.close();
      else dlg.removeAttribute("open");
    }
  }

  openBtn.addEventListener("click", () => open({ copied: false }));
  closeX.addEventListener("click", close);
  doneBtn.addEventListener("click", close);
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) close();
  });

  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      if (copyBtn.disabled || isQuiet()) return;
      // Let copyButton() execute clipboard write with the active user gesture first, then show the popup cleanly.
      setTimeout(() => open({ copied: true }), 80);
    });
  }

  render();
  return { sync: render, open, close, dialog: dlg };
}
