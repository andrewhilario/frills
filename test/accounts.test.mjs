// The Frills Plus account storage (worker/accounts.mjs) over a real in-memory SQLite database with the real schema: what an email may look like, that a sign-in link works
// once and only for 15 minutes, that nothing secret is stored as it was given, how many links one email or address may ask for, sessions, and deleting an account.

import test from "node:test";
import assert from "node:assert/strict";
import { LIMITS, createLoginLink, deleteAccount, endAllSessions, endSession, getPlus, normalizeEmail, sessionAccount, sweep, useLoginLink } from "../worker/accounts.mjs";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";

const T0 = 1_800_000_000_000;
const fresh = () => localDatabase(":memory:");
const count = (db, table) => db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const signIn = async (db, email = "streamer@example.com", now = T0) => {
  const link = await createLoginLink(db, email, { now, ip: "203.0.113.7" });
  return useLoginLink(db, link.token, { now: now + 1000 });
};

test("an email is trimmed and lower-cased, and anything that cannot be an address is refused", () => {
  assert.equal(normalizeEmail("  Streamer@Example.COM "), "streamer@example.com");
  assert.equal(normalizeEmail("a.b+tag@sub.example.co.uk"), "a.b+tag@sub.example.co.uk");
  for (const bad of ["", "nope", "a@b", "a@@b.com", "a b@example.com", "a@exa mple.com", "<a>@example.com", "a@example..com", ".a@example.com", "a.@example.com", "a..b@example.com", "a@-example.com", "a@example.com\nbcc:x@y.com", "x".repeat(250) + "@example.com", null, undefined, 42, {}]) {
    assert.equal(normalizeEmail(bad), null, JSON.stringify(bad));
  }
});

test("the schema can be run twice (it is pasted into the console, and may be run again)", () => {
  const db = fresh();
  db.raw.exec(`CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, last_login_at INTEGER NOT NULL);`);
  assert.equal(count(db, "accounts"), 0);
});

test("a sign-in link works once: the first use signs in, a second use or a changed token does not", async () => {
  const db = fresh();
  const link = await createLoginLink(db, "Streamer@Example.com", { now: T0, ip: "203.0.113.7" });
  assert.equal(link.ok, true);
  assert.equal(link.email, "streamer@example.com");
  assert.match(link.token, /^[A-Za-z0-9_-]{43}$/);
  const first = await useLoginLink(db, link.token, { now: T0 + 5000 });
  assert.deepEqual([first.ok, first.created, first.email], [true, true, "streamer@example.com"]);
  assert.match(first.accountId, /^[0-9a-f]{16}$/);
  assert.deepEqual(await useLoginLink(db, link.token, { now: T0 + 6000 }), { ok: false, error: "invalid_link" }, "spent");
  const swapped = link.token.slice(0, -1) + (link.token.endsWith("A") ? "B" : "A");
  assert.deepEqual(await useLoginLink(db, swapped, { now: T0 + 6000 }), { ok: false, error: "invalid_link" }, "one character different");
  for (const bad of ["", "short", null, undefined, 7, "x".repeat(43), " ".repeat(43)]) assert.equal((await useLoginLink(db, bad, { now: T0 })).error, "invalid_link", JSON.stringify(bad));
});

test("a link is good for 15 minutes, to the second", async () => {
  const db = fresh();
  const link = await createLoginLink(db, "streamer@example.com", { now: T0 });
  assert.equal(link.expiresAt, T0 + LIMITS.linkMs);
  assert.equal((await useLoginLink(db, link.token, { now: T0 + LIMITS.linkMs })).ok, false, "at the moment it ends it is already over");
  const second = await createLoginLink(db, "streamer@example.com", { now: T0 });
  assert.equal((await useLoginLink(db, second.token, { now: T0 + LIMITS.linkMs - 1 })).ok, true, "one millisecond before it ends");
});

test("two uses at the same moment: exactly one wins (and one account is made)", async () => {
  const db = fresh();
  const link = await createLoginLink(db, "streamer@example.com", { now: T0 });
  const [a, b] = await Promise.all([useLoginLink(db, link.token, { now: T0 + 10 }), useLoginLink(db, link.token, { now: T0 + 10 })]);
  assert.equal([a, b].filter((x) => x.ok).length, 1);
  assert.equal(count(db, "accounts"), 1);
  assert.equal(count(db, "sessions"), 1);
});

test("the same email is the same account every time, whatever its capitals, and only a first sign-in says created", async () => {
  const db = fresh();
  const one = await signIn(db, "Streamer@Example.com", T0);
  const two = await signIn(db, "streamer@example.COM", T0 + 60000);
  assert.equal(one.accountId, two.accountId);
  assert.deepEqual([one.created, two.created], [true, false]);
  assert.equal(count(db, "accounts"), 1);
  assert.equal(db.raw.prepare("SELECT last_login_at AS t FROM accounts").get().t, T0 + 61000, "the last sign-in is noted");
  const other = await signIn(db, "someone.else@example.com", T0);
  assert.notEqual(other.accountId, one.accountId);
});

test("no secret is stored as it was given: a copy of the database cannot sign anyone in", async () => {
  const db = fresh();
  const link = await createLoginLink(db, "streamer@example.com", { now: T0, ip: "203.0.113.7", salt: "pepper" });
  const session = await useLoginLink(db, link.token, { now: T0 + 1 });
  const everything = JSON.stringify(["accounts", "login_links", "sessions", "plus"].map((t) => db.raw.prepare(`SELECT * FROM ${t}`).all()));
  assert.equal(everything.includes(link.token), false, "the link's token");
  assert.equal(everything.includes(session.sessionToken), false, "the session's value");
  assert.equal(everything.includes("203.0.113.7"), false, "the internet address");
  assert.equal((await useLoginLink(db, db.raw.prepare("SELECT token_hash AS h FROM login_links").get().h, { now: T0 })).ok, false, "the stored hash is not a usable token");
  assert.equal(await sessionAccount(db, db.raw.prepare("SELECT token_hash AS h FROM sessions").get().h, { now: T0 }), null, "nor is the stored session hash");
});

test("one email may ask for 5 links an hour and one address for 20, and the window slides", async () => {
  const db = fresh();
  for (let i = 0; i < LIMITS.perEmail; i++) assert.equal((await createLoginLink(db, "streamer@example.com", { now: T0 + i * 1000, ip: `198.51.100.${i}` })).ok, true);
  assert.deepEqual(await createLoginLink(db, "streamer@example.com", { now: T0 + 6000, ip: "198.51.100.99" }), { ok: false, error: "rate_limited" });
  assert.equal((await createLoginLink(db, "STREAMER@example.com", { now: T0 + 7000, ip: "198.51.100.99" })).error, "rate_limited", "capitals do not make it a new email");
  assert.equal((await createLoginLink(db, "other@example.com", { now: T0 + 7000, ip: "198.51.100.99" })).ok, true, "another email is not held back");
  assert.equal((await createLoginLink(db, "streamer@example.com", { now: T0 + LIMITS.windowMs + 1000, ip: "198.51.100.99" })).ok, true, "an hour later it is fine again");

  const byIp = fresh();
  for (let i = 0; i < LIMITS.perIp; i++) assert.equal((await createLoginLink(byIp, `person${i}@example.com`, { now: T0 + i, ip: "203.0.113.9" })).ok, true);
  assert.equal((await createLoginLink(byIp, "one.more@example.com", { now: T0 + 100, ip: "203.0.113.9" })).error, "rate_limited");
  assert.equal((await createLoginLink(byIp, "one.more@example.com", { now: T0 + 100, ip: "203.0.113.10" })).ok, true, "another address is fine");
});

test("a refused or invalid request keeps nothing", async () => {
  const db = fresh();
  assert.deepEqual(await createLoginLink(db, "not an email", { now: T0 }), { ok: false, error: "bad_email" });
  assert.equal(count(db, "login_links"), 0);
});

test("a session knows its account, ends when it is signed out or old, and a sign-out only ends that browser", async () => {
  const db = fresh();
  const a = await signIn(db, "streamer@example.com", T0);
  const b = await signIn(db, "streamer@example.com", T0 + 1000);
  assert.deepEqual(await sessionAccount(db, a.sessionToken, { now: T0 + 5000 }), { accountId: a.accountId, email: "streamer@example.com" });
  assert.equal(await sessionAccount(db, "x".repeat(43), { now: T0 }), null);
  assert.equal(await sessionAccount(db, undefined, { now: T0 }), null);
  await endSession(db, a.sessionToken);
  assert.equal(await sessionAccount(db, a.sessionToken, { now: T0 + 5000 }), null, "signed out");
  assert.notEqual(await sessionAccount(db, b.sessionToken, { now: T0 + 5000 }), null, "the other browser is still in");
  assert.equal(await sessionAccount(db, b.sessionToken, { now: T0 + 2000 + LIMITS.sessionMs }), null, "30 days after it began it is over");
  assert.equal(count(db, "sessions"), 0, "and an old one is removed when it is found");
});

test("signing out everywhere ends every browser of that account and no other", async () => {
  const db = fresh();
  const a1 = await signIn(db, "streamer@example.com", T0);
  const a2 = await signIn(db, "streamer@example.com", T0 + 1000);
  const other = await signIn(db, "other@example.com", T0);
  await endAllSessions(db, a1.accountId);
  assert.equal(await sessionAccount(db, a1.sessionToken, { now: T0 + 5000 }), null);
  assert.equal(await sessionAccount(db, a2.sessionToken, { now: T0 + 5000 }), null);
  assert.notEqual(await sessionAccount(db, other.sessionToken, { now: T0 + 5000 }), null);
});

test("what an account bought is read by its id, and an account that bought nothing has nothing", async () => {
  const db = fresh();
  const a = await signIn(db, "streamer@example.com", T0);
  assert.equal(await getPlus(db, a.accountId), null);
  db.raw.prepare("INSERT INTO plus (account_id, provider_ref, status, renews_at, tts_used, tts_limit, period_start, updated_at) VALUES (?, 'sub_1', 'active', ?, 3, 1500, ?, ?)").run(a.accountId, T0 + 30 * 86400000, T0, T0);
  const plus = await getPlus(db, a.accountId);
  assert.deepEqual([plus.status, plus.tts_used, plus.tts_limit], ["active", 3, 1500]);
});

test("deleting an account removes its sessions, its links, and what it bought, and nobody else's", async () => {
  const db = fresh();
  const a = await signIn(db, "streamer@example.com", T0);
  const keep = await signIn(db, "other@example.com", T0);
  db.raw.prepare("INSERT INTO plus (account_id, provider_ref, status, renews_at, tts_used, tts_limit, period_start, updated_at) VALUES (?, 'sub_1', 'active', NULL, 0, 1500, ?, ?)").run(a.accountId, T0, T0);
  assert.equal(await deleteAccount(db, a.accountId), true);
  assert.equal(await sessionAccount(db, a.sessionToken, { now: T0 + 5000 }), null);
  assert.equal(await getPlus(db, a.accountId), null);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM accounts WHERE email = 'streamer@example.com'").get().n, 0);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM login_links WHERE email = 'streamer@example.com'").get().n, 0);
  assert.notEqual(await sessionAccount(db, keep.sessionToken, { now: T0 + 5000 }), null, "the other account is untouched");
  assert.equal(await deleteAccount(db, a.accountId), false, "already gone");
});

test("the sweep removes ended sessions and day-old links, and nothing that is still in use", async () => {
  const db = fresh();
  const old = await signIn(db, "old@example.com", T0);
  const later = T0 + LIMITS.sessionMs + 1000;
  const live = await signIn(db, "live@example.com", later);
  await sweep(db, { now: later + 2000 });
  assert.equal(await sessionAccount(db, old.sessionToken, { now: later + 2000 }), null);
  assert.notEqual(await sessionAccount(db, live.sessionToken, { now: later + 2000 }), null);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM login_links WHERE email = 'old@example.com'").get().n, 0, "the old link row is gone");
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM login_links WHERE email = 'live@example.com'").get().n, 1, "the recent one stays (it is part of the rate limit)");
});

test("there is room for only so many accounts", async () => {
  const db = fresh();
  const was = LIMITS.accounts;
  LIMITS.accounts = 1;
  try {
    assert.equal((await signIn(db, "one@example.com", T0)).ok, true);
    assert.equal((await signIn(db, "two@example.com", T0)).error, "full");
    assert.equal((await signIn(db, "one@example.com", T0 + 5000)).ok, true, "an account that exists can still sign in");
  } finally { LIMITS.accounts = was; }
});
