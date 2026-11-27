// Remembers the visitor's chosen streaming platform ("tiktok" | "twitch" | "both") and last entered channel names
// across Frills editors so Twitch and multistream creators do not get reset to TikTok on every overlay page.

const PREF_KEY = "frills:platform:v1";
const VALID = new Set(["tiktok", "twitch", "both"]);

/** Reads the saved cross-site platform preference, or empty defaults when none is stored. */
export function loadPlatformPref() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) ?? "null");
    if (!raw || typeof raw !== "object") return { platform: "", tiktok: "", twitch: "" };
    return {
      platform: VALID.has(raw.platform) ? raw.platform : "",
      tiktok: typeof raw.tiktok === "string" ? raw.tiktok : "",
      twitch: typeof raw.twitch === "string" ? raw.twitch : "",
    };
  } catch {
    return { platform: "", tiktok: "", twitch: "" };
  }
}

/** Updates the cross-site platform preference without clearing fields that are not supplied. */
export function savePlatformPref({ platform, tiktok, twitch } = {}) {
  try {
    const prev = loadPlatformPref();
    const next = {
      platform: VALID.has(platform) ? platform : prev.platform,
      tiktok: typeof tiktok === "string" && tiktok.trim() ? tiktok : prev.tiktok,
      twitch: typeof twitch === "string" && twitch.trim() ? twitch : prev.twitch,
    };
    localStorage.setItem(PREF_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked */
  }
}

/** Wires `[data-platform-filter="listId"]` chip bars on `/` and `/overlays/` to filter overlay cards and remember platform choice. */
export function initPlatformFilters() {
  for (const bar of document.querySelectorAll("[data-platform-filter]")) {
    const list = document.getElementById(bar.dataset.platformFilter);
    if (!list) continue;
    const buttons = [...bar.querySelectorAll("[data-filter]")];
    const items = [...list.querySelectorAll("[data-plats]")];
    const apply = (pick, remember = false) => {
      for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.filter === pick));
      for (const item of items) {
        const plats = String(item.dataset.plats || "").split(" ");
        item.hidden = pick !== "all" && !plats.includes(pick);
      }
      if (remember && VALID.has(pick)) savePlatformPref({ platform: pick });
    };
    for (const btn of buttons) {
      btn.addEventListener("click", () => apply(btn.dataset.filter, true));
    }
  }
}

