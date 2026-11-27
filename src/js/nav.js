// The nav: it gains a hairline and a soft shadow once the page has moved, and below the wide breakpoint its links live in a sheet.
// (Every page with the nav also counts its visit, anonymously: see stats.js.)

import "./stats.js";

export function initAnnouncement() {
  const banner = document.getElementById("site-announcement");
  if (!banner) return;
  const key = "frills:update:2026-11-27";
  try {
    if (localStorage.getItem(key) === "dismissed") {
      banner.hidden = true;
      return;
    }
  } catch {}
  banner.hidden = false;
  banner.querySelector(".announcement__close")?.addEventListener("click", () => {
    banner.hidden = true;
    try { localStorage.setItem(key, "dismissed"); } catch {}
  });
}

export function applyPlusRegionDom(eligible) {
  for (const el of document.querySelectorAll("[data-plus-only]")) el.hidden = !eligible;
  for (const a of document.querySelectorAll('.foot__links a[href="/plus/"], .foot__links a[href="/account/"], .nav__sheet a[href="/plus/"], .nav__sheet a[href="/account/"]')) {
    const item = a.closest("li") ?? a;
    item.hidden = !eligible;
  }
}

export function initPlusRegion() {
  if (document.body?.dataset?.plusAccounts !== "on") return;
  try {
    const cached = sessionStorage.getItem("frills:plus:eligible");
    if (cached === "1" || cached === "0") applyPlusRegionDom(cached === "1");
  } catch {}
  fetch("/api/cloud-overlays?probe=1", { credentials: "same-origin", cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (typeof data?.eligible !== "boolean") return;
      try { sessionStorage.setItem("frills:plus:eligible", data.eligible ? "1" : "0"); } catch {}
      applyPlusRegionDom(data.eligible);
    })
    .catch(() => {});
}

export function initNav() {
  initAnnouncement();
  initPlusRegion();
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
