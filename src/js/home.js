// The home page: a live stage you can change the look of, a link maker, small previews of every look, numbers that count up.

import { initNav } from "./nav.js";
import { Feed } from "./feed.js";
import { fakeSource, SAMPLE_MESSAGES } from "./fake.js";
import { PRESETS, PRESET_NAMES, overlayUrl, sanitize } from "./settings.js";
import { fontsReady, generalFaces, paintGeneral } from "./look.js";
import { chips, copyButton } from "./ui.js";
import { cleanChannel } from "./twitch.js";
import { luminance } from "./color.js";

initNav();

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ── The hero stage: practice chat in a look you can switch ────────────────────────────────────────────────────────────
const heroStage = document.getElementById("hero-stage");
const heroFeed = new Feed(document.getElementById("hero-chat"));
const frilly = document.querySelector(".frilly");
let look = sanitize(PRESETS.butter);

// Four messages on a phone, five on a wide screen, so the stage never runs up under its label.
const wide = window.matchMedia("(min-width: 60rem)");
const paintHero = () => heroFeed.configure(paintGeneral(heroStage, { ...look, max: wide.matches ? 5 : 4, life: 14 }));
wide.addEventListener("change", paintHero);

function hop() {
  if (!frilly || prefersReducedMotion) return;
  frilly.classList.remove("is-hop");
  void frilly.getBoundingClientRect(); // restart the animation
  frilly.classList.add("is-hop");
  setTimeout(() => frilly.classList.remove("is-hop"), 460);
}

// A swatch that reads against the page: the accent, unless that is nearly black.
const swatch = (p) => (luminance(p.accent) < 0.08 ? p.bg : p.accent);

const heroLooks = document.getElementById("hero-looks");
// Draws the stage in the current look, once that look's typeface is here, so the chat never swaps fonts in front of the viewer.
let turn = 0;
async function showLook(first = false) {
  const mine = ++turn;
  await fontsReady(generalFaces(look));
  if (mine !== turn) return; // somebody picked another look meanwhile
  heroFeed.clear();
  paintHero();
  SAMPLE_MESSAGES.forEach((m) => heroFeed.show({ ...m }));
  if (!first) hop();
}

chips(
  heroLooks,
  Object.keys(PRESETS).map((id) => ({ id, name: PRESET_NAMES[id], dot: swatch(PRESETS[id]) })),
  "butter",
  (item) => {
    look = sanitize(PRESETS[item.id]);
    showLook();
  },
  { dot: true },
);

paintHero();
const practice = fakeSource(heroFeed, () => [1500, 3000]);
practice.pause(true);
showLook(true).then(() => practice.pause(false));
// Don't keep drawing while nobody can see the stage.
new IntersectionObserver((entries) => practice.pause(!entries[0].isIntersecting)).observe(heroStage);

// ── The link maker (step 3) ───────────────────────────────────────────────────────────────────────────────────────────
const channelInput = document.getElementById("lm-channel");
const hint = document.getElementById("lm-hint");
const copyBtn = document.getElementById("lm-copy");
const say = (text, state = "") => {
  hint.dataset.state = state;
  hint.textContent = text;
};
copyButton(
  copyBtn,
  () => {
    const channel = cleanChannel(channelInput.value);
    if (!channel) {
      channelInput.setAttribute("aria-invalid", "true");
      say("Type your Twitch channel name first. Letters, numbers and _ only.", "error");
      channelInput.focus();
      return "";
    }
    channelInput.removeAttribute("aria-invalid");
    return overlayUrl(`${location.origin}/overlay/`, { channel, settings: look });
  },
  {
    label: "Copy my link",
    onResult: (ok) => say(ok ? "Copied. In OBS, add a Browser source and paste it." : "Your browser blocked copying. Select the link in the editor instead.", ok ? "" : "error"),
  },
);
channelInput.addEventListener("input", () => channelInput.removeAttribute("aria-invalid"));
document.getElementById("linkmaker").addEventListener("submit", (event) => {
  event.preventDefault();
  copyBtn.click();
});

// ── Small previews of every look ──────────────────────────────────────────────────────────────────────────────────────
// They are drawn when the section is near, not before: each one uses its own typeface, and nobody should download seven fonts to read a headline.
function drawPreviews() {
  document.querySelectorAll("[data-look]").forEach(async (stage) => {
    const preset = PRESETS[stage.dataset.look];
    if (!preset) return;
    const settings = sanitize(preset);
    const options = paintGeneral(stage, settings);
    stage.style.setProperty("--g-size", Math.round(settings.size * 0.78) + "px"); // a little smaller, so it fits the card
    await fontsReady(generalFaces(settings));
    new Feed(stage.querySelector(".chatbox"), options).fill(SAMPLE_MESSAGES);
  });
}
const looksSection = document.getElementById("looks");
if ("IntersectionObserver" in window && looksSection) {
  const near = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    near.disconnect();
    drawPreviews();
  }, { rootMargin: "600px 0px" });
  near.observe(looksSection);
} else {
  drawPreviews();
}

// ── Numbers that count up once, when they come into view ──────────────────────────────────────────────────────────────
const counters = document.querySelectorAll("[data-count]");
if (!prefersReducedMotion && "IntersectionObserver" in window) {
  const watcher = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        watcher.unobserve(entry.target);
        const node = entry.target;
        const target = Number(node.dataset.count);
        node.textContent = "0";
        const start = performance.now();
        const step = (now) => {
          const t = Math.min(1, (now - start) / 1200);
          node.textContent = String(Math.round(target * (1 - (1 - t) ** 4)));
          if (t < 1) requestAnimationFrame(step);
          else node.parentElement.classList.add("is-done");
        };
        requestAnimationFrame(step);
      }
    },
    { threshold: 0.6 },
  );
  counters.forEach((node) => watcher.observe(node));
}
