// Writes each page's real dates into its front matter, from git:  node scripts/page-dates.mjs
//   "published": the day the page was first committed
//   "updated":   the day the page, or a partial it uses ({{>name}}, intro, about), was last committed
// The sitemap's <lastmod>, the "Updated" line on guides and the Article structured data all read "updated" (see build.mjs). A page with no "updated" gets no <lastmod> at all:
// a date that is wrong teaches Google to ignore the dates that are right. Run this after changing a page, before you push. Needs git with the full history.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const dateOf = (file, first = false) => {
  const out = git("log", "--format=%cs", "--follow", "--", relative(root, file)).split("\n").filter(Boolean);
  return out.length ? (first ? out[out.length - 1] : out[0]) : null;
};
const GUIDES = (path) => path.startsWith("/guides/") || path === "/looks/"; // these also get Article structured data

let changed = 0;
for (const file of walk(join(root, "src", "pages")).filter((f) => f.endsWith(".html"))) {
  const text = readFileSync(file, "utf8");
  const m = /^<!--\s*(\{[\s\S]*?\})\s*-->/.exec(text);
  if (!m) continue;
  const meta = JSON.parse(m[1]);
  if (meta.noindex || meta.listed === false) continue;
  const partials = [...text.matchAll(/\{\{>\s*([\w-]+)\s*\}\}/g)].map((x) => x[1]).concat([meta.intro, meta.about].filter(Boolean));
  const seen = new Set();
  const stack = [...partials];
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
  if (head !== m[1]) { writeFileSync(file, text.replace(m[1], () => head)); changed++; }
}
console.log(`${changed} page(s) updated`);
