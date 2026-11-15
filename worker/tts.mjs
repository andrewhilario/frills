// AI voice synthesis endpoint (POST /api/tts) for Frills Plus: an overlay link's code or a signed-in browser (the one gate, plus-gate.mjs), the region rule (region.mjs) and the account's monthly credits.
// Calls OpenAI Speech, Google Cloud TTS, or Groq Orpheus from the Worker so keys stay server-side and CSP stays strict.

import { json, regionOf } from "./region.mjs";
import { plusGate, spendCredit } from "./plus-gate.mjs";
import { resolveCredential } from "./plus-credential.mjs";

export const ALLOWED_VOICES = new Set(["alloy", "nova", "shimmer", "echo", "onyx", "fable"]);
export const TTS_LIMITS = { maxBody: 2048, maxChars: 220, minRate: 0.7, maxRate: 1.5 };

const GOOGLE_VOICE_MAP = {
  alloy: { name: "en-US-Neural2-F", ssmlGender: "FEMALE" },
  nova: { name: "en-US-Neural2-H", ssmlGender: "FEMALE" },
  shimmer: { name: "en-US-Neural2-C", ssmlGender: "FEMALE" },
  echo: { name: "en-US-Neural2-D", ssmlGender: "MALE" },
  onyx: { name: "en-US-Neural2-A", ssmlGender: "MALE" },
  fable: { name: "en-GB-Neural2-B", ssmlGender: "MALE" },
};

export const GROQ_VOICE_MAP = {
  nova: "autumn",
  shimmer: "diana",
  alloy: "hannah",
  echo: "austin",
  onyx: "daniel",
  fable: "troy",
};

const sameOrigin = (request) => {
  const origin = request.headers.get("origin");
  return Boolean(origin) && origin === new URL(request.url).origin;
};

/** Cleans and validates incoming TTS parameters. Returns { text, voice, rate, overlay } or null. */
export function parseTtsInput(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const text = String(raw.text ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, TTS_LIMITS.maxChars);
  if (!text) return null;
  const voice = ALLOWED_VOICES.has(raw.voice) ? raw.voice : "nova";
  const numRate = Number(raw.rate);
  const rate = Number.isFinite(numRate) ? Math.max(TTS_LIMITS.minRate, Math.min(TTS_LIMITS.maxRate, Math.round(numRate * 10) / 10)) : 1.0;
  const overlay = String(raw.overlay ?? "").trim().slice(0, 64);
  return { text, voice, rate, overlay };
}

/** Parses upstream provider HTTP error into a safe, actionable UI code. */
async function providerFailure(res, env) {
  const err = await res.json().catch(() => null);
  const rawCode = String(err?.error?.code ?? err?.error?.status ?? "").toLowerCase();
  const message = String(err?.error?.message ?? "").slice(0, 180);
  let code = "provider_error";
  if (rawCode === "model_terms_required" || /terms acceptance|accept.*terms/i.test(message)) code = "groq_terms_required";
  else if (res.status === 401 || res.status === 403 || rawCode.includes("invalid_api_key")) code = "invalid_api_key";
  else if (res.status === 429 || rawCode.includes("rate_limit")) code = "rate_limited";
  return { ok: false, status: res.status === 429 ? 429 : 502, error: code, ...(env?.DEV && message ? { detail: message } : {}) };
}

/** Synthesizes audio bytes from OpenAI, Google Cloud TTS, or Groq Orpheus cleanly. */
async function synthesizeSpeech({ text, voice, rate }, env, fetchFn) {
  if (env?.OPENAI_TTS_KEY) {
    const res = await fetchFn("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { authorization: `Bearer ${env.OPENAI_TTS_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: env.OPENAI_TTS_MODEL || "tts-1", input: text, voice, speed: rate, response_format: "mp3" }),
    });
    if (!res.ok) return providerFailure(res, env);
    return { ok: true, bytes: await res.arrayBuffer(), mime: "audio/mpeg" };
  }
  if (env?.GOOGLE_TTS_KEY) {
    const picked = GOOGLE_VOICE_MAP[voice] || GOOGLE_VOICE_MAP.nova;
    const res = await fetchFn(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(env.GOOGLE_TTS_KEY)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: picked.name.slice(0, 5), name: picked.name, ssmlGender: picked.ssmlGender },
        audioConfig: { audioEncoding: "MP3", speakingRate: rate },
      }),
    });
    if (!res.ok) return providerFailure(res, env);
    const data = await res.json().catch(() => null);
    if (!data?.audioContent) return { ok: false, status: 502, error: "provider_error" };
    const bin = atob(data.audioContent);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { ok: true, bytes: bytes.buffer, mime: "audio/mpeg" };
  }
  if (env?.GROQ_TTS_KEY) {
    const groqVoice = GROQ_VOICE_MAP[voice] || "autumn";
    const res = await fetchFn("https://api.groq.com/openai/v1/audio/speech", {
      method: "POST",
      headers: { authorization: `Bearer ${env.GROQ_TTS_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: env.GROQ_TTS_MODEL || "canopylabs/orpheus-v1-english",
        input: text.slice(0, 200),
        voice: groqVoice,
        response_format: "wav",
      }),
    });
    if (!res.ok) return providerFailure(res, env);
    return { ok: true, bytes: await res.arrayBuffer(), mime: res.headers.get("content-type") || "audio/wav" };
  }
  return { ok: false, status: 503, error: "ai_not_configured" };
}

/** POST /api/tts — checks who is asking, the region and the credits, then answers with spoken audio. */
export async function handleTts(request, env, { fetchFn = globalThis.fetch, now = Date.now() } = {}) {
  if (request.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" }, { allow: "POST" });
  if (!sameOrigin(request)) return json(403, { ok: false, error: "wrong_origin" });

  const rawBody = await request.text();
  if (rawBody.length > TTS_LIMITS.maxBody) return json(413, { ok: false, error: "too_big" });
  let parsed;
  try { parsed = parseTtsInput(JSON.parse(rawBody)); } catch { parsed = null; }
  if (!parsed) return json(400, { ok: false, error: "bad_data" });

  const country = regionOf(request, env);
  // Frills Plus goes through the one gate (plus-gate.mjs): an overlay link's code, or being signed in on the website. The credits are the account's, in the plus table.
  const gate = env?.DB ? await plusGate(request, env, { now, overlayCode: parsed.overlay }) : { present: false };
  // A local server (no Cloudflare country) lets the editor try AI voices with no account, unless it is told to ask for one (REQUIRE_PRO_PASS=1) to rehearse the real thing.
  const isLocalTesting = country === "DEV" && !gate.present && env?.REQUIRE_PRO_PASS !== "1";

  let accountPlus = null;
  if (gate.present) {
    if (!gate.ok) return json(gate.status, { ok: false, error: gate.error, ...(gate.country ? { country: gate.country } : {}), ...(gate.limit ? { limit: gate.limit } : {}) });
    accountPlus = gate.plus;
  } else if (!isLocalTesting) {
    return json(401, { ok: false, error: "no_pass" }); // nothing was brought: a free visitor
  }

  const audio = await synthesizeSpeech(parsed, env, fetchFn);
  if (!audio.ok) return json(audio.status, { ok: false, error: audio.error, ...(audio.detail ? { detail: audio.detail } : {}) });

  const extraHeaders = {};
  if (accountPlus && env?.DB) {
    const left = await spendCredit(env.DB, accountPlus);
    extraHeaders["x-tts-used"] = String(left.used);
    extraHeaders["x-tts-limit"] = String(left.limit);
    extraHeaders["x-tts-remaining"] = String(left.remaining);
  }

  return new Response(audio.bytes, {
    status: 200,
    headers: {
      "content-type": audio.mime,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

/**
 * POST /api/pro/dev-pass — a local-development helper only (never on Cloudflare): gives the signed-in test account a small Frills Plus (a few credits) so the credit count and the
 * "used up" message can be tried without a payment. Sign in on /account/ first.
 */
export async function handleDevPass(request, env, { now = Date.now() } = {}) {
  if (!env?.DEV) return json(404, { ok: false, error: "not_found" });
  if (request.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" }, { allow: "POST" });
  if (!sameOrigin(request)) return json(403, { ok: false, error: "wrong_origin" });
  if (!env?.DB) return json(503, { ok: false, error: "not_ready" });

  const who = await resolveCredential(request, env, { now });
  if (who.kind !== "session") return json(401, { ok: false, error: "sign_in_first" });
  const body = await request.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(500, Math.round(Number(body?.limit) || 5)));
  await env.DB.prepare(
    "INSERT INTO plus (account_id, provider_ref, order_ref, status, renews_at, tts_used, tts_limit, period_start, updated_at) VALUES (?, ?, '', 'active', ?, 0, ?, ?, ?) " +
    "ON CONFLICT(account_id) DO UPDATE SET provider_ref = excluded.provider_ref, order_ref = '', status = 'active', renews_at = excluded.renews_at, tts_used = 0, tts_limit = excluded.tts_limit, period_start = excluded.period_start, updated_at = excluded.updated_at",
  ).bind(who.accountId, "dev-" + who.accountId, now + 30 * 86400 * 1000, limit, now, now).run();
  return json(201, { ok: true, used: 0, limit });
}
