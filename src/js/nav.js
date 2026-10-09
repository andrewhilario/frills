// The nav: it gains a hairline and a soft shadow once the page has moved, and below the wide breakpoint its links live in a sheet.

export function initNav() {
  const nav = document.querySelector("[data-nav]");
  if (!nav) return;

  let queued = false;
  const update = () => {
    queued = false;
    nav.classList.toggle("is-scrolled", window.scrollY > 8);
  };
  requestAnimationFrame(update);
  window.addEventListener("scroll", () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  }, { passive: true });

  const toggle = nav.querySelector(".nav__toggle");
  const sheet = nav.querySelector(".nav__sheet");
  if (!toggle || !sheet) return;
  const setOpen = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    sheet.hidden = !open;
  };
  toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
  sheet.addEventListener("click", (event) => {
    if (event.target.closest("a")) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !sheet.hidden) {
      setOpen(false);
      toggle.focus();
    }
  });
}
