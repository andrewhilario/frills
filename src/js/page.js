// Pages with no tools on them (the guide, privacy, not found): just the nav.

import { initNav } from "./nav.js";
import { initTip } from "./tip.js";
import { countPlus } from "./stats.js";

initNav();
initTip(); // (only on the few pages it is meant for)

// The setup clips play (silent, looping) only while they are on screen. With reduced motion set they stay on their first picture, and the
// player's own controls start them. (Without script they are plain videos with controls.)
const clips = [...document.querySelectorAll(".clip video")];
if (clips.length && "IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const watch = new IntersectionObserver((seen) => seen.forEach(({ target, isIntersecting }) => (isIntersecting ? target.play().catch(() => {}) : target.pause())), { threshold: 0.5 });
  clips.forEach((video) => watch.observe(video));
}

// "I would use this" on the paid-plan ideas: one anonymous count for each idea (only with script on, so the buttons start hidden), remembered in this browser so a second tap or a reload does not count again.
for (const button of document.querySelectorAll("[data-plus]")) {
  const feature = button.dataset.plus;
  const mark = () => {
    button.setAttribute("aria-pressed", "true");
    button.textContent = "Noted, thank you";
  };
  let done = false;
  try { done = localStorage.getItem("frills:plus:" + feature) === "1"; } catch { /* storage can be blocked */ }
  button.hidden = false;
  button.setAttribute("aria-pressed", "false");
  if (done) mark();
  button.addEventListener("click", () => {
    if (button.getAttribute("aria-pressed") === "true") return;
    countPlus(feature);
    try { localStorage.setItem("frills:plus:" + feature, "1"); } catch { /* storage can be blocked */ }
    mark();
  });
}
