// Serves a built site folder the way the live host does: folders answer at /name/, a missing page gets the 404 page, and the headers in
// _headers are applied, so a broken Content-Security-Policy shows up on this computer and not after a deploy.
// Used by scripts/serve.mjs (the plain local server) and by the Frills helper (which serves the same files and adds TikTok).

import { gzipSync } from "node:zlib";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve as absolute, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8", ".webmanifest": "application/manifest+json",
};

/** root/_headers -> [{ test(path), headers }]. Only the "/*" and "/prefix/*" forms the build writes. */
function loadHeaders(root) {
  const file = join(root, "_headers");
  if (!existsSync(file)) return [];
  const rules = [];
  let current = null;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) {
      const pattern = line.trim();
      const prefix = pattern.replace(/\*$/, "");
      current = { test: (p) => p.startsWith(prefix), headers: {} };
      rules.push(current);
    } else if (current) {
      const i = line.indexOf(":");
      current.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return rules;
}

function resolve(root, urlPath) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, "");
  const target = join(root, clean);
  if (!target.startsWith(root + sep) && target !== root) return null; // never leave the folder
  if (existsSync(target) && statSync(target).isDirectory()) {
    if (!urlPath.endsWith("/")) return { redirect: urlPath + "/" };
    const index = join(target, "index.html");
    return existsSync(index) ? { file: index } : null;
  }
  return existsSync(target) ? { file: target } : null;
}

/** Returns (req, res) => void that answers one request from `folder`. */
export function createStatic(folder) {
  const root = absolute(folder); // forward slashes, a trailing slash or a relative path all end up the same
  return (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const headers = Object.assign({}, ...loadHeaders(root).filter((r) => r.test(url.pathname)).map((r) => r.headers));
    let found;
    try {
      found = resolve(root, url.pathname);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (found?.redirect) {
      res.writeHead(308, { Location: found.redirect + url.search });
      res.end();
      return;
    }
    const file = found?.file ?? join(root, "404.html");
    const status = found ? 200 : 404;
    const type = TYPES[extname(file)] ?? "application/octet-stream";
    const body = readFileSync(file);
    const squeeze = /^(text\/|application\/(json|xml|manifest))|svg/.test(type) && /gzip/.test(req.headers["accept-encoding"] ?? "");
    res.writeHead(status, { "Content-Type": type, "Cache-Control": "public, max-age=0, must-revalidate", ...(squeeze && { "Content-Encoding": "gzip", Vary: "Accept-Encoding" }), ...headers });
    res.end(squeeze ? gzipSync(body) : body);
  };
}
