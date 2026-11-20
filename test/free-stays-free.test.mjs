// Free Frills stays free. Frills Plus gates exactly one thing: the AI voice (POST /api/tts, and the pass block of /api/pro/status that tells the editor what is left). These checks are a guard so
// nobody adds the gate to a free feature by accident: which files may use it, that the free overlays' scripts never touch the Plus routes, and that free routes answer a visitor who brought nothing.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import worker from "../worker/index.mjs";
import { localDatabase } from "../scripts/lib/d1-sqlite.mjs";

const root = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("only the AI voice route, the Plus relay ticket route, the status route and the gate itself use the Plus gate", () => {
  const using = readdirSync(join(root, "worker"))
    .filter((f) => f.endsWith(".mjs"))
    .filter((f) => /plusGate\b|resolveCredential\b|plus-gate|plus-credential/.test(read(join("worker", f))))
    .sort();
  assert.deepEqual(using, ["plus-credential.mjs", "plus-gate.mjs", "plus-relay.mjs", "region.mjs", "tts.mjs"], "a new file here means a new feature is gated: it must be a Plus feature, and this list changed on purpose");
});

test("no free overlay or free editor script calls a Plus route or sends a Plus code", () => {
  const free = readdirSync(join(root, "src", "js"))
    .filter((f) => f.endsWith(".js") && !/^(tts|account|plus-relay)/.test(f) && f !== "widget-editor.js" /* (hands the editors a save function, nothing about accounts) */)
    .sort();
  assert.ok(free.length > 40, "the scan sees the site's scripts");
  const offenders = free.filter((f) => /\/api\/tts|\/api\/account|\/api\/pro\/|\/api\/plus\/|x-overlay|plusGate/.test(read(join("src", "js", f))));
  assert.deepEqual(offenders, [], "these free scripts mention a Plus route");
});

test("the AI voice is the only thing the talking pet's own scripts send to a Plus route, and only with what the server says is allowed", () => {
  const audio = read("src/js/tts-audio.js");
  assert.equal((audio.match(/fetch\(\s*"\/api\/tts"/g) ?? []).length, 1, "one place asks for an AI voice");
  const before = audio.slice(0, audio.indexOf('fetch("/api/tts"'));
  assert.ok(before.includes("checkAiEligibility(settings)"), "and only after the server's status says it is allowed");
  assert.ok(audio.includes("speakBrowser(item.text, settings)"), "the free browser voice is always the fallback");
});

// ── free routes answer a visitor who brought nothing ─────────────────────────────────────────────────

const SITE = "https://frills.example";
const env = () => ({ DB: localDatabase(":memory:"), ASSETS: { fetch: async () => new Response("asset") } });
const get = async (path, e = env()) => {
  const res = await worker.fetch(new Request(`${SITE}${path}`), e, { waitUntil() {} });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test("free routes work for a visitor with no account, no code and no Plus", async () => {
  const e = env();
  const timer = await get("/api/timer/abcdefghij123456", e);
  assert.deepEqual([timer.status, timer.body.ok], [200, true], "the subathon timer's controls");
  const me = await get("/api/account/me", e);
  assert.deepEqual([me.status, me.body], [200, { ok: true, signedIn: false }], "asking who is signed in is free and says nobody");
  const status = await get("/api/pro/status", e);
  assert.equal(status.status, 200);
  assert.equal(status.body.pass, undefined, "the status route gives a free visitor no pass block and no error");
});

test("the AI voice is refused for a free visitor with a clear code, and refusing it breaks nothing else", async () => {
  const e = { ...env(), REQUIRE_PRO_PASS: "1", OPENAI_TTS_KEY: "sk-test" };
  const res = await worker.fetch(new Request(`${SITE}/api/tts`, { method: "POST", headers: { origin: SITE, "content-type": "application/json", "x-frills-country": "US" }, body: JSON.stringify({ text: "hello", voice: "nova" }) }), e, { waitUntil() {} });
  assert.deepEqual([res.status, (await res.json()).error], [401, "no_pass"]);
  assert.equal((await get("/api/timer/abcdefghij123456", e)).status, 200, "the free timer is unaffected");
});
