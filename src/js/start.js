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
// `names` keeps what was typed for each platform, so going back and changing platform never puts a TikTok name in the Twitch box.
const answers = { platform: "tiktok", names: { tiktok: "", twitch: "" }, overlays: ["chat", "alerts"], vibe: "pink", shape: "vertical", align: "left" };
const NAMES = {
  tiktok: { label: "Your TikTok @name", short: "Your TikTok name", placeholder: "@yourname", rule: "Your TikTok @name: letters, numbers, _ and . only.", clean: cleanTikTokUser },
  twitch: { label: "Your Twitch channel", short: "Your Twitch channel", placeholder: "yourchannel", rule: "Your Twitch channel: letters, numbers and _ only.", clean: cleanChannel },
};
/** The accounts the answers need a name for: one, or TikTok then Twitch for "both". */
const accounts = () => (answers.platform === "both" ? ["tiktok", "twitch"] : [answers.platform]);
const cleanOf = (p) => NAMES[p].clean(answers.names[p]);
// a name is optional, but one that is typed has to be one its platform accepts
const badOf = (p) => answers.names[p].trim() !== "" && !cleanOf(p);

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
      [
        { id: "tiktok", name: "TikTok LIVE", text: "Chat, alerts, gifts, goals and likers." },
        { id: "twitch", name: "Twitch", text: "Chat and alerts (subs, gifted subs, cheers, raids)." },
        { id: "both", name: "Both at once", text: "One chat with TikTok and Twitch together, alerts for each, and TikTok's gifts, goals and likers. In beta." },
      ],
      answers.platform, (id) => { answers.platform = id; }, (i) => titled(i.name, i.text), { label: "Where you stream" },
    ),
    needsNext: true,
  },
  {
    ask: () => (answers.platform === "both" ? "What are your TikTok @name and Twitch channel?" : answers.platform === "twitch" ? "What is your Twitch channel?" : "What is your TikTok @name?"),
    hint: () => (answers.platform === "both" ? "They go into your links, each one only where it is needed. You can change them later, on the last page." : "It goes into your links. You can change it later, on the last page."),
    body: (next) => {
      const list = accounts();
      const boxes = list.map((p, i) => {
        const input = el("input", { type: "text", id: i ? `start-name-${i + 1}` : "start-name", className: "start__name", autocomplete: "off", spellcheck: false, value: answers.names[p] });
        input.dataset.platform = p;
        input.setAttribute("aria-label", NAMES[p].short);
        input.placeholder = NAMES[p].placeholder;
        input.addEventListener("keydown", (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (i < list.length - 1) document.getElementById(`start-name-${i + 2}`)?.focus(); // Enter in the first box moves to the second
          else next();
        });
        input.addEventListener("input", () => input.removeAttribute("aria-invalid"));
        return list.length > 1 ? el("div", { className: "start__field" }, el("label", { className: "start__label", htmlFor: input.id, textContent: NAMES[p].label }), input) : input;
      });
      const skip = el("button", { type: "button", className: "btn btn--soft", textContent: list.length > 1 ? "I will add them later" : "I will add it later" });
      skip.addEventListener("click", () => { for (const input of host.querySelectorAll("input[data-platform]")) input.value = ""; next(); });
      queueMicrotask(() => host.querySelector("input[data-platform]")?.focus());
      return el("div", { className: "start__field" }, ...boxes, el("div", { className: "start__row" }, skip));
    },
    commit: () => { for (const input of host.querySelectorAll("input[data-platform]")) answers.names[input.dataset.platform] = input.value; },
    valid: () => {
      const bad = accounts().filter(badOf);
      for (const input of host.querySelectorAll("input[data-platform]")) input.toggleAttribute("aria-invalid", bad.includes(input.dataset.platform));
      host.querySelector("input[aria-invalid]")?.focus();
      return bad.length === 0;
    },
    problem: () => accounts().filter(badOf).map((p) => NAMES[p].rule).join(" "),
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
        const both = answers.platform === "both";
        const blurb = !both ? o.blurb : o.id === "alerts" ? `${o.blurb} One for TikTok and one for Twitch.` : o.id === "chat" ? "Your TikTok and Twitch chat together, in one set of speech bubbles." : `${o.blurb} TikTok only.`;
        list.append(el("label", { className: "pick pick--check" }, box, el("span", { className: "pick__body" }, ...titled(o.name, blurb))));
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
  host.replaceChildren(progress, bar, heading, el("p", { className: "start__hint", textContent: typeof q.hint === "function" ? q.hint() : q.hint }), q.body(next), problem, nav);
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
  const both = answers.platform === "both";
  // in "both" the first name is TikTok's and the second is Twitch's; for one platform there is only the first
  const state = () => ({ platform: answers.platform, channel: cleanOf(accounts()[0]), twitch: both ? cleanOf("twitch") : "", overlays: answers.overlays, vibe: answers.vibe, shape: answers.shape, align: answers.align });
  const links = () => buildLinks(origin, state());

  const heading = el("h2", { className: "start__ask", tabIndex: -1, textContent: "Your links are ready" });
  const vibe = VIBES.find((v) => v.id === answers.vibe);
  const summary = el("p", { className: "start__hint" });
  const draw = () => { summary.textContent = `${vibe.name}, sized ${SHAPES[answers.shape].size}, text on the ${answers.align}. Copy a link into your streaming app, or press “Edit this one” to change it.`; };
  draw();

  // the name can still be changed here, and every link follows it
  const fields = accounts().map((p, i) => {
    const input = el("input", { type: "text", id: i ? `result-name-${i + 1}` : "result-name", className: "start__name", autocomplete: "off", spellcheck: false, value: answers.names[p] });
    input.placeholder = NAMES[p].placeholder;
    return { platform: p, input, label: el("label", { className: "start__label", htmlFor: input.id, textContent: NAMES[p].label }) };
  });
  const nameNote = el("p", { className: "start__error", hidden: true });
  const nameBox = el("div", { className: "start__field start__field--inline" }, ...fields.flatMap((f) => [f.label, f.input]), nameNote);
  const waiting = (needs) => (both ? (needs.length > 1 ? "Type both names above to get this link" : `Type your ${needs[0] === "tiktok" ? "TikTok @name" : "Twitch channel"} above to get this link`) : "Type your name above to get this link");

  const grid = el("div", { className: "cards" });
  const allButton = el("button", { type: "button", className: "btn", disabled: true });
  copyButton(allButton, () => linksText(links()), { label: "Copy all links" });

  const refresh = () => {
    for (const f of fields) {
      answers.names[f.platform] = f.input.value;
      f.input.toggleAttribute("aria-invalid", badOf(f.platform));
    }
    const problems = fields.filter((f) => badOf(f.platform)).map((f) => NAMES[f.platform].rule);
    nameNote.textContent = problems.join(" ");
    nameNote.hidden = problems.length === 0;
    const list = links();
    for (const link of list) {
      const card = cards.get(link.id);
      if (!card) continue;
      card.input.value = link.url;
      card.input.placeholder = waiting(link.needs);
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
  again.addEventListener("click", () => { for (const f of fields) answers.names[f.platform] = f.input.value; go(0); });
  const next = el("aside", { className: "note start__next" },
    el("strong", { textContent: "What next? " }),
    "In your streaming app (OBS or similar), add a ", el("strong", { textContent: "Browser source" }), " for each link and paste it in. ",
    el("a", { href: "/guides/setup/", textContent: "Watch how, in about 20 seconds" }), " or read ", el("a", { href: "/guides/obs/", textContent: "the setup guide" }), ".",
    answers.platform !== "twitch" ? " On TikTok, real chat and gifts only show while you are LIVE." : "",
  );

  host.replaceChildren(heading, summary, nameBox, el("div", { className: "start__row" }, allButton, again), grid, next);
  host.dataset.view = "result";
  for (const f of fields) f.input.addEventListener("input", refresh);
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
