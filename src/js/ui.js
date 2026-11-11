// Small pieces of interface shared by the pages: a row of buttons where one is pressed, a copy button, the star-burst when something
// worked, and the controls the editor is built from.

import { el } from "./feed.js";
import { initAnnouncement } from "./nav.js";
import { countCopy } from "./stats.js";
import { activeSeason } from "./season.js";
import { pairsText, parsePairs } from "./widget-settings.js";

initAnnouncement();

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A row of buttons where one is pressed. Returns { set(id) } to change the pressed one from code. */
export function chips(host, items, initial, onPick, { dot = false } = {}) {
  const buttons = new Map();
  const set = (id) => buttons.forEach((b, key) => b.setAttribute("aria-pressed", String(key === id)));
  for (const item of items) {
    const b = el("button", { type: "button", className: "chip" });
    if (item.season) { // a look or pack of the season: marked, so it reads as the festive one
      b.classList.add("chip--season");
      b.dataset.season = item.season;
    }
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
      countCopy(value); // (an anonymous count: which editor the link was copied from, and for which platform)
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
  } else if (control.type === "number") {
    const input = el("input", { type: "number", id, min: control.min, max: control.max, step: 1, inputMode: "numeric" });
    input.addEventListener("input", () => { if (input.value !== "") onSet(Number(input.value)); });
    row.append(label(), input);
    write = (v) => { input.value = String(v); };
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
  } else if (control.type === "pairs") {
    // A list: one row for each gift (or whatever the pairs are), a name to pick or type and a time, with a button to add another.
    row.classList.add("ctl--wide");
    const list = el("div", { className: "pairs" });
    const names = el("datalist", { id: id + "-names" });
    for (const name of control.suggest ?? []) names.append(el("option", { value: name }));
    const rows = [];
    const emit = () => onSet(pairsText(rows.map((r) => ({ name: r.name.value, seconds: Number(r.amount.value || 0) * (r.unit.value === "min" ? 60 : 1) }))));
    const addRow = (name = "", seconds = 10, focus = false) => {
      const r = { name: el("input", { type: "text", className: "pairs__name", maxLength: 40, placeholder: control.namePlaceholder, autocomplete: "off", spellcheck: false }), amount: el("input", { type: "number", className: "pairs__amount", min: 0, step: 1, inputMode: "numeric" }), unit: el("select", { className: "pairs__unit" }) };
      r.name.setAttribute("list", id + "-names");
      r.name.setAttribute("aria-label", control.label + ": name");
      r.amount.setAttribute("aria-label", control.label + ": time");
      r.unit.setAttribute("aria-label", control.label + ": unit");
      r.unit.append(el("option", { value: "sec", textContent: "seconds" }), el("option", { value: "min", textContent: "minutes" }));
      const minutes = seconds >= 60 && seconds % 60 === 0;
      r.name.value = name;
      r.amount.value = String(minutes ? seconds / 60 : seconds);
      r.unit.value = minutes ? "min" : "sec";
      const remove = el("button", { type: "button", className: "pairs__remove", textContent: "×" });
      remove.setAttribute("aria-label", "Remove this row");
      r.node = el("div", { className: "pairs__row" }, r.name, r.amount, r.unit, remove);
      for (const input of [r.name, r.amount]) input.addEventListener("input", emit);
      r.unit.addEventListener("change", emit);
      remove.addEventListener("click", () => { rows.splice(rows.indexOf(r), 1); r.node.remove(); emit(); });
      rows.push(r);
      list.append(r.node);
      if (focus) r.name.focus();
    };
    const add = el("button", { type: "button", className: "btn btn--soft btn--sm pairs__add", textContent: "+ Add a gift" });
    add.addEventListener("click", () => { addRow("", 10, true); emit(); });
    row.append(el("span", { className: "ctl__label", textContent: control.label }), list, add, names);
    write = (v) => {
      // only when the text is not already what the rows say: rebuilding while someone types would take the cursor away
      const now = pairsText(rows.map((r) => ({ name: r.name.value, seconds: Number(r.amount.value || 0) * (r.unit.value === "min" ? 60 : 1) })));
      if (now === pairsText(parsePairs(v))) return;
      for (const r of rows.splice(0)) r.node.remove();
      for (const { name, seconds } of parsePairs(v)) addRow(name, seconds);
    };
  } else {
    row.classList.add("ctl--wide");
    const box = el("div", { className: "chips" });
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", control.label);
    const season = activeSeason();
    const options = control.options.filter((o) => !o.season || o.season === season || o.id === value); // a seasonal pack only in its season (or when already chosen)
    const group = chips(box, options, value, (o) => onSet(o.id));
    row.append(el("span", { className: "ctl__label", textContent: control.label }), box);
    write = (v) => group.set(v);
  }
  if (control.hint) row.append(el("small", { className: "ctl__hint", textContent: control.hint }));
  write(value);
  return { row, write };
}
