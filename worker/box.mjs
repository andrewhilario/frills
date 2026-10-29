// The small pieces the "post box" Workers share (worker/nowplaying.mjs and worker/spotify.mjs): the answers they give, the check that a write comes
// from the site itself, and the code and key every box is made of.

/** The code (in the overlay link: anyone with it may read) and the key (kept only in the streamer's browser: needed to change anything). */
export const CODE = /^[A-Za-z0-9_-]{16}$/;
export const KEY = /^[A-Za-z0-9_-]{16,64}$/;

export const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra } });

export const sha256 = async (text) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** A change must come from a page of the site itself: a page elsewhere cannot ask the visitor's browser to make one. */
export const sameOrigin = (request) => {
  const origin = request.headers.get("origin");
  return Boolean(origin) && origin === new URL(request.url).origin;
};

/** Short plain text: no control characters, one space between words, cut at `max`. */
export const clean = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
