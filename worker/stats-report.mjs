// The numbers for the private stats page (/admin/stats/): Frills' own counts (frills_events), valwidgets.live's (tally_events),
// live health of the TikTok relay fleet (relay.valwidgets.live + any extra RELAY_URLS), and Google Search Console (when GSC_SERVICE_ACCOUNT
// or GSC OAuth secrets are set). Pure code over fetch, so it is tested with a made-up Cloudflare, relay, and Google API.

export const DATASETS = { frills: "frills_events", valwidgets: "tally_events" };
export const DEFAULT_RELAYS = ["https://relay.valwidgets.live"];

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
  const split = (ev, by, extra = () => true, maxAge = DAYS - 1) => {
    const out = new Map();
    for (const r of parsed) if (r.ev === ev && r.age <= maxAge && extra(r)) out.set(r[by] || "(none)", (out.get(r[by] || "(none)") ?? 0) + r.n);
    return [...out].sort((x, y) => y[1] - x[1]).map(([label, n]) => ({ label, n }));
  };
  const trio = (ev, extra) => ({
    today: total(ev, 0, 0, extra),
    yesterday: total(ev, 1, 1, extra),
    week: total(ev, 0, 6, extra),
    before: total(ev, 7, 13, extra),
    total: total(ev, 0, DAYS - 1, extra),
  });
  const daily = (ev, extra) => Array.from({ length: DAYS }, (_, i) => ({ day: isoDay(today - (DAYS - 1 - i) * DAY), n: total(ev, DAYS - 1 - i, DAYS - 1 - i, extra) }));
  const perDay = daily("visit");
  const shared = ["visit", "link_copied", "overlay_load", "plus_interest"];
  const others = {};
  for (const r of parsed) if (!shared.includes(r.ev)) others[r.ev] = (others[r.ev] ?? 0) + r.n;
  const live = (r) => r.b === "live";
  const visits = { ...trio("visit"), perDay, pages: split("visit", "a"), pagesWeek: split("visit", "a", () => true, 6), sources: split("visit", "b"), sourcesWeek: split("visit", "b", () => true, 6) };
  const copies = { ...trio("link_copied"), perDay: daily("link_copied"), byOverlay: split("link_copied", "a"), byOverlayWeek: split("link_copied", "a", () => true, 6), byPlatform: split("link_copied", "b", (r) => Boolean(r.b)), byPlatformWeek: split("link_copied", "b", (r) => Boolean(r.b), 6) };
  const loads = { live: trio("overlay_load", live), demo: trio("overlay_load", (r) => r.b === "demo"), livePerDay: daily("overlay_load", live), byKind: split("overlay_load", "a", live), byKindWeek: split("overlay_load", "a", live, 6) };
  const plus = { ...trio("plus_interest"), byFeature: split("plus_interest", "a"), byFeatureWeek: split("plus_interest", "a", () => true, 6) };
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
  const nowDay = new Set();
  const week = new Set();
  const before = new Set();
  const month = new Set();
  for (const r of rows ?? []) {
    const age = ageOf(r.d, today);
    if (!(age >= 0 && age < DAYS) || !r.id) continue;
    month.add(r.id);
    if (age === 0) nowDay.add(r.id);
    if (age <= 6) week.add(r.id);
    else if (age <= 13) before.add(r.id);
  }
  const returning = [...week].filter((id) => before.has(id)).length;
  return { today: nowDay.size, week: week.size, before: before.size, month: month.size, returning, returningRate: before.size ? returning / before.size : null };
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

/** Parses `env.RELAY_URLS` (comma-separated) or falls back to DEFAULT_RELAYS. */
export function parseRelayUrls(env) {
  const raw = String(env?.RELAY_URLS ?? "").trim();
  const list = raw ? raw.split(",").map((s) => s.trim().replace(/\/+$/, "")).filter((s) => /^https?:\/\//i.test(s)) : [];
  return list.length ? list : DEFAULT_RELAYS;
}

/** Probes all configured relay servers (`/health` JSON endpoint, falling back to `/tiktok/ping`) and returns their live status. */
export async function checkRelays(env, { fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
  const urls = parseRelayUrls(env);
  const ownerKey = String(env?.RELAY_OWNER_KEY ?? "").trim();
  return Promise.all(
    urls.map(async (base, index) => {
      const host = (() => { try { return new URL(base).host; } catch { return base; } })();
      const label = urls.length > 1 ? `Relay ${index + 1} (${host})` : `Primary Relay (${host})`;
      const t0 = Date.now();
      try {
        const headers = { accept: "application/json", ...(ownerKey ? { authorization: `Bearer ${ownerKey}` } : {}) };
        let res = await fetchImpl(`${base}/health`, { method: "GET", headers });
        if (res.status === 401 && ownerKey) {
          res = await fetchImpl(`${base}/health`, { method: "GET", headers: { accept: "application/json" } });
        }
        if (!res.ok) {
          res = await fetchImpl(`${base}/tiktok/ping`, { method: "GET", headers: { accept: "application/json" } });
        }
        const latencyMs = Math.max(1, Date.now() - t0);
        if (!res.ok) return { url: base, host, label, ok: false, level: "down", status: res.status, latencyMs };
        const body = await res.json().catch(() => null);
        if (!body || body.ok !== true) return { url: base, host, label, ok: false, level: "down", status: 502, latencyMs };
        const slots = body.slots ?? { used: 0, max: 30, waiting: 0 };
        const free = typeof body.free === "number" ? body.free : Math.max(0, (slots.max || 30) - (slots.used || 0));
        const level = body.level ?? (free === 0 ? "full" : free <= 10 ? "low" : "ok");
        return {
          url: base,
          host,
          label,
          ok: true,
          latencyMs,
          version: body.version ?? "—",
          level,
          free,
          slots: { used: Number(slots.used) || 0, max: Number(slots.max) || 30, waiting: Number(slots.waiting) || 0 },
          uptimeS: typeof body.uptimeS === "number" ? body.uptimeS : null,
          signing: body.signing ?? null,
          capacity: body.capacity ?? null,
          streams: body.streams ?? null,
          device: body.device ?? null,
          roster: Array.isArray(body.roster) ? body.roster : null,
        };
      } catch {
        return { url: base, host, label, ok: false, level: "down", status: 0, latencyMs: Math.max(1, Date.now() - t0) };
      }
    }),
  );
}

const b64url = (bytes) => {
  const bin = typeof bytes === "string" ? bytes : String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** Signs a Google Service Account JWT using Web Crypto RSASSA-PKCS1-v1_5 and exchanges it for an access token. */
async function serviceAccountToken(sa, fetchImpl, nowMs) {
  const pem = String(sa.private_key ?? "").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der.buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const iat = Math.floor(nowMs / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp: iat + 3600,
  }));
  const input = new TextEncoder().encode(`${header}.${claim}`);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, input);
  const assertion = `${header}.${claim}.${b64url(sig)}`;
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  if (!res.ok) throw Object.assign(new Error("gsc_auth"), { status: res.status });
  const data = await res.json();
  return data.access_token;
}

/** Exchanges a Google OAuth2 refresh token for an access token. */
async function refreshTokenAuth(env, fetchImpl) {
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GSC_CLIENT_ID,
      client_secret: env.GSC_CLIENT_SECRET,
      refresh_token: env.GSC_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!res.ok) throw Object.assign(new Error("gsc_auth"), { status: res.status });
  const data = await res.json();
  return data.access_token;
}

/** Fetches Google Search Console metrics (7d & 28d totals, top queries, top pages, top countries) when credentials are set. */
export async function fetchGsc(env, { now = Date.now(), fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
  const rawSa = String(env?.GSC_SERVICE_ACCOUNT ?? "").trim();
  const hasRefresh = Boolean(env?.GSC_CLIENT_ID && env?.GSC_CLIENT_SECRET && env?.GSC_REFRESH_TOKEN);
  if (!rawSa && !hasRefresh) return { configured: false };

  let token;
  try {
    if (rawSa) {
      const jsonText = rawSa.startsWith("{") ? rawSa : atob(rawSa);
      const sa = JSON.parse(jsonText);
      token = await serviceAccountToken(sa, fetchImpl, now);
    } else {
      token = await refreshTokenAuth(env, fetchImpl);
    }
  } catch (err) {
    return { configured: true, error: "auth_failed", status: err?.status ?? 0 };
  }

  const today = midnight(now);
  // GSC data has a ~2 day lag, so we query up to today with 28d and 7d windows
  const endDate = isoDay(today);
  const start28d = isoDay(today - 27 * DAY);
  const start7d = isoDay(today - 6 * DAY);

  const candidates = env?.GSC_SITE_URL ? [env.GSC_SITE_URL] : ["https://frills.valwidgets.live/", "sc-domain:valwidgets.live"];
  let siteUrl = candidates[0];

  const queryGsc = async (site, body) => {
    const res = await fetchImpl(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return res;
  };

  let testRes = await queryGsc(siteUrl, { startDate: start28d, endDate, rowLimit: 1 });
  if (!testRes.ok && candidates.length > 1) {
    const fallbackRes = await queryGsc(candidates[1], { startDate: start28d, endDate, rowLimit: 1 });
    if (fallbackRes.ok) {
      siteUrl = candidates[1];
      testRes = fallbackRes;
    }
  }
  if (!testRes.ok) return { configured: true, siteUrl, error: "query_failed", status: testRes.status };

  const askDim = async (startDate, dimensions = [], rowLimit = 10) => {
    const res = await queryGsc(siteUrl, { startDate, endDate, ...(dimensions.length ? { dimensions } : {}), rowLimit });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    return data.rows ?? [];
  };

  const [totals28dRows, totals7dRows, queries, pages, countries] = await Promise.all([
    askDim(start28d, [], 1),
    askDim(start7d, [], 1),
    askDim(start28d, ["query"], 10),
    askDim(start28d, ["page"], 10),
    askDim(start28d, ["country"], 10),
  ]);

  const packTotal = (rows) => {
    const r = rows[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    return { clicks: Number(r.clicks) || 0, impressions: Number(r.impressions) || 0, ctr: Number(r.ctr) || 0, position: Number(r.position) || 0 };
  };
  const packRows = (rows) => rows.map((r) => ({
    key: String(r.keys?.[0] ?? ""),
    clicks: Number(r.clicks) || 0,
    impressions: Number(r.impressions) || 0,
    ctr: Number(r.ctr) || 0,
    position: Number(r.position) || 0,
  }));

  return {
    configured: true,
    siteUrl,
    week: packTotal(totals7dRows),
    month: packTotal(totals28dRows),
    queries: packRows(queries),
    pages: packRows(pages),
    countries: packRows(countries),
  };
}

/** The whole report. `{ ok: false, error: "not_set" }` until the owner has set the two secrets. A site whose counts cannot be read says why, and the other still shows. */
export async function report(env, { now = Date.now(), fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
  if (!env?.CF_ACCOUNT_ID || !env?.CF_API_TOKEN) return { ok: false, error: "not_set" };
  const [events, ids, tally, relays, gsc] = await Promise.allSettled([
    ask(env, eventsQuery(DATASETS.frills), fetchImpl),
    ask(env, idsQuery(DATASETS.frills), fetchImpl),
    ask(env, eventsQuery(DATASETS.valwidgets), fetchImpl),
    checkRelays(env, { fetchImpl }),
    fetchGsc(env, { now, fetchImpl }),
  ]);
  const failed = (r) => ({ error: "unreadable", status: r.reason?.status ?? 0 });
  let frills;
  if (events.status === "fulfilled") {
    const summary = summarize(events.value, now);
    const active = ids.status === "fulfilled" ? activeOverlays(ids.value, now) : { today: 0, week: 0, before: 0, month: 0, returning: 0, returningRate: null };
    frills = { ...summary, active, scorecard: scorecard(summary, active), idsReadable: ids.status === "fulfilled" };
  } else frills = failed(events);
  const valwidgets = tally.status === "fulfilled" ? summarize(tally.value, now) : failed(tally);
  return {
    ok: true,
    now,
    frills,
    valwidgets,
    relays: relays.status === "fulfilled" ? relays.value : [],
    gsc: gsc.status === "fulfilled" ? gsc.value : { configured: false },
  };
}
