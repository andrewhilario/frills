// Small pieces of interface shared by the pages: a row of buttons where one is pressed, a copy button, the star-burst when something
// worked, and the controls the editor is built from.

import { el } from "./feed.js";

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A row of buttons where one is pressed. Returns { set(id) } to change the pressed one from code. */
export function chips(host, items, initial, onPick, { dot = false } = {}) {
  const buttons = new Map();
  const set = (id) => buttons.forEach((b, key) => b.setAttribute("aria-pressed", String(key === id)));
  for (const item of items) {
    const b = el("button", { type: "button", className: "chip" });
    if (dot) {
      const d = el("span", { className: "chip__dot" });
      d.setAttribute("aria-hidden", "true");
      d.style.background = item.dot;
      b.append(d);
    }
    if (item.svg) {
      const ico = el("span", { className: "chip__icon" });
      ico.innerHTML = item.svg; // one of our own icon strings, never chat text
      b.append(ico);
    }
    b.append(item.name);
    b.addEventListener("click", () => {
      set(item.id);
      onPick(item);
    });
    buttons.set(item.id, b);
    host.append(b);
  }
  set(initial);
  return { set };
}

/** A four-point star that bursts from the click point and fades. Fires once; skipped for people who asked for less motion. */
export function starBurst(x, y) {
  if (prefersReducedMotion()) return;
  const star = el("span", { className: "star-burst" });
  star.style.left = x + "px";
  star.style.top = y + "px";
  star.setAttribute("aria-hidden", "true");
  document.body.append(star);
  setTimeout(() => star.remove(), 460);
}

const CHECK = '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Copies text to the clipboard. Resolves true if it worked. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const box = el("textarea", { value: text });
    box.style.cssText = "position:fixed;opacity:0";
    document.body.append(box);
    box.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { /* blocked */ }
    box.remove();
    return ok;
  }
}

/**
 * Makes a button copy something. The label changes to "Copied" for a couple of seconds (no toast: the label is the feedback) and a
 * star bursts from the click. `getText` is read at click time, so the button can copy whatever is current.
 */
export function copyButton(button, getText, { label = "Copy link", done = "Copied", failed = "Copy was blocked", onResult = () => {} } = {}) {
  const text = el("span", { className: "btn__label", textContent: label });
  text.setAttribute("aria-live", "polite");
  button.replaceChildren(text);
  let timer = 0;
  button.addEventListener("click", async (event) => {
    const value = getText();
    if (!value) return;
    const ok = await copyText(value);
    onResult(ok);
    clearTimeout(timer);
    button.dataset.state = ok ? "copied" : "failed";
    text.innerHTML = ok ? `${CHECK}${done}` : failed;
    if (ok) {
      // A keyboard "click" has no pointer position, so the star bursts from the button itself.
      const box = button.getBoundingClientRect();
      starBurst(event.clientX || box.left + box.width / 2, event.clientY || box.top + box.height / 2);
    }
    timer = setTimeout(() => {
      delete button.dataset.state;
      text.textContent = label;
    }, 2500);
  });
}

/**
 * One control for the editor, from its entry in CONTROLS. `onSet(value)` runs when the person changes it. Returns the row and a
 * `write(value)` that puts a value in without firing onSet.
 */
export function buildControl(control, value, onSet, { id = "c-" + control.key } = {}) {
  const row = el("div", { className: "ctl" });
  const label = () => el("label", { className: "ctl__label", textContent: control.label, htmlFor: id });
  let write;
  if (control.type === "color") {
    const input = el("input", { type: "color", id });
    input.addEventListener("input", () => onSet(input.value));
    row.append(label(), input);
    write = (v) => { input.value = v; };
  } else if (control.type === "range") {
    const input = el("input", { type: "range", id, min: control.min, max: control.max, step: control.step });
    const out = el("output");
    const show = (v) => { out.textContent = v === 0 && control.zero ? control.zero : v + (control.unit ?? ""); };
    input.addEventListener("input", () => {
      show(Number(input.value));
      onSet(Number(input.value));
    });
    row.append(label(), out, input);
    write = (v) => { input.value = v; show(v); };
  } else if (control.type === "select") {
    const input = el("select", { id });
    for (const o of control.options) input.append(el("option", { value: o.id, textContent: o.name }));
    input.addEventListener("change", () => onSet(input.value));
    row.append(label(), input);
    write = (v) => { input.value = v; };
  } else if (control.type === "text") {
    row.classList.add("ctl--wide");
    const input = el("input", { type: "text", id, maxLength: control.max, autocomplete: "off", spellcheck: false });
    input.addEventListener("input", () => onSet(input.value));
    row.append(label(), input);
    write = (v) => { input.value = v; };
  } else if (control.type === "toggle") {
    const input = el("input", { type: "checkbox", id });
    input.setAttribute("role", "switch");
    input.addEventListener("change", () => onSet(input.checked));
    const knob = el("i");
    knob.setAttribute("aria-hidden", "true");
    row.append(label(), el("span", { className: "switch" }, input, knob));
    write = (v) => { input.checked = v; };
  } else {
    row.classList.add("ctl--wide");
    const box = el("div", { className: "chips" });
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", control.label);
    const group = chips(box, control.options, value, (o) => onSet(o.id));
    row.append(el("span", { className: "ctl__label", textContent: control.label }), box);
    write = (v) => group.set(v);
  }
  if (control.hint) row.append(el("small", { className: "ctl__hint", textContent: control.hint }));
  write(value);
  return { row, write };
}
