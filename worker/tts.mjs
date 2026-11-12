// Paid & free-tier AI Voice synthesis endpoint (POST /api/tts) protected by region lock (worker/region.mjs) and Pro Pass quota in D1.
// Calls OpenAI Speech, Google Cloud TTS, or Groq Orpheus from the Worker so keys stay server-side and CSP stays strict.

import { PASS_WINDOW_MS, checkProRegion, issueProPass, json, lookupProPass, regionOf } from "./region.mjs";

export const ALLOWED_VOICES = new Set(["alloy", "nova", "shimmer", "echo", "onyx", "fable"]);
export const TTS_LIMITS = { maxBody: 2048, maxChars: 220, minRate: 0.7, maxRate: 1.5, windowMs: PASS_WINDOW_MS };

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

/** Cleans and validates incoming TTS parameters. Returns { text, voice, rate, pass } or null. */
export function parseTtsInput(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const text = String(raw.text ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, TTS_LIMITS.maxChars);
  if (!text) return null;
  const voice = ALLOWED_VOICES.has(raw.voice) ? raw.voice : "nova";
  const numRate = Number(raw.rate);
  const rate = Number.isFinite(numRate) ? Math.max(TTS_LIMITS.minRate, Math.min(TTS_LIMITS.maxRate, Math.round(numRate * 10) / 10)) : 1.0;
  const pass = String(raw.pass ?? "").trim().slice(0, 128);
  return { text, voice, rate, pass };
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

/** POST /api/tts — validates pass, region lock, and quota, then streams spoken audio. */
export async function handleTts(request, env, { fetchFn = globalThis.fetch, now = Date.now() } = {}) {
  if (request.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" }, { allow: "POST" });
  if (!sameOrigin(request)) return json(403, { ok: false, error: "wrong_origin" });

  const rawBody = await request.text();
  if (rawBody.length > TTS_LIMITS.maxBody) return json(413, { ok: false, error: "too_big" });
  let parsed;
  try { parsed = parseTtsInput(JSON.parse(rawBody)); } catch { parsed = null; }
  if (!parsed) return json(400, { ok: false, error: "bad_data" });

  const passToken = request.headers.get("x-pass") || parsed.pass;
  const devSecret = String(env?.PRO_DEV_KEY ?? "").trim();
  const isDevKey = Boolean(devSecret && passToken && passToken === devSecret);
  const country = regionOf(request, env);
  const isLocalTesting = country === "DEV" && !passToken && env?.REQUIRE_PRO_PASS !== "1";

  let passRow = null;
  if (!isDevKey && !isLocalTesting) {
    if (!passToken) return json(401, { ok: false, error: "no_pass" });
    if (!env?.DB) return json(503, { ok: false, error: "not_ready" });
    passRow = await lookupProPass(env.DB, passToken, { now, resetExpired: true });
    if (!passRow || passRow.status !== "active") return json(401, { ok: false, error: "invalid_pass" });

    // Region lock enforcement (US, EU, UK, CA, AU, etc., unless allow_roam=1 for owner/travel)
    const reg = checkProRegion(request, env, { allowRoam: passRow.allow_roam === 1, passToken });
    if (!reg.eligible) return json(403, { ok: false, error: "region_unavailable", country: reg.country });

    if (passRow.tts_used >= passRow.tts_limit) return json(402, { ok: false, error: "quota_exceeded", limit: passRow.tts_limit });
  } else {
    const reg = checkProRegion(request, env, { allowRoam: isDevKey, passToken });
    if (!reg.eligible) return json(403, { ok: false, error: "region_unavailable", country: reg.country });
  }

  const audio = await synthesizeSpeech(parsed, env, fetchFn);
  if (!audio.ok) return json(audio.status, { ok: false, error: audio.error, ...(audio.detail ? { detail: audio.detail } : {}) });

  const extraHeaders = {};
  if (passRow && env?.DB) {
    await env.DB.prepare("UPDATE pro_passes SET tts_used = tts_used + 1 WHERE code = ?").bind(passRow.code).run();
    const used = passRow.tts_used + 1;
    extraHeaders["x-tts-used"] = String(used);
    extraHeaders["x-tts-limit"] = String(passRow.tts_limit);
    extraHeaders["x-tts-remaining"] = String(Math.max(0, passRow.tts_limit - used));
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

/** POST /api/pro/dev-pass — strictly local-dev endpoint (never enabled on Cloudflare) to mint a test Pro Pass in SQLite. */
export async function handleDevPass(request, env, { now = Date.now() } = {}) {
  if (!env?.DEV) return json(404, { ok: false, error: "not_found" });
  if (request.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" }, { allow: "POST" });
  if (!sameOrigin(request)) return json(403, { ok: false, error: "wrong_origin" });
  if (!env?.DB) return json(503, { ok: false, error: "not_ready" });

  const body = await request.json().catch(() => ({}));
  const pass = await issueProPass(env.DB, {
    country: body?.country || "US",
    limit: Math.max(1, Math.min(500, Math.round(Number(body?.limit) || 5))),
    allowRoam: Boolean(body?.allowRoam),
    now,
  });
  return json(201, { ok: true, ...pass });
}
