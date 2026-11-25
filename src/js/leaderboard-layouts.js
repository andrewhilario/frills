// Design presets shared by rank leaderboards (Top Likers and Top Gifters).
export const LEADERBOARD_LAYOUTS = [
  ["classic", "Classic: rounded cards"],
  ["spotlight", "Spotlight: bigger #1 hero card"],
  ["compact", "Compact: slim low-profile rows"],
  ["pill", "Pill: rounded capsule badges"],
  ["glass", "Glass: frosted translucent cards"],
  ["neon", "Neon: glowing dark arcade frame"],
  ["macos", "Window: a framed card with a title strip"],
  ["shell", "Shell: retro terminal console"],
  ["kawaii", "Kawaii: double pastel border"],
  ["minimal", "Minimal: floating text only"],
  ["stacked", "Stacked minimal: count under name"],
];

/** Returns a deterministic storage bucket suffix ("w:YYYY-Www", "m:YYYY-MM", or "") for weekly/monthly/all-time boards. */
export function periodBucket(period = "all", now = Date.now()) {
  if (period !== "week" && period !== "month") return "";
  const d = new Date(now);
  if (period === "month") {
    return `m:${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
  return `w:${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
