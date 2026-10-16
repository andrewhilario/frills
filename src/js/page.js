// Pages with no tools on them (the guide, privacy, not found): just the nav.

import { initNav } from "./nav.js";

initNav();

// The setup clips play (silent, looping) only while they are on screen. With reduced motion set they stay on their first picture, and the
// player's own controls start them. (Without script they are plain videos with controls.)
const clips = [...document.querySelectorAll(".clip video")];
if (clips.length && "IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const watch = new IntersectionObserver((seen) => seen.forEach(({ target, isIntersecting }) => (isIntersecting ? target.play().catch(() => {}) : target.pause())), { threshold: 0.5 });
  clips.forEach((video) => watch.observe(video));
}
