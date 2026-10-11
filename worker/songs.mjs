// Song lookup for the song requests overlay. The page asks us (GET /api/songs?q=...) and we ask a free music catalog (Deezer's public search,
// no key and no login), so the page needs no new address in its security policy and the catalog sees our server, not the viewers.
// Only the words somebody typed in the LIVE chat are sent, never a name. The answer is cut down to what the overlay shows: the title, the
// artist, a small cover and the length. Answers are kept at the edge for a day, so a popular song is asked for once.

const CATALOG = "https://api.deezer.com/search";
const COVER = /^[a-f0-9]{32}$/;

const json = (status, body, cache = "no-store") =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache, "x-content-type-options": "nosniff" } });

const clean = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** The catalog's answer -> at most `limit` songs: { id, title, artist, cover, seconds, link }. Anything unusable is left out. */
export function shape(body, limit = 3) {
  const out = [];
  for (const t of Array.isArray(body?.data) ? body.data : []) {
    const title = clean(t?.title_short || t?.title, 120);
    const artist = clean(t?.artist?.name, 80);
    if (!title || !t?.id || t?.readable === false) continue;
    const image = String(t?.md5_image ?? "");
    const link = typeof t?.link === "string" && t.link.startsWith("https://www.deezer.com/") ? t.link : "";
    out.push({
      id: String(t.id),
      title,
      artist,
      cover: COVER.test(image) ? `https://cdn-images.dzcdn.net/images/cover/${image}/250x250-000000-80-0-0.jpg` : "",
      seconds: Math.max(0, Math.min(3600, Math.round(Number(t?.duration) || 0))),
      link,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** GET /api/songs?q=... -> { results: [...] }. A catalog that is slow or down gives { results: [] }, never an error page. */
export async function handleSongs(request, { fetchImpl = fetch, cache = globalThis.caches?.default, ctx } = {}) {
  if (request.method !== "GET") return json(405, { error: "Use GET." });
  const q = clean(new URL(request.url).searchParams.get("q"), 80);
  if (q.length < 2) return json(400, { error: "Say which song." });
  const key = new Request(`https://songs.cache.invalid/?q=${encodeURIComponent(q.toLowerCase())}`);
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  let results = [];
  try {
    const res = await fetchImpl(`${CATALOG}?q=${encodeURIComponent(q)}&limit=5`, { signal: AbortSignal.timeout(4000), headers: { accept: "application/json" } });
    if (res.ok) results = shape(await res.json());
  } catch { results = []; }
  const answer = json(200, { results }, results.length ? "public, max-age=3600" : "no-store");
  if (cache && results.length) {
    const kept = new Response(answer.clone().body, answer);
    kept.headers.set("cache-control", "public, max-age=86400");
    ctx?.waitUntil?.(cache.put(key, kept));
  }
  return answer;
}
