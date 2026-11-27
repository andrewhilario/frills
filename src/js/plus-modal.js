// Shared Frills Plus subscribe popup (<dialog class="plus-dlg">) used across editors (/outline/, /actions/, /tts/)
// whenever a non-subscriber clicks any Frills Plus-only control, style, upload, or limit.
// Zero inline styles (strict style-src 'self' CSP), native <dialog> focus & Escape handling, and never collides with dialog.size-dlg.

import { countPrompt } from "./stats.js";

let modal = null;

function buildModal() {
  if (modal) return modal;

  const dlg = document.createElement("dialog");
  dlg.className = "plus-dlg";
  dlg.id = "frills-plus-dlg";
  dlg.setAttribute("aria-labelledby", "frills-plus-dlg-title");

  const inner = document.createElement("div");
  inner.className = "size-dlg__inner";

  const head = document.createElement("div");
  head.className = "size-dlg__head";

  const headText = document.createElement("div");
  headText.className = "size-dlg__head-text";

  const pill = document.createElement("span");
  pill.className = "size-dlg__pill";
  pill.textContent = "Frills Plus";

  const titleEl = document.createElement("h2");
  titleEl.className = "size-dlg__title";
  titleEl.id = "frills-plus-dlg-title";

  headText.append(pill, titleEl);

  const closeX = document.createElement("button");
  closeX.type = "button";
  closeX.className = "size-dlg__close";
  closeX.id = "frills-plus-dlg-close";
  closeX.setAttribute("aria-label", "Close popup");
  closeX.textContent = "×";

  head.append(headText, closeX);

  const summaryEl = document.createElement("p");
  summaryEl.className = "size-dlg__note";

  const listEl = document.createElement("ul");
  listEl.className = "plus-dlg__list";

  const tipEl = document.createElement("p");
  tipEl.className = "size-dlg__tip";
  tipEl.id = "frills-plus-dlg-note";

  inner.append(head, summaryEl, listEl, tipEl);

  const foot = document.createElement("div");
  foot.className = "size-dlg__foot plus-dlg__foot";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn--soft btn--sm";
  cancelBtn.id = "frills-plus-dlg-cancel";
  cancelBtn.textContent = "Not now";

  const ctaLink = document.createElement("a");
  ctaLink.className = "btn btn--sm plus-dlg__cta";
  ctaLink.id = "frills-plus-dlg-cta";
  ctaLink.href = "/plus/";
  ctaLink.textContent = "Subscribe to Frills Plus →";

  foot.append(cancelBtn, ctaLink);
  dlg.append(inner, foot);
  document.body.append(dlg);

  const state = { moment: "", eligible: false };

  const close = () => {
    if (!dlg.open) return;
    if (typeof dlg.close === "function") dlg.close();
    else dlg.removeAttribute("open");
  };

  closeX.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) close();
  });
  ctaLink.addEventListener("click", () => {
    if (state.moment && document.body?.dataset?.plusAccounts === "on" && state.eligible) {
      countPrompt(state.moment, "clicked");
    }
  });

  modal = { dlg, titleEl, summaryEl, listEl, tipEl, ctaLink, close, state };
  return modal;
}

/**
 * Opens the centered Frills Plus subscribe popup for a locked Plus control.
 * Safe to call repeatedly; updates copy in place and focuses the primary CTA without scroll jump.
 */
export function openPlusModal({
  title = "Unlock this feature with Frills Plus",
  summary = "All core Frills overlays stay free with no account. Subscribe to Frills Plus ($5.99/mo) to unlock Plus extras right here.",
  perks = [],
  moment = "",
  eligible = true,
  checked = false,
} = {}) {
  const m = buildModal();
  m.titleEl.textContent = title;
  m.summaryEl.textContent = summary;

  m.listEl.replaceChildren();
  m.listEl.hidden = !perks.length;
  for (const item of perks) {
    const li = document.createElement("li");
    if (typeof item === "string") {
      li.textContent = item;
    } else if (item) {
      if (item.lead) {
        const strong = document.createElement("strong");
        strong.textContent = `${item.lead}: `;
        li.append(strong);
      }
      if (item.text) li.append(document.createTextNode(item.text));
    }
    m.listEl.append(li);
  }

  m.tipEl.replaceChildren("Already have Frills Plus? ");
  const signIn = document.createElement("a");
  signIn.href = "/account/";
  signIn.textContent = "Sign in on your account page";
  m.tipEl.append(signIn, " to unlock this right here.");
  if (checked && !eligible) {
    m.tipEl.append(" (Frills Plus checkout is rolling out by region.)");
  }

  m.state.moment = moment;
  m.state.eligible = Boolean(eligible);
  if (moment && document.body?.dataset?.plusAccounts === "on" && eligible) {
    countPrompt(moment, "shown");
  }

  if (!m.dlg.open) {
    if (typeof m.dlg.showModal === "function") m.dlg.showModal();
    else m.dlg.setAttribute("open", "");
    m.ctaLink.focus({ preventScroll: true });
  }
  return m.dlg;
}

/** Closes the Frills Plus subscribe popup if currently open. */
export function closePlusModal() {
  modal?.close();
}
