// The numbers for the private stats page (/admin/stats/): Frills' own counts (frills_events) and valwidgets.live's (tally_events), read from Cloudflare's Analytics
// Engine over its SQL API, and boiled down to what the owner decides with: visits and where they came from, link copies, overlays opened, how many DIFFERENT overlays opened
// this week and how many came back, and a scorecard for the Frills Plus question. It reads with two Worker secrets that only the owner sets (CF_ACCOUNT_ID, and CF_API_TOKEN,
// a token with the one permission Account > Account Analytics > Read); without them the page says how to set them. Pure code over fetch, so it is tested with a made-up Cloudflare.

export const DATASETS = { frills: "frills_events", valwidgets: "tally_events" };

const DAY = 86_400_000;
const DAYS = 28;

const eventsQuery = (dataset) => `SELECT blob1 AS ev, blob2 AS a, blob3 AS b, toStartOfInterval(timestamp, INTERVAL '1' DAY) AS d, SUM(_sample_interval) AS n FROM ${dataset} WHERE timestamp > NOW() - INTERVAL '${DAYS}' DAY GROUP BY ev, a, b, d ORDER BY d`;
const idsQuery = (dataset) => `SELECT blob4 AS id, toStartOfInterval(timestamp, INTERVAL '1' DAY) AS d FROM ${dataset} WHERE blob1 = 'overlay_load' AND blob3 = 'live' AND blob4 != '' AND timestamp > NOW() - INTERVAL '${DAYS}' DAY GROUP BY id, d LIMIT 20000`;

const midnight = (ms) => Date.UTC(new Date(ms).getUTCFullYear(), new Date(ms).getUTCMonth(), new Date(ms).getUTCDate());
const dayOf = (d) => Date.parse(String(d).replace(" ", "T").replace(/Z?$/, "Z")); // "2026-11-05 00:00:00" (UTC) as a time
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
/** How many days before `today` (midnight, UTC) a row's day is: 0 is today. (Rows come at midnight already; a time of day is ignored all the same.) */
const ageOf = (d, today) => Math.round((today - midnight(dayOf(d))) / DAY);

/** The same questions for either site: the three events they share are counted the same way, and any other event is listed by name. */
export function summarize(rows, now = Date.now()) {
  const today = midnight(now);
  const parsed = (rows ?? []).map((r) => ({ ev: String(r.ev), a: String(r.a ?? ""), b: String(r.b ?? ""), age: ageOf(r.d, today), n: Number(r.n) || 0 })).filter((r) => r.age >= 0 && r.age < DAYS);
  const total = (ev, from, to, extra = () => true) => parsed.filter((r) => r.ev === ev && r.age >= from && r.age <= to && extra(r)).reduce((sum, r) => sum + r.n, 0);
  const split = (ev, by, extra = () => true) => {
    const out = new Map();
    for (const r of parsed) if (r.ev === ev && extra(r)) out.set(r[by] || "(none)", (out.get(r[by] || "(none)") ?? 0) + r.n);
    return [...out].sort((x, y) => y[1] - x[1]).map(([label, n]) => ({ label, n }));
  };
  const trio = (ev, extra) => ({ total: total(ev, 0, DAYS - 1, extra), week: total(ev, 0, 6, extra), before: total(ev, 7, 13, extra) });
  const perDay = Array.from({ length: DAYS }, (_, i) => ({ day: isoDay(today - (DAYS - 1 - i) * DAY), n: total("visit", DAYS - 1 - i, DAYS - 1 - i) }));
  const shared = ["visit", "link_copied", "overlay_load", "plus_interest"];
  const others = {};
  for (const r of parsed) if (!shared.includes(r.ev)) others[r.ev] = (others[r.ev] ?? 0) + r.n;
  const live = (r) => r.b === "live";
  const visits = { ...trio("visit"), perDay, pages: split("visit", "a"), sources: split("visit", "b") };
  const copies = { ...trio("link_copied"), byOverlay: split("link_copied", "a"), byPlatform: split("link_copied", "b", (r) => Boolean(r.b)) };
  const loads = { live: trio("overlay_load", live), demo: trio("overlay_load", (r) => r.b === "demo"), byKind: split("overlay_load", "a", live) };
  const plus = { ...trio("plus_interest"), byFeature: split("plus_interest", "a") };
  const rate = (num, den) => (den > 0 ? num / den : null);
  const funnel = {
    week: { visits: visits.week, copies: copies.week, live: loads.live.week, copyRate: rate(copies.week, visits.week), liveRate: rate(loads.live.week, copies.week) },
    month: { visits: visits.total, copies: copies.total, live: loads.live.total, copyRate: rate(copies.total, visits.total), liveRate: rate(loads.live.total, copies.total) },
  };
  return {
    visits,
    copies,
    loads,
    plus,
    funnel,
    others: Object.entries(others).sort((x, y) => y[1] - x[1]).map(([label, n]) => ({ label, n })),
  };
}

/** How many different overlays opened on a real account in the last seven days, in the seven before, in all 28, and how many of this week's were also there the week before. */
export function activeOverlays(rows, now = Date.now()) {
  const today = midnight(now);
  const week = new Set();
  const before = new Set();
  const month = new Set();
  for (const r of rows ?? []) {
    const age = ageOf(r.d, today);
    if (!(age >= 0 && age < DAYS) || !r.id) continue;
    month.add(r.id);
    if (age <= 6) week.add(r.id);
    else if (age <= 13) before.add(r.id);
  }
  const returning = [...week].filter((id) => before.has(id)).length;
  return { week: week.size, before: before.size, month: month.size, returning, returningRate: before.size ? returning / before.size : null };
}

/** My starting points for "is Frills Plus worth building yet" (change them here): enough different overlays a week, enough of them coming back, enough links copied. */
export const TARGETS = { overlays: 50, returningRate: 0.4, copies: 100 };

export function scorecard(summary, active) {
  const pct = (v) => (v === null ? "no earlier week yet" : Math.round(v * 100) + "%");
  return [
    { id: "overlays", label: "Different overlays opened this week", value: String(active.week), target: `${TARGETS.overlays} or more`, ok: active.week >= TARGETS.overlays },
    { id: "returning", label: "Of last week's overlays, how many opened again this week", value: pct(active.returningRate), target: `${Math.round(TARGETS.returningRate * 100)}% or more`, ok: active.returningRate !== null && active.returningRate >= TARGETS.returningRate },
    { id: "copies", label: "Links copied this week", value: String(summary.copies.week), target: `${TARGETS.copies} or more`, ok: summary.copies.week >= TARGETS.copies },
  ];
}

/** Asks Cloudflare's SQL API one question; the rows, or a thrown { status }. */
async function ask(env, query, fetchImpl) {
  const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CF_ACCOUNT_ID)}/analytics_engine/sql`, { method: "POST", headers: { authorization: `Bearer ${env.CF_API_TOKEN}` }, body: query });
  if (!res.ok) throw Object.assign(new Error("cloudflare"), { status: res.status });
  return (await res.json()).data ?? [];
}

/** The whole report. `{ ok: false, error: "not_set" }` until the owner has set the two secrets. A site whose counts cannot be read says why, and the other still shows. */
export async function report(env, { now = Date.now(), fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
  if (!env?.CF_ACCOUNT_ID || !env?.CF_API_TOKEN) return { ok: false, error: "not_set" };
  const [events, ids, tally] = await Promise.allSettled([ask(env, eventsQuery(DATASETS.frills), fetchImpl), ask(env, idsQuery(DATASETS.frills), fetchImpl), ask(env, eventsQuery(DATASETS.valwidgets), fetchImpl)]);
  const failed = (r) => ({ error: "unreadable", status: r.reason?.status ?? 0 });
  let frills;
  if (events.status === "fulfilled") {
    const summary = summarize(events.value, now);
    const active = ids.status === "fulfilled" ? activeOverlays(ids.value, now) : { week: 0, before: 0, month: 0, returning: 0, returningRate: null };
    frills = { ...summary, active, scorecard: scorecard(summary, active), idsReadable: ids.status === "fulfilled" };
  } else frills = failed(events);
  const valwidgets = tally.status === "fulfilled" ? summarize(tally.value, now) : failed(tally);
  return { ok: true, now, frills, valwidgets };
}
