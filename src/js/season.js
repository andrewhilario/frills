// Seasons: a time of year with looks of its own. The editors offer the looks (and the decoration pack) of the season it is now, and stop offering
// them when it is over. Nothing already made changes when a season ends: a link carries every value it needs, and the looks and packs are still
// understood all year, so an overlay made at Halloween looks the same at Easter. Pure, so it is tested without a page.

/** A window runs from one month/day to another, both days included. One that crosses the new year (1 December to 6 January) is fine. */
export const SEASONS = [
  { id: "halloween", name: "Halloween", from: [10, 1], to: [11, 2] },
  { id: "christmas", name: "Christmas", from: [12, 1], to: [1, 6] },
];

export const seasonById = (id) => SEASONS.find((s) => s.id === id) ?? null;

const dayKey = (month, day) => month * 100 + day;

/** The id of the season a date falls in, by the date on this computer (the viewer's own day), or null between seasons. */
export function seasonOn(date = new Date()) {
  const today = dayKey(date.getMonth() + 1, date.getDate());
  const found = SEASONS.find(({ from, to }) => {
    const start = dayKey(...from);
    const end = dayKey(...to);
    return start <= end ? today >= start && today <= end : today >= start || today <= end;
  });
  return found ? found.id : null;
}

/**
 * The season a page offers: today's, unless the address names one (`?season=christmas`) or says `?season=none`. That is how a season is looked at
 * before its time, and how the tests stay the same on every day of the year.
 */
export function activeSeason(search = globalThis.location?.search ?? "", date = new Date()) {
  const asked = new URLSearchParams(search).get("season");
  if (asked === "none") return null;
  if (seasonById(asked)) return asked;
  return seasonOn(date);
}
