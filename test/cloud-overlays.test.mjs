// Live-updating Frills Plus cloud overlays tests (worker/cloud-overlays.mjs + worker/index.mjs + worker/accounts.mjs):
//   - Auth & Plus gating (401 signed out, 403 non-Plus, 403 cross-origin CSRF, 404 cross-account isolation)
//   - Strict input validation (kind allowlist, query sanitization, server-derived paths)
//   - Public OBS polling endpoint (GET /api/o/:id & ?v=<n> unchanged optimization + live version bump)
//   - Account deletion cascade removes cloud_overlays rows
//   - Worker /o/<id> shell routing with no-store & noindex headers

import test from "node:test";
import assert from "node:assert/strict";
import { COOKIE, handleAccount } from "../worker/account-routes.mjs";
import { cleanOverlayQuery, cloudHostIdFromPath, handleCloudOverlays } from "../worker/cloud-overlays.mjs";
import { deleteAccount } from "../worker/accounts.mjs";
import worker from "../worker/index.mjs";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";

const SITE = "https://frills.valwidgets.live";
const T0 = Date.parse("2026-12-01T12:00:00Z");
const DAY = 86_400_000;

async function signedIn(env, email, withPlus = false) {
  const sent = [];
  const mailer = { send: async (m) => { sent.push(m); return { ok: true }; } };
  await handleAccount(new Request(`${SITE}/api/account/login`, { method: "POST", headers: { origin: SITE, "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify({ email }) }), env, { now: T0, mailer });
  const ver = await handleAccount(new Request(`${SITE}/api/account/verify`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: JSON.stringify({ token: /#([A-Za-z0-9_-]{43})/.exec(sent[0].text)[1] }) }), env, { now: T0 + 1000 });
  const id = env.DB.raw.prepare("SELECT id FROM accounts WHERE email = ?").get(email).id;
  const cookie = `${COOKIE}=${/frills_session=([^;]*)/.exec(ver.headers.get("set-cookie"))[1]}`;
  if (withPlus) {
    env.DB.raw.prepare("INSERT INTO plus (account_id, provider_ref, order_ref, status, renews_at, tts_used, tts_limit, period_start, updated_at) VALUES (?, 'sub_1', 'ord_1', 'active', ?, 0, 150000, ?, ?)").run(id, T0 + 30 * DAY, T0, T0);
  }
  return { id, cookie };
}

test("cleanOverlayQuery strips ephemeral host params and rejects fragments/control chars", () => {
  assert.equal(cleanOverlayQuery("?channel=alice&look=frost&_cv=3&cloud=abc123def456&loaded=1"), "channel=alice&look=frost");
  assert.equal(cleanOverlayQuery("channel=alice#evil"), null);
  assert.equal(cleanOverlayQuery("channel=alice\nX-Inject: 1"), null);
  assert.equal(cleanOverlayQuery(""), null);
  assert.equal(cloudHostIdFromPath("/o/AbCd1234_-Xy"), "AbCd1234_-Xy");
  assert.equal(cloudHostIdFromPath("/o/AbCd1234_-Xy/"), "AbCd1234_-Xy");
  assert.equal(cloudHostIdFromPath("/o/short"), "");
  assert.equal(cloudHostIdFromPath("/o/../../etc"), "");
});

test("cloud overlays CRUD, Plus gating, CSRF, cross-account isolation, OBS polling & account delete cascade", async () => {
  const env = { DB: localDatabase(":memory:") };
  const free = await signedIn(env, "free@example.com", false);
  const plusA = await signedIn(env, "plus-a@example.com", true);
  const plusB = await signedIn(env, "plus-b@example.com", true);

  // 1. Signed-out cannot list or create (and reports Tier-1 region eligibility for subtle in-editor tips)
  const outRes = await handleCloudOverlays(new Request(`${SITE}/api/cloud-overlays`), env, { now: T0 + 2000 });
  assert.equal(outRes.status, 401);
  const phReq = new Request(`${SITE}/api/cloud-overlays`, { headers: { "cf-connecting-ip": "198.51.100.8" } });
  Object.defineProperty(phReq, "cf", { value: { country: "PH" }, configurable: true });
  assert.equal((await (await handleCloudOverlays(phReq, env, { now: T0 + 2000 })).json()).eligible, false);
  const usReq = new Request(`${SITE}/api/cloud-overlays`, { headers: { "cf-connecting-ip": "198.51.100.8" } });
  Object.defineProperty(usReq, "cf", { value: { country: "US" }, configurable: true });
  assert.equal((await (await handleCloudOverlays(usReq, env, { now: T0 + 2000 })).json()).eligible, true);

  // 2. Non-Plus account gets plusActive: false on list and 403 plus_required on create
  const freeList = await (await handleCloudOverlays(new Request(`${SITE}/api/cloud-overlays`, { headers: { cookie: free.cookie } }), env, { now: T0 + 2000 })).json();
  assert.equal(freeList.ok, true);
  assert.equal(freeList.plusActive, false);
  const freeCreate = await handleCloudOverlays(new Request(`${SITE}/api/cloud-overlays`, {
    method: "POST",
    headers: { origin: SITE, cookie: free.cookie, "content-type": "application/json" },
    body: JSON.stringify({ kind: "chat", name: "Main", query: "channel=alice&look=frost" }),
  }), env, { now: T0 + 2000 });
  assert.equal(freeCreate.status, 403);
  assert.equal((await freeCreate.json()).error, "plus_required");

  // 3. Cross-origin CSRF blocked even for active Plus
  const csrf = await handleCloudOverlays(new Request(`${SITE}/api/cloud-overlays`, {
    method: "POST",
    headers: { origin: "https://evil.example", cookie: plusA.cookie, "content-type": "application/json" },
    body: JSON.stringify({ kind: "chat", name: "Main", query: "channel=alice" }),
  }), env, { now: T0 + 2000 });
  assert.equal(csrf.status, 403);

  // 4. Invalid kind rejected
  const badKind = await handleCloudOverlays(new Request(`${SITE}/api/cloud-overlays`, {
    method: "POST",
    headers: { origin: SITE, cookie: plusA.cookie, "content-type": "application/json" },
    body: JSON.stringify({ kind: "evil", name: "Bad", query: "channel=alice" }),
  }), env, { now: T0 + 2000 });
  assert.equal(badKind.status, 400);

  // 5. Plus A creates a live cloud overlay
  const createdRes = await handleCloudOverlays(new Request(`${SITE}/api/cloud-overlays`, {
    method: "POST",
    headers: { origin: SITE, cookie: plusA.cookie, "content-type": "application/json" },
    body: JSON.stringify({ kind: "chat", name: "  Main Stream Chat  ", query: "platform=tiktok&channel=mochi&look=frost" }),
  }), env, { now: T0 + 3000 });
  assert.equal(createdRes.status, 201);
  const { overlay } = await createdRes.json();
  assert.match(overlay.id, /^[A-Za-z0-9_-]{12}$/);
  assert.equal(overlay.name, "Main Stream Chat");
  assert.equal(overlay.path, "/overlay/");
  assert.equal(overlay.version, 1);
  assert.equal(overlay.liveUrl, `${SITE}/o/${overlay.id}`);
  assert.equal(overlay.editUrl, `/editor/?cloud=${overlay.id}`);

  // 6. Public OBS endpoint works without cookies and supports fast ?v= unchanged check
  const obs1 = await (await handleCloudOverlays(new Request(`${SITE}/api/o/${overlay.id}`), env, { now: T0 + 4000 })).json();
  assert.equal(obs1.ok, true);
  assert.equal(obs1.version, 1);
  assert.equal(obs1.changed, true);
  assert.equal(obs1.url, "/overlay/?platform=tiktok&channel=mochi&look=frost");

  const obsSame = await (await handleCloudOverlays(new Request(`${SITE}/api/o/${overlay.id}?v=1`), env, { now: T0 + 5000 })).json();
  assert.deepEqual(obsSame, { ok: true, id: overlay.id, version: 1, changed: false, cmds: [], cmdSeq: 0 });

  // 7. Plus B cannot read, edit, or delete Plus A's overlay
  assert.equal((await handleCloudOverlays(new Request(`${SITE}/api/cloud-overlays/${overlay.id}`, { headers: { cookie: plusB.cookie } }), env, { now: T0 + 6000 })).status, 404);
  assert.equal((await handleCloudOverlays(new Request(`${SITE}/api/cloud-overlays/${overlay.id}`, {
    method: "PUT",
    headers: { origin: SITE, cookie: plusB.cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "Hijack", query: "channel=evil" }),
  }), env, { now: T0 + 6000 })).status, 404);
  assert.equal((await handleCloudOverlays(new Request(`${SITE}/api/cloud-overlays/${overlay.id}`, {
    method: "DELETE",
    headers: { origin: SITE, cookie: plusB.cookie },
  }), env, { now: T0 + 6000 })).status, 404);

  // 8. Plus A updates the overlay -> version bumps to 2 and OBS poll immediately sees changed: true
  const updRes = await handleCloudOverlays(new Request(`${SITE}/api/cloud-overlays/${overlay.id}`, {
    method: "PUT",
    headers: { origin: SITE, cookie: plusA.cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "Cozy Night Chat", query: "platform=tiktok&channel=mochi&look=night" }),
  }), env, { now: T0 + 7000 });
  assert.equal(updRes.status, 200);
  const upd = (await updRes.json()).overlay;
  assert.equal(upd.version, 2);
  assert.equal(upd.name, "Cozy Night Chat");

  const obsUpdated = await (await handleCloudOverlays(new Request(`${SITE}/api/o/${overlay.id}?v=1`), env, { now: T0 + 8000 })).json();
  assert.equal(obsUpdated.changed, true);
  assert.equal(obsUpdated.version, 2);
  assert.equal(obsUpdated.url, "/overlay/?platform=tiktok&channel=mochi&look=night");

  // 8b. Remote phone/browser Subathon Timer controls (/api/cloud-overlays/:id/timer) enqueue commands in timer_commands
  const timerCreate = await handleCloudOverlays(new Request(`${SITE}/api/cloud-overlays`, {
    method: "POST",
    headers: { origin: SITE, cookie: plusA.cookie, "content-type": "application/json" },
    body: JSON.stringify({ kind: "timer", name: "Twitch Subathon", query: "platform=twitch&channel=mochi_tv&startMinutes=120" }),
  }), env, { now: T0 + 7500 });
  assert.equal(timerCreate.status, 201);
  const timerOverlay = (await timerCreate.json()).overlay;
  const cmdRes = await handleCloudOverlays(new Request(`${SITE}/api/cloud-overlays/${timerOverlay.id}/timer`, {
    method: "POST",
    headers: { origin: SITE, cookie: plusA.cookie, "content-type": "application/json" },
    body: JSON.stringify({ cmd: "add", value: 300 }),
  }), env, { now: T0 + 7600 });
  assert.equal(cmdRes.status, 200);
  const cmdData = await cmdRes.json();
  assert.equal(cmdData.ok, true);
  assert.equal(cmdData.seq, 1);
  assert.equal(cmdData.cmd, "add");
  assert.equal(cmdData.value, 300);
  assert.match(cmdData.code, /^[A-Za-z0-9_-]{16}$/);

  // 8c. Global Theme Sync (POST /api/cloud-overlays/theme) updates all saved overlays & bumps versions
  const themeRes = await handleCloudOverlays(new Request(`${SITE}/api/cloud-overlays/theme`, {
    method: "POST",
    headers: { origin: SITE, cookie: plusA.cookie, "content-type": "application/json" },
    body: JSON.stringify({ theme: "neko" }),
  }), env, { now: T0 + 7700 });
  assert.equal(themeRes.status, 200);
  const themeData = await themeRes.json();
  assert.equal(themeData.ok, true);
  assert.equal(themeData.updated, 2);

  // 8d. Live Phone Stream Deck commands (/api/cloud-overlays/:id/cmd) & crash-proof state checkpoint (POST /api/o/:id)
  const deckRes = await handleCloudOverlays(new Request(`${SITE}/api/cloud-overlays/${overlay.id}/cmd`, {
    method: "POST",
    headers: { origin: SITE, cookie: plusA.cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "tts:say", text: "Be right back in 2 minutes!" }),
  }), env, { now: T0 + 7800 });
  assert.equal(deckRes.status, 200);
  assert.equal((await deckRes.json()).seq, 1);

  const largeBoard = JSON.stringify(Array.from({ length: 45 }, (_, i) => ({ user: `u${i}`, name: `Supporter ${i}`, avatar: "", diamonds: 1000 - i, subgifts: 2, bits: 100 })));
  const stateRes = await handleCloudOverlays(new Request(`${SITE}/api/o/${overlay.id}`, {
    method: "POST",
    headers: { origin: SITE, "content-type": "application/json" },
    body: JSON.stringify({ state: { "frills:jar:mochi": "{\"total\":450,\"target\":1000}", "frills:gifters:twitch:mochi_tv:m:2026-11": largeBoard } }),
  }), env, { now: T0 + 7900 });
  assert.equal(stateRes.status, 200);

  const resetDeck = await handleCloudOverlays(new Request(`${SITE}/api/cloud-overlays/${overlay.id}/cmd`, {
    method: "POST",
    headers: { origin: SITE, cookie: plusA.cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "gifters:reset", value: 0 }),
  }), env, { now: T0 + 7920 });
  assert.equal(resetDeck.status, 200);

  const pollCmds = await (await handleCloudOverlays(new Request(`${SITE}/api/o/${overlay.id}?c=0`), env, { now: T0 + 7950 })).json();
  assert.equal(pollCmds.cmdSeq, 2);
  assert.equal(pollCmds.cmds[0].cmd, "tts:say:Be right back in 2 minutes!");
  assert.equal(pollCmds.cmds[1].cmd, "gifters:reset");
  assert.equal(pollCmds.state["frills:jar:mochi"], "{\"total\":450,\"target\":1000}");
  assert.equal(pollCmds.state["frills:gifters:twitch:mochi_tv:m:2026-11"], largeBoard);

  // 9. Graceful fallback: if Plus A's subscription expires, /api/o/:id STILL serves the last saved overlay so OBS never breaks, while edits are blocked
  env.DB.raw.prepare("UPDATE plus SET status = 'expired', renews_at = ? WHERE account_id = ?").run(T0, plusA.id);
  const obsAfterCancel = await (await handleCloudOverlays(new Request(`${SITE}/api/o/${overlay.id}`), env, { now: T0 + 9000 })).json();
  assert.equal(obsAfterCancel.ok, true);
  assert.match(obsAfterCancel.url, /^\/overlay\/\?platform=tiktok&channel=mochi&look=bubblegum&deco=neko&tag=pill$/);
  const editAfterCancel = await handleCloudOverlays(new Request(`${SITE}/api/cloud-overlays/${overlay.id}`, {
    method: "PUT",
    headers: { origin: SITE, cookie: plusA.cookie, "content-type": "application/json" },
    body: JSON.stringify({ query: "platform=tiktok&channel=mochi&look=frost" }),
  }), env, { now: T0 + 9000 });
  assert.equal(editAfterCancel.status, 403);

  // 10. Deleting Plus A removes its cloud overlays completely
  await deleteAccount(env.DB, plusA.id);
  assert.equal((await handleCloudOverlays(new Request(`${SITE}/api/o/${overlay.id}`), env, { now: T0 + 10000 })).status, 404);
});

test("Worker serves /o/<id> shell with noindex & no-store and returns 404 for malformed /o/ paths", async () => {
  const assets = {
    fetch: async (req) => {
      const p = new URL(req.url).pathname;
      return new Response(p === "/o/index.html" ? "<div id=cloud-root></div>" : "Not found", { status: 200, headers: { "content-type": "text/html" } });
    },
  };
  const env = { ASSETS: assets };
  const ok = await worker.fetch(new Request(`${SITE}/o/AbCd1234_-Xy`), env, {});
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  assert.equal(ok.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(await ok.text(), "<div id=cloud-root></div>");

  const bad = await worker.fetch(new Request(`${SITE}/o/not-valid`), env, {});
  assert.equal(bad.status, 404);
});
