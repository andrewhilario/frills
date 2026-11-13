// Frills' anonymous counts and the numbers for the private stats page: what can be counted (and nothing else), what the Worker accepts, how an overlay opening is counted
// (with a one-way code, never the name), how the report is made from Cloudflare's rows, and that only the admin password opens it.

import test from "node:test";
import assert from "node:assert/strict";
import { EVENTS, encodeEvent, labelsValid, loadOf, overlayOf, pageOf, parseEvent, platformOf, refOf, toDataPoint } from "../src/js/stats-events.js";
import { countOverlay, handleEvent, scramble, countryOf } from "../worker/stats.mjs";
import { DATASETS, TARGETS, activeOverlays, eventsByCountry, overlaysByCountry, checkRelays, fetchGsc, parseRelayUrls, report, scorecard, summarize } from "../worker/stats-report.mjs";
import { handleAdmin } from "../worker/admin.mjs";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";

const SITE = "https://frills.example";
const post = (body, { origin = SITE, headers = {} } = {}) => new Request(`${SITE}/api/e`, { method: "POST", headers: { ...(origin ? { origin } : {}), ...headers }, body });
const sink = () => ({ points: [], writeDataPoint(p) { this.points.push(p); } });

test("only the events and labels on the fixed lists can be counted, and an event survives the wire exactly", () => {
  assert.deepEqual(Object.keys(EVENTS), ["visit", "link_copied", "overlay_load", "plus_interest"]);
  assert.equal(labelsValid("visit", "home", "tiktok"), true);
  assert.equal(labelsValid("visit", "home", "somewhere"), false, "a label that is not on the list");
  assert.equal(labelsValid("visit", "home"), false, "a visit needs where it came from");
  assert.equal(labelsValid("link_copied", "goal"), true);
  assert.equal(labelsValid("link_copied", "goal", "tiktok"), true);
  assert.equal(labelsValid("link_copied", "chat", "both"), true);
  assert.equal(labelsValid("link_copied", "goal", "x"), false, "only an allowed platform label");
  assert.equal(labelsValid("plus_interest", "remote_link"), true);
  assert.equal(labelsValid("plus_interest", "remote_link", "editor"), true);
  assert.equal(labelsValid("plus_interest", "unknown_feature"), false);
  assert.equal(labelsValid("overlay_load", "chat", "live"), true);
  assert.equal(labelsValid("nothing", "a", ""), false);
  for (const [event, first, second] of [["visit", "editor", "reddit"], ["link_copied", "songs", ""], ["link_copied", "chat", "tiktok"], ["plus_interest", "remote_link", "editor"]]) assert.deepEqual(parseEvent(encodeEvent(event, first, second)), { event, first, second });
  for (const bad of ["", "not json", "[]", "null", '{"e":"visit","a":"home","b":"tiktok","c":"extra"}', '{"e":"visit","a":1}', '{"e":"visit","a":"home","b":5}', '{"e":"visit","a":"home","b":"<script>"}']) assert.equal(parseEvent(bad), null, bad);
  assert.deepEqual(toDataPoint({ event: "visit", first: "home", second: "tiktok" }), { indexes: ["visit"], blobs: ["visit", "home", "tiktok", "", ""], doubles: [1] });
  assert.deepEqual(toDataPoint({ event: "visit", first: "home", second: "tiktok" }, "", "PH").blobs, ["visit", "home", "tiktok", "", "PH"], "and the country rides along when it is known");
});

test("a page is grouped, an editor is named, an overlay is told apart, the platform of a link is read, and where a visit came from is a coarse group (a label in the link wins)", () => {
  assert.deepEqual(["/", "/editor/", "/overlays/faq/", "/goal/", "/matcha/alerts/", "/guides/obs/", "/looks/frog-pond/", "/changelog/", "/privacy/"].map(pageOf), ["home", "editor", "overlays", "goal", "matcha", "guides", "guides", "other", "other"]);
  assert.deepEqual(["/editor/", "/alerts/", "/matcha/alerts/", "/matcha/", "/songs/", "/guides/obs/", "/"].map(overlayOf), ["chat", "alerts", "alerts", "matcha", "songs", "", ""]);
  assert.deepEqual(["/overlay/", "/overlay", "/overlay/alerts/", "/overlay/goal", "/overlay/nope/", "/overlay/layout/", "/editor/"].map(loadOf), ["chat", "chat", "alerts", "goal", "", "", ""]);
  assert.equal(platformOf("https://frills.example/overlay/?channel=pond.pal&platform=tiktok"), "tiktok");
  assert.equal(platformOf("https://frills.example/overlay/?channel=pond_pal&platform=twitch"), "twitch");
  assert.equal(platformOf("https://frills.example/overlay/?tiktok=pond.pal&twitch=pond_pal"), "both");
  assert.equal(platformOf(""), "");
  const host = "frills.example";
  assert.equal(refOf("", host), "direct");
  assert.equal(refOf("https://frills.example/editor/", host), "direct", "from this site itself is not a source");
  assert.equal(refOf("https://www.tiktok.com/@x", host), "tiktok");
  assert.equal(refOf("https://old.reddit.com/r/y", host), "reddit");
  assert.equal(refOf("https://www.google.com/", host), "search");
  assert.equal(refOf("https://discord.com/channels/1", host), "discord");
  assert.equal(refOf("https://example.org/", host), "other");
  assert.equal(refOf("https://example.org/", host, "ad2"), "ad2", "a ?ref= label we put in a link wins");
  assert.equal(refOf("https://www.tiktok.com/", host, "bio"), "bio");
  assert.equal(refOf("https://www.tiktok.com/", host, "evil"), "tiktok", "a label that is not ours is ignored");
});

test("the Worker takes only a same-site POST of one allowed event, says whether it was stored, and refuses an overlay opening from a browser", async () => {
  const s = sink();
  const ok = await handleEvent(post('{"e":"visit","a":"home","b":"tiktok"}'), { EVENTS: s });
  assert.deepEqual([ok.status, ok.headers.get("x-counted")], [204, "yes"]);
  assert.deepEqual(s.points, [{ indexes: ["visit"], blobs: ["visit", "home", "tiktok", "", ""], doubles: [1] }]);
  const dropped = await handleEvent(post('{"e":"link_copied","a":"chat"}'), {});
  assert.deepEqual([dropped.status, dropped.headers.get("x-counted")], [204, "no"], "with no dataset it is checked and dropped, and says so");
  assert.equal((await handleEvent(new Request(`${SITE}/api/e`), { EVENTS: s })).status, 405);
  assert.equal((await handleEvent(post("{}", { origin: "https://evil.example" }), { EVENTS: s })).status, 403);
  assert.equal((await handleEvent(post("{}", { origin: "" }), { EVENTS: s })).status, 403, "no Origin: not one of our pages");
  assert.equal((await handleEvent(post('{"e":"visit","a":"x","b":"y"}'), { EVENTS: s })).status, 400);
  assert.equal((await handleEvent(post('{"e":"overlay_load","a":"chat","b":"live"}'), { EVENTS: s })).status, 400, "only the Worker counts an overlay opening");
  assert.equal((await handleEvent(post("x".repeat(300)), { EVENTS: s })).status, 413);
  assert.equal(s.points.length, 1, "nothing else was stored");
  const broken = { writeDataPoint() { throw new Error("down"); } };
  assert.equal((await handleEvent(post('{"e":"visit","a":"home","b":"direct"}'), { EVENTS: broken })).status, 204, "a counter that fails is no error for the page");
});

test("an overlay opening is counted and the page still comes back: the kind, real or practice, and a one-way code of the account that is not the name", async () => {
  const served = [];
  const assets = { fetch: async (request) => { served.push(new URL(request.url).pathname); return new Response("page"); } };
  const open = async (path, env = {}, headers = {}) => countOverlay(new Request(`${SITE}${path}`, { headers }), { ASSETS: assets, ...env });
  const s = sink();
  const env = { EVENTS: s, STATS_SALT: "pepper" };
  const res = await open("/overlay/alerts/?channel=Pond.Pal&platform=tiktok", env);
  assert.equal(await res.text(), "page", "the page is handed on as before");
  const point = s.points[0];
  assert.deepEqual(point.blobs.slice(0, 3), ["overlay_load", "alerts", "live"]);
  assert.match(point.blobs[3], /^[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(point).toLowerCase().includes("pond"), "the name is nowhere in what is written");
  assert.equal(point.blobs[3], await scramble("pepper", "tiktok:pond.pal"), "the same account always gives the same code (any capitals)");
  await open("/overlay/goal/?channel=pond.pal&platform=tiktok", env);
  assert.equal(s.points[1].blobs[3], point.blobs[3], "and the same code on another overlay, so one streamer counts once");
  await open("/overlay/?channel=pond.pal&platform=twitch", env);
  assert.notEqual(s.points[2].blobs[3], point.blobs[3], "a Twitch channel of that name is a different account");
  await open("/overlay/?tiktok=pond.pal&twitch=other", env);
  assert.equal(s.points[3].blobs[3], point.blobs[3], "both at once counts by the TikTok name");
  assert.notEqual(point.blobs[3], await scramble("another salt", "tiktok:pond.pal"), "the secret salt is part of it");
  await open("/overlay/songs/?demo=1&channel=pond.pal", env);
  assert.deepEqual(s.points[4].blobs, ["overlay_load", "songs", "demo", "", ""], "a practice overlay has no code, and is counted apart");
  await open("/overlay/likers/", env);
  assert.deepEqual(s.points[5].blobs.slice(0, 3), ["overlay_load", "likers", "demo"], "no account named: counted as practice");
  const before = s.points.length;
  await open("/overlay/alerts/?channel=pond.pal", { EVENTS: s });
  assert.deepEqual(s.points[before].blobs, ["overlay_load", "alerts", "live", "", ""], "without the salt the opening is counted but no code is made");
  await open("/overlay/alerts/?channel=pond.pal", env, { "sec-gpc": "1" });
  await open("/overlay/alerts/?channel=pond.pal", env, { dnt: "1" });
  assert.equal(s.points.length, before + 1, "Global Privacy Control and Do Not Track mean nothing is counted");
  await open("/overlay/nope/?channel=x", env);
  assert.equal(s.points.length, before + 1, "not an overlay page: not counted");
  const list = served.length;
  await open("/overlay/alerts/?channel=x", { EVENTS: { writeDataPoint() { throw new Error("down"); } } });
  assert.equal(served.length, list + 1, "a counter that fails still lets the overlay open");
});

const T = Date.UTC(2026, 10, 12, 15, 0, 0); // a Thursday afternoon, 12 November 2026
const day = (age) => new Date(Date.UTC(2026, 10, 12) - age * 86400000).toISOString().slice(0, 19).replace("T", " ");
const row = (ev, a, b, age, n) => ({ ev, a, b, d: day(age), n });

test("the report: visits, copies and overlays this week against the week before, where visits came from, and the other counts by name", () => {
  const s = summarize([
    row("visit", "home", "tiktok", 0, 10), row("visit", "editor", "reddit", 2, 5), row("visit", "home", "tiktok", 8, 6),
    row("link_copied", "chat", "tiktok", 1, 3), row("link_copied", "chat", "twitch", 1, 1), row("link_copied", "goal", "", 9, 8),
    row("overlay_load", "chat", "live", 3, 7), row("overlay_load", "chat", "demo", 3, 50), row("overlay_load", "alerts", "live", 10, 2),
    row("plus_interest", "remote_link", "editor", 2, 5),
    row("pro_click", "footer", "", 4, 3), row("visit", "home", "tiktok", 40, 99), // (older than 28 days: ignored)
  ], T);
  assert.deepEqual([s.visits.today, s.visits.yesterday, s.visits.week, s.visits.before, s.visits.total], [10, 0, 15, 6, 21]);
  assert.deepEqual(s.visits.sources, [{ label: "tiktok", n: 16 }, { label: "reddit", n: 5 }]);
  assert.deepEqual(s.visits.sourcesWeek, [{ label: "tiktok", n: 10 }, { label: "reddit", n: 5 }]);
  assert.deepEqual(s.visits.pages, [{ label: "home", n: 16 }, { label: "editor", n: 5 }]);
  assert.equal(s.visits.perDay.length, 28);
  assert.deepEqual(s.visits.perDay.at(-1), { day: "2026-11-12", n: 10 });
  assert.deepEqual([s.copies.today, s.copies.yesterday, s.copies.week, s.copies.before], [0, 4, 4, 8]);
  assert.deepEqual(s.copies.byPlatform, [{ label: "tiktok", n: 3 }, { label: "twitch", n: 1 }]);
  assert.deepEqual([s.loads.live.week, s.loads.live.before, s.loads.demo.week], [7, 2, 50], "practice openings are counted apart from real ones");
  assert.deepEqual(s.loads.byKind, [{ label: "chat", n: 7 }, { label: "alerts", n: 2 }]);
  assert.deepEqual(s.plus.byFeature, [{ label: "remote_link", n: 5 }]);
  assert.equal(Math.round(s.funnel.week.copyRate * 100), 27);
  assert.deepEqual(s.others, [{ label: "pro_click", n: 3 }]);
});

test("different overlays this week, how many came back from the week before, and the scorecard for Frills Plus", () => {
  const ids = [["a", 0], ["b", 1], ["c", 3], ["a", 2], ["a", 8], ["b", 9], ["d", 12], ["e", 20]].map(([id, age]) => ({ id, d: day(age) }));
  const a = activeOverlays(ids, T);
  assert.deepEqual([a.today, a.week, a.before, a.month, a.returning], [1, 3, 3, 5, 2], "a today; a, b, c this week; a, b, d the week before; two of the three are back");
  assert.equal(Math.round(a.returningRate * 100), 67);
  assert.equal(activeOverlays([], T).returningRate, null, "no earlier week yet");
  const card = scorecard({ copies: { week: 120 } }, { week: 60, returningRate: 0.3 });
  assert.deepEqual(card.map((r) => [r.id, r.ok]), [["overlays", true], ["returning", false], ["copies", true]]);
  assert.equal(card[1].value, "30%");
  assert.equal(scorecard({ copies: { week: 1 } }, { week: 0, returningRate: null })[1].value, "no earlier week yet");
  assert.deepEqual(TARGETS, { overlays: 50, returningRate: 0.4, copies: 100 });
});

test("the report asks Cloudflare for both sites with the owner's token, checks relay health, and one site failing does not hide the other", async () => {
  assert.deepEqual(await report({}, { now: T }), { ok: false, error: "not_set" });
  const asked = [];
  const cloudflare = async (url, init = {}) => {
    if (url.startsWith("https://relay.")) {
      return Response.json({ ok: true, name: "frills-relay", version: "0.5.9", free: 24, level: "ok", slots: { used: 6, max: 30, waiting: 0 }, uptimeS: 3600 });
    }
    asked.push({ url, token: init.headers?.authorization, query: init.body });
    if (init.body.includes(DATASETS.valwidgets)) return new Response("nope", { status: 400 });
    if (init.body.includes("blob4 AS id")) return Response.json({ data: [{ id: "a", d: day(0) }] });
    return Response.json({ data: [row("visit", "home", "tiktok", 0, 3), row("link_copied", "chat", "", 0, 1)] });
  };
  const out = await report({ CF_ACCOUNT_ID: "acct", CF_API_TOKEN: "tok" }, { now: T, fetchImpl: cloudflare });
  assert.equal(out.ok, true);
  assert.equal(out.frills.visits.week, 3);
  assert.equal(out.frills.active.week, 1);
  assert.equal(out.frills.scorecard.length, 3);
  assert.equal(out.relays.length, 1);
  assert.equal(out.relays[0].ok, true);
  assert.equal(out.relays[0].free, 24);
  assert.equal(out.gsc.configured, false);
  assert.deepEqual(out.valwidgets, { error: "unreadable", status: 400 }, "Tally's counts could not be read: said so, and Frills' still show");
  assert.ok(asked.every((q) => q.token === "Bearer tok" && q.url === "https://api.cloudflare.com/client/v4/accounts/acct/analytics_engine/sql"));
  assert.ok(asked.some((q) => q.query.includes(`FROM ${DATASETS.frills}`)) && asked.some((q) => q.query.includes(`FROM ${DATASETS.valwidgets}`)));
});

test("multi-relay status check and Google Search Console integration", async () => {
  assert.deepEqual(parseRelayUrls({ RELAY_URLS: "https://relay.valwidgets.live/, https://relay2.valwidgets.live " }), ["https://relay.valwidgets.live", "https://relay2.valwidgets.live"]);
  const relays = await checkRelays(
    { RELAY_URLS: "https://relay1.example,https://relay2.example" },
    {
      fetchImpl: async (url) => {
        if (url.startsWith("https://relay1.example")) return Response.json({ ok: true, version: "0.5.9", slots: { used: 10, max: 30, waiting: 2 } });
        return new Response("down", { status: 502 });
      },
    },
  );
  assert.equal(relays.length, 2);
  assert.deepEqual([relays[0].ok, relays[0].free, relays[0].slots.waiting], [true, 20, 2]);
  assert.deepEqual([relays[1].ok, relays[1].level], [false, "down"]);

  const gsc = await fetchGsc(
    { GSC_CLIENT_ID: "id", GSC_CLIENT_SECRET: "sec", GSC_REFRESH_TOKEN: "ref" },
    {
      now: T,
      fetchImpl: async (url, init) => {
        if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "gsc-tok" });
        const body = JSON.parse(init.body);
        if (body.dimensions?.[0] === "query") return Response.json({ rows: [{ keys: ["free tiktok overlay"], clicks: 12, impressions: 150, ctr: 0.08, position: 4.2 }] });
        if (body.dimensions?.[0] === "country") return Response.json({ rows: [{ keys: ["usa"], clicks: 8, impressions: 90, ctr: 0.088, position: 3.9 }] });
        return Response.json({ rows: [{ clicks: 25, impressions: 400, ctr: 0.0625, position: 5.1 }] });
      },
    },
  );
  assert.equal(gsc.configured, true);
  assert.equal(gsc.month.clicks, 25);
  assert.equal(gsc.queries[0].key, "free tiktok overlay");
  assert.equal(gsc.countries[0].key, "usa");
});

test("the stats come only through the admin password: none without it, none with a wrong one, and the report with the right one", async () => {
  const env = { DB: localDatabase(":memory:"), ADMIN_KEY: "k".repeat(16) };
  const get = (key) => handleAdmin(new Request(`${SITE}/api/admin/stats`, { headers: key ? { authorization: `Bearer ${key}` } : {} }), env, { now: T });
  assert.equal((await get("")).status, 401);
  assert.equal((await get("wrong-password-here")).status, 401);
  const ok = await get("k".repeat(16));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: false, error: "not_set" }, "right password, no Cloudflare secrets yet: it says so");
  const post = await handleAdmin(new Request(`${SITE}/api/admin/stats`, { method: "POST", headers: { authorization: `Bearer ${"k".repeat(16)}`, origin: SITE } }), env);
  assert.equal(post.status, 405);
});

// ── the country ───────────────────────────────────────────────────────────────────────────────────────

const inCountry = (country) => { const r = new Request(`${SITE}/x`); if (country !== undefined) r.cf = { country }; return r; };

test("the country is the two letters Cloudflare gives, in capitals, and nothing for 'unknown' or Tor or anything odd", () => {
  assert.equal(countryOf(inCountry("PH")), "PH");
  assert.equal(countryOf(inCountry("ph")), "PH");
  for (const odd of [undefined, "", "XX", "T1", "USA", "1", "P", "P H", null, 7]) assert.equal(countryOf(inCountry(odd)), "", String(odd));
  assert.equal(countryOf(new Request(`${SITE}/x`)), "", "a request with no Cloudflare details at all");
});

test("a visit and an overlay opening are counted with their country, and nothing else about where from", async () => {
  const assets = { fetch: async () => new Response("page") };
  const s = sink();
  const request = (path, country) => { const r = new Request(`${SITE}${path}`); r.cf = { country, city: "Manila", postalCode: "1000", latitude: "14.6", longitude: "121.0", colo: "MNL" }; return r; };
  await countOverlay(request("/overlay/alerts/?channel=pond.pal&platform=tiktok", "PH"), { ASSETS: assets, EVENTS: s, STATS_SALT: "pepper" });
  assert.equal(s.points[0].blobs[4], "PH");
  const posted = post('{"e":"visit","a":"home","b":"tiktok"}');
  posted.cf = { country: "US", city: "Austin", postalCode: "78701" };
  await handleEvent(posted, { EVENTS: s });
  assert.equal(s.points[1].blobs[4], "US");
  const written = JSON.stringify(s.points);
  for (const never of ["Manila", "Austin", "1000", "78701", "14.6", "MNL", "pond"]) assert.equal(written.includes(never), false, `${never} is nowhere in what is written`);
  assert.equal(s.points[0].blobs.length, 5, "the code, the kind, real or practice, the account's scrambled code, the country: five labels");
});

test("someone with Do Not Track is still not counted, country or not", async () => {
  const assets = { fetch: async () => new Response("page") };
  const s = sink();
  const r = new Request(`${SITE}/overlay/?channel=pond.pal`, { headers: { dnt: "1" } });
  r.cf = { country: "PH" };
  await countOverlay(r, { ASSETS: assets, EVENTS: s });
  assert.deepEqual(s.points, []);
});

const ROWS = (list) => list.map(([id, c, age]) => ({ id, c, d: day(age) }));

test("overlays by country: each overlay counts once, in the country it last opened from; the share Frills Plus would reach is of the ones whose country is known", () => {
  const out = overlaysByCountry(ROWS([["a", "US", 0], ["a", "PH", 3], ["b", "PH", 1], ["c", "PH", 2], ["d", "GB", 5], ["e", "", 1], ["f", "BR", 12], ["g", "US", 20], ["h", "", 40]]), T);
  assert.deepEqual(out.week, [{ label: "PH", n: 2 }, { label: "GB", n: 1 }, { label: "US", n: 1 }], "a is in the US (its latest opening), b and c in the Philippines, d in the UK; ties are in letter order");
  assert.deepEqual([out.weekKnown, out.weekUnknown], [4, 1], "e opened this week with no country recorded");
  assert.deepEqual([out.inPlus, out.plusRate], [2, 0.5], "the US and the UK are Plus countries, the Philippines is not: 2 of 4");
  assert.deepEqual(out.month.map((r) => [r.label, r.n]), [["PH", 2], ["US", 2], ["BR", 1], ["GB", 1]], "all 28 days: f (BR) and g (US) join in; h is older than 28 days and is not counted");
  assert.deepEqual([out.monthKnown, out.monthUnknown], [6, 1]);
});

test("overlays by country: with nothing recorded there is no share to give, and a damaged country is the same as none", () => {
  assert.equal(overlaysByCountry([], T).plusRate, null);
  assert.equal(overlaysByCountry(undefined, T).weekKnown, 0);
  const odd = overlaysByCountry(ROWS([["a", "usa", 0], ["b", "u", 0], ["c", null, 0], ["d", "us", 0]]), T);
  assert.deepEqual([odd.weekKnown, odd.weekUnknown, odd.plusRate], [0, 4, null], "only two capital letters are a country");
});

test("visits and copied links by country, this week and all 28 days, with the ones that have no country counted apart", () => {
  const rows = [
    { ev: "visit", c: "US", d: day(0), n: 20 }, { ev: "visit", c: "PH", d: day(1), n: 15 }, { ev: "visit", c: "PH", d: day(10), n: 30 }, { ev: "visit", c: "", d: day(1), n: 7 }, { ev: "visit", c: "US", d: day(40), n: 99 },
    { ev: "link_copied", c: "PH", d: day(1), n: 4 }, { ev: "plus_interest", c: "US", d: day(1), n: 9 },
  ];
  const out = eventsByCountry(rows, T);
  assert.deepEqual(out.visits.week, [{ label: "US", n: 20 }, { label: "PH", n: 15 }]);
  assert.deepEqual(out.visits.month, [{ label: "PH", n: 45 }, { label: "US", n: 20 }]);
  assert.deepEqual([out.visits.weekTotal, out.visits.monthTotal, out.visits.unknown], [35, 65, 7]);
  assert.deepEqual(out.copies.month, [{ label: "PH", n: 4 }], "only copied links, nothing else");
  assert.deepEqual(eventsByCountry([], T).visits, { week: [], month: [], weekTotal: 0, monthTotal: 0, unknown: 0 });
});

test("the report carries the countries, asks Cloudflare for them, and still works when the country question fails", async () => {
  const asked = [];
  const cloudflare = (failCountry) => async (url, init = {}) => {
    if (url.startsWith("https://relay.")) return Response.json({ ok: true, version: "0.5.9", free: 24, level: "ok", slots: { used: 6, max: 30, waiting: 0 }, uptimeS: 3600 });
    asked.push(init.body);
    if (init.body.includes(DATASETS.valwidgets)) return new Response("nope", { status: 400 });
    if (init.body.includes("blob4 AS id")) return Response.json({ data: [{ id: "a", c: "PH", d: day(0) }, { id: "b", c: "US", d: day(1) }] });
    if (init.body.includes("blob5 AS c")) return failCountry ? new Response("nope", { status: 400 }) : Response.json({ data: [{ ev: "visit", c: "PH", d: day(0), n: 5 }] });
    return Response.json({ data: [row("visit", "home", "tiktok", 0, 3)] });
  };
  const env = { CF_ACCOUNT_ID: "acct", CF_API_TOKEN: "tok" };
  const ok = await report(env, { now: T, fetchImpl: cloudflare(false) });
  assert.deepEqual(ok.frills.countries.overlays.week, [{ label: "PH", n: 1 }, { label: "US", n: 1 }]);
  assert.equal(ok.frills.countries.overlays.plusRate, 0.5);
  assert.deepEqual(ok.frills.countries.visits.week, [{ label: "PH", n: 5 }]);
  assert.ok(asked.some((q) => q.includes("blob5 AS c") && q.includes("blob1 IN ('visit', 'link_copied')")), "one question for visits and copies by country");
  assert.ok(asked.some((q) => q.includes("blob4 AS id") && q.includes("blob5 AS c")), "and the overlay question names the country too");
  const partial = await report(env, { now: T, fetchImpl: cloudflare(true) });
  assert.equal(partial.frills.visits.week, 3, "the rest of the report is unaffected");
  assert.deepEqual(partial.frills.countries.overlays.week.length, 2, "the overlays by country still show");
  assert.equal(partial.frills.countries.visits, undefined, "only the visits by country are missing");
});
