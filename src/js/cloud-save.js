// Frills Plus Live Cloud Overlay bar for all editors (Chat, Matcha, Alerts, Gifts, Jar, Goal, Likers, Gifters, Labels, Counter, Timer, Songs, TTS).
//   - Hidden completely for free / signed-out visitors (zero clutter).
//   - For signed-in Frills Plus accounts: lets you save named presets into D1 and copy one permanent URL (/o/<id>).
//   - Press "Save live update" anytime to push new colors, themes, fonts, rules, or channel names live to OBS within seconds.

import { copyButton } from "./ui.js";
import { countPrompt } from "./stats.js";

const ID_RE = /^[A-Za-z0-9_-]{12}$/;

const ERRORS = {
  sign_in_first: "Sign in on your account page first.",
  plus_required: "Live cloud links need an active Frills Plus plan.",
  region_unavailable: "Frills Plus is not available in this region yet.",
  limit_reached: "You reached the limit of 50 saved cloud overlays. Delete an older one on your account page first.",
  bad_name: "Enter a short name for this live overlay.",
  bad_query: "Type your channel name first before saving a live link.",
  not_found: "That saved overlay no longer exists. Create a new live link instead.",
  wrong_origin: "Reload this page and try again.",
};

function queryFromOverlayUrl(raw) {
  try {
    const parsed = new URL(String(raw ?? "").trim(), location.origin);
    if (!parsed.pathname.startsWith("/overlay/")) return "";
    parsed.searchParams.delete("_cv");
    parsed.searchParams.delete("cloud");
    parsed.searchParams.delete("loaded");
    return parsed.searchParams.toString();
  } catch {
    return "";
  }
}

/**
 * Mounts the Frills Plus "Live cloud link" box right below the editor's normal copy-link field.
 * Returns `{ sync() }` — call `sync()` whenever the editor's overlay URL changes so the save button & dirty status stay accurate.
 */
export function mountCloudSave({ kind, storeKey, anchor, getUrl, defaultName = "Live overlay", onStatus } = {}) {
  const params = new URLSearchParams(location.search);
  const urlCloudId = ID_RE.test(params.get("cloud") ?? "") ? params.get("cloud") : "";
  const alreadyLoaded = params.get("loaded") === "1";

  // Clean up ephemeral `?loaded=1` marker after reloading a cloud preset into the editor
  if (urlCloudId && alreadyLoaded) {
    try {
      const clean = new URL(location.href);
      clean.searchParams.delete("loaded");
      history.replaceState(null, "", clean.pathname + clean.search + clean.hash);
    } catch { /* ignore history restrictions */ }
  }

  // If opened from /account/ ("Edit" link -> /editor/?cloud=<id>), hydrate exact saved settings before user edits
  if (urlCloudId && !alreadyLoaded) {
    fetch(`/api/o/${urlCloudId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.ok || !data.query) return;
        try { if (storeKey) localStorage.removeItem(storeKey); } catch {}
        location.replace(`${location.pathname}?${data.query}&cloud=${urlCloudId}&loaded=1`);
      })
      .catch(() => {});
  }

  let overlays = [];
  let activeId = urlCloudId;
  let lastSavedQuery = "";
  let saving = false;
  let els = null;

  const currentOverlay = () => overlays.find((o) => o.id === activeId) ?? null;

  const setStatus = (text, state = "") => {
    if (!els) return;
    els.status.dataset.state = state;
    els.status.textContent = text;
  };

  const renderOptions = () => {
    if (!els) return;
    els.select.replaceChildren();
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "+ New live overlay";
    els.select.append(blank);
    for (const item of overlays) {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = `${item.name} (v${item.version})`;
      els.select.append(opt);
    }
    els.select.value = currentOverlay() ? activeId : "";
  };

  const syncUi = () => {
    if (!els) return;
    const item = currentOverlay();
    const query = queryFromOverlayUrl(getUrl());
    els.saveBtn.disabled = saving || !query;
    els.saveBtn.textContent = saving ? "Saving…" : item ? "Save live update" : "Create live link";
    els.urlWrap.hidden = !item;
    if (item) {
      els.urlInput.value = item.liveUrl;
      if (lastSavedQuery && query && query !== lastSavedQuery && !saving) {
        setStatus("Unsaved changes — press Save live update to push them to OBS.", "warn");
      }
    } else if (!query && !saving) {
      setStatus("Type your channel name above first to create a live cloud link.");
    }
  };

  const loadPresetIntoEditor = (id) => {
    const item = overlays.find((o) => o.id === id);
    if (!item) {
      activeId = "";
      lastSavedQuery = "";
      if (els) els.nameInput.value = "";
      try {
        const clean = new URL(location.href);
        clean.searchParams.delete("cloud");
        history.replaceState(null, "", clean.pathname + clean.search + clean.hash);
      } catch {}
      setStatus("");
      syncUi();
      return;
    }
    try { if (storeKey) localStorage.removeItem(storeKey); } catch {}
    location.assign(`${location.pathname}?${item.query}&cloud=${item.id}&loaded=1`);
  };

  const buildBox = () => {
    const box = document.createElement("section");
    box.className = "cloud-box";
    box.setAttribute("aria-label", "Live cloud overlay link");

    const head = document.createElement("div");
    head.className = "cloud-box__head";
    const title = document.createElement("h3");
    title.className = "cloud-box__title";
    title.textContent = "Live cloud link";
    const badge = document.createElement("span");
    badge.className = "cloud-box__badge";
    badge.textContent = "Frills Plus";
    const manage = document.createElement("a");
    manage.className = "cloud-box__manage";
    manage.href = "/account/#acct-cloud";
    manage.textContent = "Manage all";
    head.append(title, badge, manage);

    const intro = document.createElement("p");
    intro.className = "cloud-box__hint";
    intro.textContent = "Paste this permanent link into OBS once. Change looks or settings here anytime and press Save — OBS updates live in a few seconds.";

    const rowPick = document.createElement("div");
    rowPick.className = "cloud-box__field";
    const pickLabel = document.createElement("label");
    pickLabel.className = "ctl__label";
    pickLabel.htmlFor = `cloud-pick-${kind}`;
    pickLabel.textContent = "Saved overlay";
    const select = document.createElement("select");
    select.id = `cloud-pick-${kind}`;
    rowPick.append(pickLabel, select);

    const rowName = document.createElement("div");
    rowName.className = "cloud-box__save";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.id = `cloud-name-${kind}`;
    nameInput.maxLength = 60;
    nameInput.placeholder = `Name (e.g. ${defaultName})`;
    nameInput.setAttribute("aria-label", "Live overlay name");
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn btn--sm";
    saveBtn.textContent = "Create live link";
    rowName.append(nameInput, saveBtn);

    const urlWrap = document.createElement("div");
    urlWrap.className = "cloud-box__url";
    urlWrap.hidden = true;
    const urlLabel = document.createElement("label");
    urlLabel.className = "ctl__label";
    urlLabel.htmlFor = `cloud-url-${kind}`;
    urlLabel.textContent = "Permanent live link for OBS";
    const urlRow = document.createElement("div");
    urlRow.className = "cloud-box__url-row";
    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.id = `cloud-url-${kind}`;
    urlInput.readOnly = true;
    urlInput.spellcheck = false;
    urlInput.autocomplete = "off";
    urlInput.addEventListener("focus", () => urlInput.select());
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "btn btn--outline btn--sm";
    copyBtn.textContent = "Copy live link";
    copyButton(copyBtn, () => urlInput.value, { label: "Copy live link" });
    urlRow.append(urlInput, copyBtn);
    urlWrap.append(urlLabel, urlRow);

    const status = document.createElement("p");
    status.className = "cloud-box__status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    box.append(head, intro, rowPick, rowName, urlWrap, status);
    anchor.insertAdjacentElement("afterend", box);

    select.addEventListener("change", () => loadPresetIntoEditor(select.value));

    saveBtn.addEventListener("click", async () => {
      const query = queryFromOverlayUrl(getUrl());
      if (!query) {
        setStatus(ERRORS.bad_query, "error");
        return;
      }
      const existing = currentOverlay();
      const name = nameInput.value.trim() || existing?.name || defaultName;
      saving = true;
      syncUi();
      setStatus(existing ? "Pushing live update…" : "Creating live link…");
      try {
        const endpoint = existing ? `/api/cloud-overlays/${existing.id}` : "/api/cloud-overlays";
        const method = existing ? "PUT" : "POST";
        const res = await fetch(endpoint, {
          method,
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(existing ? { name, query } : { kind, name, query }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.ok || !body.overlay) {
          setStatus(ERRORS[body.error] ?? "Could not save right now. Please try again.", "error");
        } else {
          const saved = body.overlay;
          const idx = overlays.findIndex((o) => o.id === saved.id);
          if (idx >= 0) overlays[idx] = saved;
          else overlays.unshift(saved);
          activeId = saved.id;
          lastSavedQuery = saved.query;
          nameInput.value = saved.name;
          renderOptions();
          try {
            const nextUrl = new URL(location.href);
            nextUrl.searchParams.set("cloud", saved.id);
            nextUrl.searchParams.delete("loaded");
            history.replaceState(null, "", nextUrl.pathname + nextUrl.search + nextUrl.hash);
          } catch {}
          setStatus(`Saved (v${saved.version}) — OBS updates automatically within a few seconds.`, "ok");
        }
      } catch {
        setStatus("Could not reach Frills. Check your connection and try again.", "error");
      }
      saving = false;
      syncUi();
    });

    els = { box, select, nameInput, saveBtn, urlWrap, urlInput, copyBtn, status };
  };

  const TIER1_TIPS = {
    timer: {
      title: "Keep your timer safe through OBS crashes",
      body: "Cloud backup across restarts, live phone controls (+1m, pause, resume), and 1-click theme sync.",
    },
    tts: {
      title: "Unlock natural AI voices & your own mascot",
      body: "150,000 neural AI voice characters/mo, custom 3-frame PNGTuber uploads, and 1-Link Master Scenes.",
    },
    gifters: {
      title: "Never lose your Weekly & Monthly leaderboards",
      body: "Crash-proof cloud backups, phone reset controls, and 1-click theme sync across every OBS source.",
    },
    likers: {
      title: "Never lose your Weekly & Monthly leaderboards",
      body: "Crash-proof cloud backups, phone reset controls, and 1-click theme sync across every OBS source.",
    },
    jar: {
      title: "Never lose your Gift Jar progress on a crash",
      body: "Automatic cloud recovery, live phone controls (+100 drop, fill, empty), and 1-click OBS theme sync.",
    },
    wheel: {
      title: "Spin your wheel right from your phone",
      body: "Remote Spin button on your phone deck, 1-Link Master Scenes, and 1-click OBS theme sync.",
    },
    actions: {
      title: "Go past 10 free actions & unlock full VTube Studio",
      body: "Unlimited OBS rules, unlimited custom-shape sticky notes, VTS props & expressions, and phone triggers.",
    },
    goal: {
      title: "Keep your Goal Bar backed up across restarts",
      body: "Crash-proof cloud memory, phone remote controls (+1, +10, reset), and 1-click OBS theme sync.",
    },
    outline: {
      title: "Unlock freeform box resizing, collector frames & 4K PNG",
      body: "Drag & resize any cutout or panel to exact pixels, plus Cyber HUD, Celestial Filigree, Scrapbook & Plush Ribbon frames, custom wallpapers, orbiting glows, 10-row Gift Rewards boards & 4K PNG.",
    },
  };

  /** Fires `shown` only when `el` is actually scrolled into the viewport for >= 300ms (never inflated by un-scrolled page loads). */
  const observePromptView = (el, moment) => {
    if (typeof IntersectionObserver !== "function") {
      countPrompt(moment, "shown");
      return;
    }
    let timer = 0;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.35);
        if (visible && !timer) {
          timer = setTimeout(() => {
            io.disconnect();
            countPrompt(moment, "shown");
          }, 300);
        } else if (!visible && timer) {
          clearTimeout(timer);
          timer = 0;
        }
      },
      { threshold: [0, 0.35, 0.6] },
    );
    io.observe(el);
  };

  /** High-intent 1-line nudge shown right after a Tier-1 free user clicks "Copy link". */
  const attachPostCopyNudge = () => {
    if (document.body?.dataset?.plusAccounts !== "on") return;
    const copyBtn = anchor?.querySelector("#copy-link, [data-copy-link]");
    if (!copyBtn) return;
    let shown = false;
    copyBtn.addEventListener("click", () => {
      if (shown || copyBtn.disabled) return;
      try { if (sessionStorage.getItem("frills:plus:copy-nudge:off") === "1") return; } catch {}
      shown = true;
      const nudge = document.createElement("div");
      nudge.className = "cloud-nudge";
      nudge.setAttribute("role", "status");
      const body = document.createElement("span");
      body.className = "cloud-nudge__body";
      body.append("Hate re-pasting links into OBS when you tweak colors? Save one live link with ");
      const link = document.createElement("a");
      link.href = "/plus/";
      link.textContent = "Frills Plus →";
      link.addEventListener("click", () => countPrompt("copy_nudge", "clicked"));
      body.append(link);
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.className = "cloud-tip__close";
      dismiss.setAttribute("aria-label", "Hide this note");
      dismiss.textContent = "×";
      dismiss.addEventListener("click", () => {
        nudge.remove();
        try { sessionStorage.setItem("frills:plus:copy-nudge:off", "1"); } catch {}
      });
      nudge.append(body, dismiss);
      const actions = anchor.querySelector(".linkfield__actions");
      if (actions) actions.insertAdjacentElement("afterend", nudge);
      else anchor.append(nudge);
      countPrompt("copy_nudge", "shown");
    });
  };

  const mountTier1Tip = () => {
    if (document.body?.dataset?.plusAccounts !== "on") return;
    attachPostCopyNudge();
    try { if (sessionStorage.getItem("frills:plus:tip:off") === "1") return; } catch {}
    const promo = String(document.body?.dataset?.plusPromo ?? "").trim();
    const copy = TIER1_TIPS[kind] ?? {
      title: "Edit live in OBS without re-pasting your link",
      body: "Permanent /o/… cloud links, 1-click theme sync across every overlay, and a dedicated 24/7 TikTok server.",
    };
    const tip = document.createElement("aside");
    tip.className = "cloud-tip";
    tip.setAttribute("aria-label", "Frills Plus live cloud links");

    const top = document.createElement("div");
    top.className = "cloud-tip__top";
    const badge = document.createElement("span");
    badge.className = "cloud-box__badge";
    badge.textContent = "Frills Plus";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "cloud-tip__close";
    close.setAttribute("aria-label", "Hide this tip");
    close.textContent = "×";
    close.addEventListener("click", () => {
      tip.remove();
      try { sessionStorage.setItem("frills:plus:tip:off", "1"); } catch {}
    });
    top.append(badge, close);

    const title = document.createElement("strong");
    title.className = "cloud-tip__title";
    title.textContent = copy.title;

    const text = document.createElement("p");
    text.className = "cloud-tip__text";
    text.append(copy.body + " ");
    if (promo) {
      text.append("Founding 20: 20% off forever with ");
      const code = document.createElement("code");
      code.textContent = promo;
      text.append(code, ".");
    }

    const cta = document.createElement("a");
    cta.className = "btn btn--sm cloud-tip__cta";
    cta.href = "/plus/";
    cta.textContent = "See Frills Plus →";
    cta.addEventListener("click", () => countPrompt("editor_tip", "clicked"));

    tip.append(top, title, text, cta);
    anchor.insertAdjacentElement("afterend", tip);
    observePromptView(tip, "editor_tip");
  };

  // Probe account + Plus status silently (probe=1 returns 200 when signed out so DevTools stays error-free);
  // show full cloud bar for active Plus, or a subtle Tier-1-only tip for eligible non-Plus visitors.
  if (anchor && document.body?.dataset?.plusAccounts === "on") {
    fetch(`/api/cloud-overlays?kind=${encodeURIComponent(kind)}&probe=1`, { credentials: "same-origin", cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => null) }))
      .then(({ ok, data }) => {
        if (ok && typeof data?.eligible === "boolean") {
          try { sessionStorage.setItem("frills:plus:eligible", data.eligible ? "1" : "0"); } catch {}
          for (const el of document.querySelectorAll("[data-plus-only]")) el.hidden = !data.eligible;
        }
        onStatus?.({
          signedIn: Boolean(ok && data?.signedIn),
          plusActive: Boolean(ok && data?.ok && data.plusActive),
          eligible: Boolean(ok && data?.eligible),
        });
        if (ok && data?.ok && data.plusActive) {
          overlays = Array.isArray(data.overlays) ? data.overlays : [];
          buildBox();
          renderOptions();
          const linked = currentOverlay();
          if (linked) {
            els.nameInput.value = linked.name;
            lastSavedQuery = linked.query;
            setStatus(`Editing “${linked.name}” (v${linked.version}). Press Save live update after changing anything.`);
          }
          syncUi();
        } else if (data?.eligible === true) {
          mountTier1Tip();
        }
      })
      .catch(() => {});
  }

  return { sync: syncUi };
}
