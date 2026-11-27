// Frills Plus cloud integration tests for Stream Outline:
//   - Saving/updating `kind: "outline"` cloud overlays
//   - Global 1-click theme sync applying matching look + artPack/frameStyle
//   - Master Scene `frame` full-bleed background slot parsing
//   - Phone Remote Deck live commands (`outline:next`, `outline:prev`, `outline:set`, `outline:reset`)

import test from "node:test";
import assert from "node:assert/strict";
import { COOKIE, handleAccount } from "../worker/account-routes.mjs";
import { applyThemeToQuery, handleCloudOverlays, parseSceneQuery } from "../worker/cloud-overlays.mjs";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";

const SITE = "https://frills.valwidgets.live";
const T0 = Date.parse("2026-12-01T12:00:00Z");
const DAY = 86_400_000;

async function signedInPlus(env, email) {
  const sent = [];
  const mailer = { send: async (m) => { sent.push(m); return { ok: true }; } };
  await handleAccount(new Request(`${SITE}/api/account/login`, { method: "POST", headers: { origin: SITE, "content-type": "application/json", "cf-connecting-ip": "203.0.113.11" }, body: JSON.stringify({ email }) }), env, { now: T0, mailer });
  const ver = await handleAccount(new Request(`${SITE}/api/account/verify`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: JSON.stringify({ token: /#([A-Za-z0-9_-]{43})/.exec(sent[0].text)[1] }) }), env, { now: T0 + 1000 });
  const id = env.DB.raw.prepare("SELECT id FROM accounts WHERE email = ?").get(email).id;
  const cookie = `${COOKIE}=${/frills_session=([^;]*)/.exec(ver.headers.get("set-cookie"))[1]}`;
  env.DB.raw.prepare("INSERT INTO plus (account_id, provider_ref, order_ref, status, renews_at, tts_used, tts_limit, period_start, updated_at) VALUES (?, 'sub_ol', 'ord_ol', 'active', ?, 0, 150000, ?, ?)").run(id, T0 + 30 * DAY, T0, T0);
  return { id, cookie };
}

test("Stream Outline cloud overlay: CRUD, global theme sync, Master Scene `frame` slot, and remote agenda commands", async () => {
  const env = { DB: localDatabase(":memory:") };
  const plus = await signedInPlus(env, "outline-plus@example.com");

  // 1. Create an outline cloud preset (Plus frame style + orbit motion + 6 segments)
  const createRes = await handleCloudOverlays(new Request(`${SITE}/api/cloud-overlays`, {
    method: "POST",
    headers: { origin: SITE, cookie: plus.cookie, "content-type": "application/json" },
    body: JSON.stringify({
      kind: "outline",
      name: "Main 16:9 Cyber Frame",
      query: "mode=screen16x9&frameStyle=cyber&motion=orbit&agendaStyle=quest",
    }),
  }), env, { now: T0 + 2000 });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.equal(created.overlay.kind, "outline");
  assert.equal(created.overlay.path, "/overlay/outline/");
  const outlineId = created.overlay.id;

  // 2. Master Scene accepts the new full-bleed `frame` slot
  const sceneParsed = parseSceneQuery(`aspect=16x9&items=${outlineId}:frame`);
  assert.deepEqual(sceneParsed, { aspect: "16x9", items: [{ id: outlineId, slot: "frame" }] });

  // 3. Global 1-click theme sync updates look AND matching artPack / frameStyle for outline
  const themedMatcha = applyThemeToQuery("outline", created.overlay.query, "matcha");
  assert.ok(themedMatcha.includes("look=matcha"));
  assert.ok(themedMatcha.includes("artPack=frog2"));
  const themedArcade = applyThemeToQuery("outline", created.overlay.query, "arcade");
  assert.ok(themedArcade.includes("frameStyle=pixel"));

  // 4. Phone Remote Deck commands advance and reset Stream Outline segments
  for (const [action, value] of [["outline:next", 0], ["outline:prev", 0], ["outline:set", 3], ["outline:reset", 0]]) {
    const cmdRes = await handleCloudOverlays(new Request(`${SITE}/api/cloud-overlays/${outlineId}/cmd`, {
      method: "POST",
      headers: { origin: SITE, cookie: plus.cookie, "content-type": "application/json" },
      body: JSON.stringify({ action, value }),
    }), env, { now: T0 + 3000 });
    assert.equal(cmdRes.status, 200, `${action} accepted`);
    const body = await cmdRes.json();
    assert.equal(body.action, action);
  }

  // 5. Public /api/o/:id returns the queued outline commands cleanly
  const poll = await (await handleCloudOverlays(new Request(`${SITE}/api/o/${outlineId}?c=0`), env, { now: T0 + 4000 })).json();
  assert.equal(poll.ok, true);
  assert.equal(poll.kind, "outline");
  assert.equal(poll.cmds.length, 4);
  assert.equal(poll.cmds[0].cmd, "outline:next");
  assert.equal(poll.cmds[2].value, 3);
});
