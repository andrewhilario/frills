// Writes each page's real dates into its front matter, from git:  node scripts/page-dates.mjs
//   "published": the day the page was first committed
//   "updated":   the day the page, or a partial it uses ({{>name}}, intro, about), last really changed
// "Really changed" means its text or its title, description or other settings changed. A commit that only writes these dates (or the "jsonld" list that this script
// also adds to) does not count, or running the script would date every page "today" every time.
// The sitemap's <lastmod>, the "Updated" line on guides and the Article structured data all read "updated" (see build.mjs). A page with no "updated" gets no <lastmod>
// at all: a date that is wrong teaches Google to ignore the dates that are right. Run this after changing a page, once the change is committed, then commit again.
// Needs git with the full history.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const GUIDES = (path) => path.startsWith("/guides/") || path === "/looks/"; // these also get Article structured data
const FRONT = /^<!--\s*(\{[\s\S]*?\})\s*-->/;
const DATE_KEYS = ["published", "updated", "jsonld"];

/** What a page says apart from its dates: its text, and its settings without the date keys. Null when the file did not exist. */
function content(spec) {
  let text;
  try { text = git("show", spec); } catch { return null; }
  const m = FRONT.exec(text);
  if (!m) return text;
  const meta = JSON.parse(m[1]);
  for (const key of DATE_KEYS) delete meta[key];
  return JSON.stringify(meta) + text.slice(m[0].length).replace(/<p class="article__updated">[^\n]*<\/p>/g, "").replace(/\s+/g, " ");
}
const dateOf = (file, first = false) => {
  const rel = relative(root, file).replace(/\\/g, "/");
  const rows = git("log", "--format=%H %cs", "--follow", "--", rel).split("\n").filter(Boolean).map((r) => r.split(" "));
  if (!rows.length) return null;
  if (first) return rows.at(-1)[1];
  for (const [hash, day] of rows) if (content(`${hash}:${rel}`) !== content(`${hash}^:${rel}`)) return day;
  return rows.at(-1)[1];
};

let changed = 0;
for (const file of walk(join(root, "src", "pages")).filter((f) => f.endsWith(".html"))) {
  const text = readFileSync(file, "utf8");
  const m = FRONT.exec(text);
  if (!m) continue;
  const meta = JSON.parse(m[1]);
  if (meta.noindex || meta.listed === false) continue;
  const seen = new Set();
  const stack = [...[...text.matchAll(/\{\{>\s*([\w-]+)\s*\}\}/g)].map((x) => x[1]), meta.intro, meta.about].filter(Boolean);
  while (stack.length) { // partials can use partials
    const name = stack.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    try { for (const x of readFileSync(join(root, "src", "partials", `${name}.html`), "utf8").matchAll(/\{\{>\s*([\w-]+)\s*\}\}/g)) stack.push(x[1]); } catch { /* not a partial of ours */ }
  }
  const dates = [dateOf(file), ...[...seen].map((n) => dateOf(join(root, "src", "partials", `${n}.html`)))].filter(Boolean).sort();
  const updated = dates.at(-1);
  const published = dateOf(file, true) ?? updated;
  if (!updated) continue;
  let head = m[1];
  const set = (key, value) => {
    const re = new RegExp(`("${key}"\\s*:\\s*)"[^"]*"`);
    head = re.test(head) ? head.replace(re, `$1"${value}"`) : head.replace(/("path"\s*:\s*"[^"]*",?)/, `$1\n  "${key}": "${value}",`);
  };
  set("published", published);
  set("updated", updated);
  if (GUIDES(meta.path) && !(meta.jsonld ?? []).includes("article")) head = head.replace(/"jsonld"\s*:\s*\[([^\]]*)\]/, (_, inner) => `"jsonld": [${inner.replace(/\s+/g, " ").trim()}, "article"]`);
  JSON.parse(head); // (a mistake here would stop the build, so it stops here first)
  if (head !== m[1]) { writeFileSync(file, text.replace(m[1], () => head)); changed++; console.log(`${meta.path}: updated ${meta.updated ?? "(none)"} -> ${updated}`); }
}
console.log(`${changed} page(s) updated`);
