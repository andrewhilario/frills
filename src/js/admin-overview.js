// The numbers and sentences behind the admin dashboard's Overview. Pure functions over what /api/admin/overview (our own database) and /api/admin/stats
// (traffic, relay health, Euler quota) return, so they are tested without a page. Nothing here invents a number: when a figure cannot be read, the card says so.

export const number = (n) => Number(n || 0).toLocaleString("en-US");
export const dollars = (n) => "$" + Number(n || 0).toFixed(2);
const shortDay = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** How this week compares with the week before, as words and a direction. */
export function change(now, before) {
  if (!Number.isFinite(now) || !Number.isFinite(before)) return null;
  if (before === 0) return now === 0 ? { text: "No change", tone: "flat" } : { text: "Up from none last week", tone: "up" };
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return { text: "No change", tone: "flat" };
  return { text: `${pct > 0 ? "+" : "−"}${Math.abs(pct)}% vs last week`, tone: pct > 0 ? "up" : "down" };
}

/** loading until the stats call answers, error if it failed, off when the Cloudflare secrets are not set, ready otherwise. */
export const statsState = (stats) => (stats === undefined ? "loading" : stats === null ? "error" : stats.ok ? "ready" : "off");

export function relayName(relay) {
  const host = String(relay?.host ?? "");
  if (host.includes("plus-relay")) return "Plus relay";
  if (host === "relay.valwidgets.live") return "Free relay";
  return relay?.label || host || "Relay";
}

/** One relay as a status word, a tone and a line of detail. A word always goes with the color. */
export function relayState(relay) {
  if (!relay?.ok) return { tone: "bad", word: "Down", detail: relay?.status ? `No good answer (status ${relay.status})` : "No answer" };
  const used = Number(relay.slots?.used) || 0;
  const max = Number(relay.slots?.max) || 0;
  const tone = relay.level === "full" ? "bad" : relay.level === "low" ? "warn" : "ok";
  const word = relay.level === "full" ? "Full" : relay.level === "low" ? "Nearly full" : "Online";
  return { tone, word, detail: `${number(used)} of ${number(max)} spots used` };
}

/** The Euler signing quota a relay reports (relay 0.7 and later), or null when it does not say. */
export function quotaOf(relay) {
  const quota = relay?.signing?.quota;
  if (!quota) return null;
  const day = quota.remote?.ok ? quota.remote.day : null;
  const max = Number(day?.max ?? quota.cap) || 0;
  const left = Number(day?.remaining ?? quota.remaining);
  if (!max || !Number.isFinite(left)) return null;
  return { left, max, share: left / max };
}

const DOWN_WORDS = {
  "Free relay": "Free relay is down. TikTok chat does not work for free users until it is back.",
  "Plus relay": "Plus relay is down. Plus subscribers fall back to the free relay until it is back.",
};

/** What needs the owner, worst first. Each item says what is wrong in a sentence, and where to go for it. */
export function attention({ overview, stats } = {}) {
  const items = [];
  if (stats === null) items.push({ tone: "warn", text: "Traffic and relay health could not be read. Press Refresh to try again." });
  else if (stats && stats.ok === false) items.push({ tone: "info", text: "Traffic and relay health are not connected. Set the CF_ACCOUNT_ID and CF_API_TOKEN secrets in Cloudflare to see them here." });
  else if (stats?.ok) {
    for (const relay of stats.relays ?? []) {
      const name = relayName(relay);
      if (!relay.ok) items.push({ tone: "bad", text: DOWN_WORDS[name] ?? `${name} is down.`, href: "/admin/stats/", action: "Open fleet" });
      else if (relay.level === "full") items.push({ tone: "bad", text: `${name} is full. New streamers are being turned away.`, href: "/admin/stats/", action: "Open fleet" });
      else if (relay.level === "low") items.push({ tone: "warn", text: `${name} has ${number(relay.free)} spots left.`, href: "/admin/stats/", action: "Open fleet" });
      const quota = quotaOf(relay);
      if (relay.ok && quota && quota.share < 0.2) items.push({ tone: "warn", text: `${name}: only ${number(quota.left)} of ${number(quota.max)} Euler requests are left today.`, href: "/admin/stats/", action: "Open fleet" });
    }
  }
  for (const p of overview?.plus?.expiring ?? []) {
    items.push({ tone: "warn", text: `${p.email}: ${p.manual ? "manual Plus" : "Plus"} ends ${shortDay(p.renewsAt)}.`, view: "plus", action: "Open Plus" });
  }
  const fresh = overview?.summary?.feedback?.new ?? 0;
  if (fresh > 0) items.push({ tone: "info", text: `${number(fresh)} new feedback ${fresh === 1 ? "message" : "messages"} to read.`, view: "feedback", action: "Open inbox" });
  const rank = { bad: 0, warn: 1, info: 2 };
  return items.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

/** The six cards across the top. A number that is still loading, or cannot be read, shows a dash and says why. */
export function kpiCards({ overview, stats } = {}) {
  const plus = overview?.plus;
  const accounts = overview?.accounts;
  const state = statsState(stats);
  const f = state === "ready" && stats.frills && !stats.frills.error ? stats.frills : null;
  const missing = state === "loading" ? "Loading…" : state === "off" ? "Not connected" : "Could not read";
  const traffic = (key, label, value, sub, delta) => (f ? { key, label, value: number(value), sub, change: delta } : { key, label, value: "—", sub: missing, change: null });
  const paid = plus?.paid ?? 0;
  return [
    { key: "plus", label: "Frills Plus", value: plus ? number(plus.active) : "—", sub: plus ? `${number(plus.paid)} paid · ${number(plus.manual)} manual · ${number(plus.vip)} VIP` : "Loading…", change: null },
    { key: "revenue", label: "Monthly revenue", value: plus ? dollars(plus.monthlyUsd) : "—", sub: plus ? `List price · ${number(paid)} paid ${paid === 1 ? "subscriber" : "subscribers"}${plus.ending ? ` · ${number(plus.ending)} ending` : ""}` : "Loading…", change: null },
    { key: "accounts", label: "Accounts", value: accounts ? number(accounts.total) : "—", sub: accounts ? `${number(accounts.last7d)} new this week` : "Loading…", change: accounts ? change(accounts.last7d, accounts.previous7d) : null },
    traffic("visits", "Visits, 7 days", f?.visits?.week, f ? `${number(f.visits.today)} today` : "", f ? change(f.visits.week, f.visits.before) : null),
    traffic("copies", "Links copied, 7 days", f?.copies?.week, f ? `${number(f.copies.today)} today` : "", f ? change(f.copies.week, f.copies.before) : null),
    traffic("live", "Live overlays, 7 days", f?.active?.week, f ? `${number(f.active.today)} today` : "", f ? change(f.active.week, f.active.before) : null),
  ];
}

export const CHARTS = [
  { key: "visits", label: "Visits", noun: "visits" },
  { key: "copies", label: "Links copied", noun: "links copied" },
  { key: "live", label: "Live overlays", noun: "live overlay opens" },
];

/** Daily counts for the chart, or null when they cannot be read. */
export function chartSeries(stats, kind) {
  const f = stats?.ok ? stats.frills : null;
  if (!f || f.error) return null;
  const series = kind === "copies" ? f.copies?.perDay : kind === "live" ? f.loads?.livePerDay : f.visits?.perDay;
  return Array.isArray(series) && series.length ? series.map((d) => ({ day: d.day, n: Number(d.n) || 0 })) : null;
}

/** A sentence for the chart that says what the bars say, for people who cannot see them. */
export function chartSentence(series, noun) {
  if (!series) return "";
  const total = series.reduce((n, d) => n + d.n, 0);
  const peak = series.reduce((best, d) => (d.n > best.n ? d : best), series[0]);
  const today = series[series.length - 1];
  return total === 0
    ? `No ${noun} in the last ${series.length} days.`
    : `${number(total)} ${noun} in ${series.length} days. Busiest day: ${shortDay(Date.parse(peak.day + "T00:00:00Z"))} with ${number(peak.n)}. Today: ${number(today.n)}.`;
}

/** Plus kinds as the words shown on a row. */
export const PLUS_KIND_WORDS = { paid: "Paid", manual: "Manual", vip: "VIP", ended: "Ended" };
