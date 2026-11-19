// Frills Plus Live-Updating Cloud Overlays (/o/<id> + /api/cloud-overlays + /api/o/<id>):
//   - Signed-in Frills Plus accounts can save named overlay presets in D1 (up to 50 per account) and get a permanent URL (/o/<id>).
//   - Updating a preset in any Frills editor increments `version`; OBS / TikTok LIVE Studio tabs hosting /o/<id> poll /api/o/<id>?v=<n>
//     and apply changes live automatically with zero URL re-pasting.
//   - Overlay paths are derived strictly from the server-side OVERLAY_KINDS allowlist (never client-supplied URLs).
//   - Reading /o/<id> keeps rendering the last saved overlay even if Plus ends (graceful fallback, never breaks a live stream),
//     while creating/updating requires active Frills Plus.

import { getPlus, plusActive, sessionAccount } from "./accounts.mjs";
import { COOKIE, cookieOf } from "./account-routes.mjs";
import { checkProRegion } from "./region.mjs";

export const OVERLAY_KINDS = Object.freeze({
  chat: { path: "/overlay/", editorPath: "/editor/", label: "Chat" },
  matcha: { path: "/overlay/", editorPath: "/matcha/", label: "Matcha chat" },
  alerts: { path: "/overlay/alerts/", editorPath: "/alerts/", label: "Alerts" },
  gifts: { path: "/overlay/gifts/", editorPath: "/gifts/", label: "Last gifts" },
  jar: { path: "/overlay/jar/", editorPath: "/jar/", label: "Gift jar" },
  goal: { path: "/overlay/goal/", editorPath: "/goal/", label: "Goal" },
  likers: { path: "/overlay/likers/", editorPath: "/likers/", label: "Top likers" },
  gifters: { path: "/overlay/gifters/", editorPath: "/gifters/", label: "Top gifters" },
  labels: { path: "/overlay/labels/", editorPath: "/labels/", label: "Rotating highlights" },
  counter: { path: "/overlay/counter/", editorPath: "/counter/", label: "Viewer & like counter" },
  timer: { path: "/overlay/timer/", editorPath: "/timer/", label: "Subathon timer" },
  songs: { path: "/overlay/songs/", editorPath: "/songs/", label: "Song requests" },
  tts: { path: "/overlay/tts/", editorPath: "/tts/", label: "Talking pet TTS" },
});

export const MAX_CLOUD_OVERLAYS = 50;
const MAX_BODY = 8192;
const MAX_QUERY = 4096;
const MAX_NAME = 60;
const ID_RE = /^[A-Za-z0-9_-]{12}$/;

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    },
  });

const sameOrigin = (request) => {
  const origin = request.headers.get("origin");
  return Boolean(origin) && origin === new URL(request.url).origin;
};

const regionAllowed = (request, env) => {
  const hasCfCountry = typeof request.cf?.country === "string" && /^[A-Za-z]{2}$/.test(request.cf.country.trim());
  const hasDevSim = Boolean(env?.DEV && (request.headers.get("x-frills-country") || new URL(request.url).searchParams.get("country")));
  if (!hasCfCountry && !hasDevSim) return true;
  return checkProRegion(request, env).eligible;
};

/** Generates a 12-char URL-safe base64url identifier (~72 bits of entropy). */
function randomId() {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Validates and normalizes a user-chosen preset name (1..60 visible chars). */
export function cleanOverlayName(raw) {
  const text = String(raw ?? "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.slice(0, MAX_NAME);
}

/** Validates and canonicalizes an overlay query string (never allows control chars, fragments, or oversized payloads). */
export function cleanOverlayQuery(raw) {
  let text = String(raw ?? "").trim();
  if (text.startsWith("?")) text = text.slice(1);
  if (!text || text.length > MAX_QUERY || /[\r\n\u0000#]/.test(text)) return null;
  try {
    const params = new URLSearchParams(text);
    // Strip ephemeral host-only parameters so stored configs stay clean
    params.delete("_cv");
    params.delete("cloud");
    params.delete("loaded");
    const normalized = params.toString();
    if (!normalized || normalized.length > MAX_QUERY) return null;
    return normalized;
  } catch {
    return null;
  }
}

/** Returns the 12-char cloud overlay ID from a `/o/<id>` (or `/o/<id>/`) pathname, or "". */
export function cloudHostIdFromPath(pathname) {
  const m = /^\/o\/([A-Za-z0-9_-]{12})\/?$/.exec(String(pathname ?? ""));
  return m ? m[1] : "";
}

function formatRow(row, origin) {
  const meta = OVERLAY_KINDS[row.kind] ?? { path: row.path, editorPath: "/editor/", label: row.kind };
  return {
    id: row.id,
    kind: row.kind,
    label: meta.label,
    name: row.name,
    path: meta.path,
    editorPath: meta.editorPath,
    query: row.query,
    version: Number(row.version) || 1,
    liveUrl: `${origin}/o/${row.id}`,
    editUrl: `${meta.editorPath}?cloud=${row.id}`,
    targetUrl: `${meta.path}?${row.query}`,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return { tooBig: true };
  try {
    const body = JSON.parse(text);
    return body && typeof body === "object" ? { body } : {};
  } catch {
    return {};
  }
}

/**
 * Handles:
 *   GET    /api/o/:id[?v=<n>]        -> public OBS live config read (no auth cookies needed)
 *   GET    /api/cloud-overlays       -> list signed-in account's cloud overlays
 *   POST   /api/cloud-overlays       -> create a new cloud overlay (active Plus required)
 *   GET    /api/cloud-overlays/:id   -> fetch one cloud overlay owned by the signed-in account
 *   PUT    /api/cloud-overlays/:id   -> update name and/or query, incrementing version (active Plus required)
 *   DELETE /api/cloud-overlays/:id   -> delete one cloud overlay owned by the signed-in account
 */
export async function handleCloudOverlays(request, env, { now = Date.now() } = {}) {
  const url = new URL(request.url);
  const { pathname } = url;
  if (!env?.DB) return json(503, { ok: false, error: "not_ready" });
  const db = env.DB;

  try {
    // ── Public OBS read endpoint: GET /api/o/:id ───────────────────────────────────────────────────────
    if (pathname.startsWith("/api/o/")) {
      if (request.method !== "GET") return json(405, { ok: false, error: "method" }, { allow: "GET" });
      const id = pathname.slice("/api/o/".length).replace(/\/+$/, "");
      if (!ID_RE.test(id)) return json(404, { ok: false, error: "not_found" });
      const row = await db.prepare("SELECT id, kind, name, path, query, version, updated_at FROM cloud_overlays WHERE id = ?").bind(id).first();
      if (!row || !Object.hasOwn(OVERLAY_KINDS, row.kind)) return json(404, { ok: false, error: "not_found" });
      const currentVersion = Number(row.version) || 1;
      const askedVersion = url.searchParams.get("v");
      if (askedVersion !== null && /^\d+$/.test(askedVersion) && Number(askedVersion) === currentVersion) {
        return json(200, { ok: true, id: row.id, version: currentVersion, changed: false });
      }
      const meta = OVERLAY_KINDS[row.kind];
      return json(200, {
        ok: true,
        id: row.id,
        kind: row.kind,
        name: row.name,
        version: currentVersion,
        changed: true,
        url: `${meta.path}?${row.query}`,
        query: row.query,
        updatedAt: Number(row.updated_at) || 0,
      });
    }

    // ── Authenticated account routes: /api/cloud-overlays[/:id] ────────────────────────────────────────
    if (pathname !== "/api/cloud-overlays" && !pathname.startsWith("/api/cloud-overlays/")) {
      return json(404, { ok: false, error: "not_found" });
    }
    const id = pathname === "/api/cloud-overlays" ? "" : pathname.slice("/api/cloud-overlays/".length).replace(/\/+$/, "");
    if (id && !ID_RE.test(id)) return json(404, { ok: false, error: "not_found" });

    const who = await sessionAccount(db, cookieOf(request, COOKIE), { now });
    if (!who) return json(401, { ok: false, error: "sign_in_first" });
    const plus = await getPlus(db, who.accountId);
    const hasPlus = plusActive(plus, now);
    const origin = String(env.SITE_URL ?? url.origin).replace(/\/+$/, "");

    if (!id && request.method === "GET") {
      const filterKind = String(url.searchParams.get("kind") ?? "").trim();
      const rows = filterKind && Object.hasOwn(OVERLAY_KINDS, filterKind)
        ? (await db.prepare("SELECT * FROM cloud_overlays WHERE account_id = ? AND kind = ? ORDER BY updated_at DESC").bind(who.accountId, filterKind).all()).results
        : (await db.prepare("SELECT * FROM cloud_overlays WHERE account_id = ? ORDER BY updated_at DESC").bind(who.accountId).all()).results;
      return json(200, {
        ok: true,
        plusActive: hasPlus,
        limit: MAX_CLOUD_OVERLAYS,
        overlays: (rows ?? []).map((r) => formatRow(r, origin)),
      });
    }

    if (id && request.method === "GET") {
      const row = await db.prepare("SELECT * FROM cloud_overlays WHERE id = ? AND account_id = ?").bind(id, who.accountId).first();
      if (!row) return json(404, { ok: false, error: "not_found" });
      return json(200, { ok: true, plusActive: hasPlus, overlay: formatRow(row, origin) });
    }

    // Mutating operations require same-origin CSRF protection
    if (!["POST", "PUT", "DELETE"].includes(request.method)) {
      return json(405, { ok: false, error: "method" }, { allow: id ? "GET, PUT, DELETE" : "GET, POST" });
    }
    if (!sameOrigin(request)) return json(403, { ok: false, error: "wrong_origin" });

    if (id && request.method === "DELETE") {
      const res = await db.prepare("DELETE FROM cloud_overlays WHERE id = ? AND account_id = ?").bind(id, who.accountId).run();
      if (!res?.meta?.changes) return json(404, { ok: false, error: "not_found" });
      return json(200, { ok: true, id });
    }

    // Create & update require active Frills Plus + eligible region
    if (!regionAllowed(request, env)) return json(403, { ok: false, error: "region_unavailable" });
    if (!hasPlus) return json(403, { ok: false, error: "plus_required" });

    const { body, tooBig } = await readJson(request);
    if (tooBig) return json(413, { ok: false, error: "too_big" });
    if (!body) return json(400, { ok: false, error: "bad_data" });

    if (!id && request.method === "POST") {
      const kind = String(body.kind ?? "").trim();
      if (!Object.hasOwn(OVERLAY_KINDS, kind)) return json(400, { ok: false, error: "bad_kind" });
      const name = cleanOverlayName(body.name) || `${OVERLAY_KINDS[kind].label} overlay`;
      const query = cleanOverlayQuery(body.query);
      if (!query) return json(400, { ok: false, error: "bad_query" });

      const existing = await db.prepare("SELECT COUNT(*) AS n FROM cloud_overlays WHERE account_id = ?").bind(who.accountId).first();
      if (Number(existing?.n ?? 0) >= MAX_CLOUD_OVERLAYS) {
        return json(409, { ok: false, error: "limit_reached", limit: MAX_CLOUD_OVERLAYS });
      }

      const newId = randomId();
      const meta = OVERLAY_KINDS[kind];
      await db.prepare(
        "INSERT INTO cloud_overlays (id, account_id, kind, name, path, query, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
      ).bind(newId, who.accountId, kind, name, meta.path, query, now, now).run();

      const row = { id: newId, account_id: who.accountId, kind, name, path: meta.path, query, version: 1, created_at: now, updated_at: now };
      return json(201, { ok: true, overlay: formatRow(row, origin) });
    }

    if (id && request.method === "PUT") {
      const existing = await db.prepare("SELECT * FROM cloud_overlays WHERE id = ? AND account_id = ?").bind(id, who.accountId).first();
      if (!existing) return json(404, { ok: false, error: "not_found" });

      const nextName = body.name !== undefined ? cleanOverlayName(body.name) : existing.name;
      if (!nextName) return json(400, { ok: false, error: "bad_name" });
      const nextQuery = body.query !== undefined ? cleanOverlayQuery(body.query) : existing.query;
      if (!nextQuery) return json(400, { ok: false, error: "bad_query" });

      const nextVersion = (Number(existing.version) || 1) + 1;
      await db.prepare(
        "UPDATE cloud_overlays SET name = ?, query = ?, version = ?, updated_at = ? WHERE id = ? AND account_id = ?",
      ).bind(nextName, nextQuery, nextVersion, now, id, who.accountId).run();

      const updated = { ...existing, name: nextName, query: nextQuery, version: nextVersion, updated_at: now };
      return json(200, { ok: true, overlay: formatRow(updated, origin) });
    }

    return json(405, { ok: false, error: "method" });
  } catch {
    return json(500, { ok: false, error: "server" });
  }
}
