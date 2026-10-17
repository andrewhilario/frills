// Quick start: six questions, one at a time, then the links. See quickstart.js for how answers become links. Nothing is sent anywhere
// and nothing is saved: the answers live on this page only.

import { initNav } from "./nav.js";
import { cleanTikTokUser } from "./tiktok.js";
import { cleanChannel } from "./twitch.js";
import { copyButton } from "./ui.js";
import { el } from "./feed.js";
import { ALIGNS, SHAPES, VIBES, buildLinks, linksText, overlaysFor } from "./quickstart.js";

initNav();

const host = document.getElementById("start");
const answers = { platform: "tiktok", text: "", overlays: ["chat", "alerts"], vibe: "pink", shape: "vertical", align: "left" };
const cleanName = () => (answers.platform === "twitch" ? cleanChannel(answers.text) : cleanTikTokUser(answers.text));
const NAME_RULE = { tiktok: "Your TikTok @name: letters, numbers, _ and . only.", twitch: "Your Twitch channel: letters, numbers and _ only." };

let step = 0;

/** A set of big buttons where one is pressed. `render(item)` returns the inside of each button. */
function picks(items, current, onPick, render, { label }) {
  const group = el("div", { className: "picks" });
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", label);
  for (const item of items) {
    const button = el("button", { type: "button", className: "pick" }, ...[].concat(render(item)));
    button.setAttribute("aria-pressed", String(item.id === current));
    button.addEventListener("click", () => {
      for (const b of group.children) b.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-pressed", "true");
      onPick(item.id);
    });
    group.append(button);
  }
  return group;
}
/** The three colors of a look, as dots. */
function swatchOf(vibe) {
  const row = el("span", { className: "swatch" });
  row.setAttribute("aria-hidden", "true");
  for (const color of vibe.swatch) { const dot = el("i"); dot.style.background = color; row.append(dot); }
  return row;
}
const titled = (name, text) => [el("strong", { className: "pick__name", textContent: name }), text ? el("span", { className: "pick__text", textContent: text }) : ""];

// ── the questions ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const QUESTIONS = [
  {
    ask: "Where do you stream?",
    hint: "This decides which overlays you can have and how they connect. Pick one, then press Next.",
    body: () => picks(
      [{ id: "tiktok", name: "TikTok LIVE", text: "Chat, alerts, gifts, goals and likers." }, { id: "twitch", name: "Twitch", text: "Chat and alerts (subs, gifted subs, cheers, raids)." }],
      answers.platform, (id) => { answers.platform = id; }, (i) => titled(i.name, i.text), { label: "Where you stream" },
    ),
    needsNext: true,
  },
  {
    ask: () => (answers.platform === "twitch" ? "What is your Twitch channel?" : "What is your TikTok @name?"),
    hint: "It goes into your links. You can change it later, on the last page.",
    body: (next) => {
      const input = el("input", { type: "text", id: "start-name", className: "start__name", autocomplete: "off", spellcheck: false, value: answers.text });
      input.setAttribute("aria-label", answers.platform === "twitch" ? "Your Twitch channel" : "Your TikTok name");
      input.placeholder = answers.platform === "twitch" ? "yourchannel" : "@yourname";
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); next(); } });
      input.addEventListener("input", () => input.removeAttribute("aria-invalid"));
      const skip = el("button", { type: "button", className: "btn btn--soft", textContent: "I will add it later" });
      skip.addEventListener("click", () => { input.value = ""; next(); });
      queueMicrotask(() => input.focus());
      return el("div", { className: "start__field" }, input, el("div", { className: "start__row" }, skip));
    },
    commit: () => { const box = document.getElementById("start-name"); if (box) answers.text = box.value; },
    // a name is optional, but one that is typed has to be one this platform accepts
    valid: () => {
      const bad = answers.text.trim() !== "" && !cleanName();
      const box = document.getElementById("start-name");
      if (box) { box.toggleAttribute("aria-invalid", bad); if (bad) box.focus(); }
      return !bad;
    },
    problem: () => NAME_RULE[answers.platform],
    needsNext: true,
  },
  {
    ask: "Which overlays do you want?",
    hint: "Tick as many as you like. You can add the rest any time.",
    body: () => {
      const list = el("div", { className: "picks picks--check" });
      list.setAttribute("role", "group");
      list.setAttribute("aria-label", "Overlays");
      for (const o of overlaysFor(answers.platform)) {
        const box = el("input", { type: "checkbox", checked: answers.overlays.includes(o.id) });
        box.addEventListener("change", () => { answers.overlays = box.checked ? [...new Set([...answers.overlays, o.id])] : answers.overlays.filter((id) => id !== o.id); });
        list.append(el("label", { className: "pick pick--check" }, box, el("span", { className: "pick__body" }, ...titled(o.name, o.blurb))));
      }
      return list;
    },
    valid: () => overlaysFor(answers.platform).some((o) => answers.overlays.includes(o.id)),
    problem: "Choose at least one overlay.",
    needsNext: true,
  },
  {
    ask: "What is your vibe?",
    hint: "Every overlay you picked gets the same look, so they match. Pick one, then press Next.",
    body: () => picks(VIBES, answers.vibe, (id) => { answers.vibe = id; }, (v) => [
      swatchOf(v),
      ...titled(v.name, v.blurb),
    ], { label: "Your vibe" }),
    needsNext: true,
  },
  {
    ask: "What shape is your stream?",
    hint: "Your streaming app asks for a size. We will tell you which one to use. Pick one, then press Next.",
    needsNext: true,
    body: () => picks(Object.entries(SHAPES).map(([id, s]) => ({ id, ...s })), answers.shape, (id) => { answers.shape = id; }, (s) => titled(s.name, `${s.size}, ${s.hint}`), { label: "Stream shape" }),
  },
  {
    ask: "Where should the text sit?",
    hint: "Left, in the middle, or on the right. You can still change it in the editor. Pick one, then press Next.",
    needsNext: true,
    body: () => picks(ALIGNS.map(([id, name]) => ({ id, name })), answers.align, (id) => { answers.align = id; }, (a) => titled(a.name), { label: "Text alignment" }),
  },
];

// ── drawing a question ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function drawQuestion() {
  const q = QUESTIONS[step];
  const heading = el("h2", { className: "start__ask", tabIndex: -1, textContent: typeof q.ask === "function" ? q.ask() : q.ask });
  const next = () => { q.commit?.(); if (q.valid && !q.valid()) { problem.textContent = typeof q.problem === "function" ? q.problem() : q.problem; problem.hidden = false; return; } go(step + 1); };
  const problem = el("p", { className: "start__error", hidden: true });
  problem.setAttribute("role", "alert");
  const progress = el("p", { className: "start__step", textContent: `Question ${step + 1} of ${QUESTIONS.length}` });
  const bar = el("div", { className: "start__bar" }, el("i"));
  bar.setAttribute("aria-hidden", "true");
  bar.firstChild.style.width = `${((step + 1) / QUESTIONS.length) * 100}%`;
  const nav = el("div", { className: "start__nav" });
  if (step > 0) {
    const back = el("button", { type: "button", className: "btn btn--soft", textContent: "Back" });
    back.addEventListener("click", () => { q.commit?.(); go(step - 1); });
    nav.append(back);
  }
  if (q.needsNext) {
    const forward = el("button", { type: "button", className: "btn", textContent: step === QUESTIONS.length - 1 ? "Show my links" : "Next" });
    forward.addEventListener("click", next);
    nav.append(forward);
  }
  host.replaceChildren(progress, bar, heading, el("p", { className: "start__hint", textContent: q.hint }), q.body(next), problem, nav);
  host.dataset.view = "question";
  if (step !== 1) heading.focus({ preventScroll: true });
}

function go(to) {
  if (to >= QUESTIONS.length) { drawResult(); return; }
  step = Math.max(0, to);
  drawQuestion();
}

// ── the links ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function drawResult() {
  const origin = location.origin;
  const cards = new Map();
  const state = () => ({ platform: answers.platform, channel: cleanName(), overlays: answers.overlays, vibe: answers.vibe, shape: answers.shape, align: answers.align });
  const links = () => buildLinks(origin, state());

  const heading = el("h2", { className: "start__ask", tabIndex: -1, textContent: "Your links are ready" });
  const vibe = VIBES.find((v) => v.id === answers.vibe);
  const summary = el("p", { className: "start__hint" });
  const draw = () => { summary.textContent = `${vibe.name}, sized ${SHAPES[answers.shape].size}, text on the ${answers.align}. Copy a link into your streaming app, or press “Edit this one” to change it.`; };
  draw();

  // the name can still be changed here, and every link follows it
  const name = el("input", { type: "text", id: "result-name", className: "start__name", autocomplete: "off", spellcheck: false, value: answers.text });
  name.placeholder = answers.platform === "twitch" ? "yourchannel" : "@yourname";
  const nameLabel = el("label", { className: "start__label", htmlFor: "result-name", textContent: answers.platform === "twitch" ? "Your Twitch channel" : "Your TikTok @name" });
  const nameNote = el("p", { className: "start__error", hidden: true });
  const nameBox = el("div", { className: "start__field start__field--inline" }, nameLabel, name, nameNote);

  const grid = el("div", { className: "cards" });
  const allButton = el("button", { type: "button", className: "btn", disabled: true });
  copyButton(allButton, () => linksText(links()), { label: "Copy all links" });

  const refresh = () => {
    answers.text = name.value;
    const clean = cleanName();
    const bad = answers.text.trim() !== "" && !clean;
    nameNote.textContent = bad ? NAME_RULE[answers.platform] : "";
    nameNote.hidden = !bad;
    name.toggleAttribute("aria-invalid", bad);
    const list = links();
    for (const link of list) {
      const card = cards.get(link.id);
      if (!card) continue;
      card.input.value = link.url;
      card.input.placeholder = "Type your name above to get this link";
      card.copy.disabled = !link.url;
      card.edit.href = link.editUrl;
    }
    allButton.disabled = !list.some((l) => l.url);
  };

  for (const link of links()) {
    const input = el("input", { type: "text", readOnly: true, className: "card__input", spellcheck: false, autocomplete: "off", id: `link-${link.id}` });
    input.setAttribute("aria-label", `Link for ${link.name}`);
    input.addEventListener("focus", () => input.select());
    const copy = el("button", { type: "button", className: "btn" });
    copyButton(copy, () => input.value, { label: "Copy link" });
    const edit = el("a", { className: "btn btn--soft btn--sm", target: "_blank", rel: "noopener", textContent: "Edit this one" });
    const frame = el("iframe", { className: "card__frame", src: link.preview, title: `${link.name} in your style`, loading: "lazy", tabIndex: -1 });
    frame.setAttribute("aria-hidden", "true");
    const stage = el("div", { className: "card__stage" }, frame);
    const card = el("article", { className: "card" },
      el("header", { className: "card__head" }, el("h3", { className: "subtitle", textContent: link.name }), el("p", { textContent: link.blurb })),
      stage,
      el("div", { className: "card__link" }, input, copy),
      el("p", { className: "card__size" }, "In your streaming app, make the source ", el("strong", { textContent: link.size }), " wide by high."),
      link.note ? el("p", { className: "card__note", textContent: link.note }) : "",
      el("div", { className: "card__edit" }, edit),
    );
    cards.set(link.id, { input, copy, edit, stage, frame });
    grid.append(card);
  }

  const again = el("button", { type: "button", className: "btn btn--soft", textContent: "Change my answers" });
  again.addEventListener("click", () => { answers.text = name.value; go(0); });
  const next = el("aside", { className: "note start__next" },
    el("strong", { textContent: "What next? " }),
    "In your streaming app (OBS or similar), add a ", el("strong", { textContent: "Browser source" }), " for each link and paste it in. ",
    el("a", { href: "/guides/setup/", textContent: "Watch how, in about 20 seconds" }), " or read ", el("a", { href: "/guides/obs/", textContent: "the setup guide" }), ".",
    answers.platform === "tiktok" ? " On TikTok, real chat and gifts only show while you are LIVE." : "",
  );

  host.replaceChildren(heading, summary, nameBox, el("div", { className: "start__row" }, allButton, again), grid, next);
  host.dataset.view = "result";
  name.addEventListener("input", refresh);
  refresh();
  heading.focus({ preventScroll: true });

  // each picture is a real overlay in practice mode, drawn 640 wide and shrunk to fit its card
  const fit = () => {
    for (const { stage, frame } of cards.values()) {
      const k = stage.clientWidth / 640;
      if (!k) continue;
      frame.style.transform = `scale(${k.toFixed(4)})`;
      frame.style.height = `${(stage.clientHeight / k).toFixed(1)}px`;
    }
  };
  fit();
  if ("ResizeObserver" in window) new ResizeObserver(fit).observe(grid);
  else window.addEventListener("resize", fit);
}

go(0);
