// The fonts a look can use: every one in the Font choice is declared, its files are real woff2 files that ship in the site, it has its licence, and a weight that a
// look asks for (500, 600 and 700) is covered by some declaration. No page needed; how they look in a page is checked in fonts.browser.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FONTS } from "../src/js/settings.js";

const root = join(import.meta.dirname, "..");
const css = readFileSync(join(root, "src", "css", "fonts.css"), "utf8");
const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
  const body = m[1];
  return {
    family: /font-family:\s*"([^"]+)"/.exec(body)?.[1],
    file: /url\("([^"]+)"\)/.exec(body)?.[1],
    weight: /font-weight:\s*([^;]+);/.exec(body)?.[1].trim(),
    display: /font-display:\s*(\w+)/.exec(body)?.[1],
  };
}).filter((f) => f.file); // (a metric-matched stand-in that points at a font already on the computer has no file of ours)

const slug = (family) => family.toLowerCase().replace(/ /g, "-");
/** Whether a declared weight ("500", or a range "200 1000") covers `want`. */
const covers = (weight, want) => { const [lo, hi = lo] = weight.split(/\s+/).map(Number); return want >= lo && want <= hi; };

test("every font in the Font choice is declared, with a stack that falls back to something sensible", () => {
  assert.ok(Object.keys(FONTS).length >= 20, "the original eight and twelve more");
  for (const [name, stack] of Object.entries(FONTS)) {
    assert.ok(faces.some((f) => f.family === name), `${name} has a @font-face`);
    assert.ok(stack.startsWith(`"${name}"`), `${name}: its own face comes first`);
    assert.match(stack, /sans-serif|monospace|cursive/, `${name}: and a generic family is the last resort`);
  }
  for (const f of faces) assert.ok(f.family in FONTS, `${f.family} is declared but cannot be chosen`);
});

test("every declared file is a real woff2 that ships in the site, is small, and loads without blocking the page", () => {
  assert.ok(faces.length >= 26, "the eleven that were there and fifteen more");
  for (const face of faces) {
    const file = join(root, "public", face.file);
    assert.ok(existsSync(file), `${face.file} is in public/`);
    const bytes = readFileSync(file);
    assert.equal(bytes.subarray(0, 4).toString("latin1"), "wOF2", `${face.file} is a woff2 file`);
    assert.ok(statSync(file).size < 110 * 1024, `${face.file} is ${Math.round(statSync(file).size / 1024)} KB: small enough to load when a look picks it`);
    assert.equal(face.display, "swap", `${face.family}: the text shows at once and changes when the font is in`);
  }
});

test("every font has a face for ordinary text (400 or 500), and each of the new ones has one for bold (700) too, so a look never has to invent a bold", () => {
  const added = ["Poppins", "Montserrat", "Nunito", "Quicksand", "Lilita One", "Bangers", "Permanent Marker", "Pacifico", "Dancing Script", "Caveat", "Orbitron", "Silkscreen"];
  for (const name of Object.keys(FONTS)) {
    const own = faces.filter((f) => f.family === name);
    assert.ok(own.some((f) => covers(f.weight, 400) || covers(f.weight, 500) || covers(f.weight, 600)), `${name} has a face for ordinary text`);
    if (added.includes(name)) assert.ok(own.some((f) => covers(f.weight, 700)), `${name} has a face for bold`);
  }
});

test("the fonts added on 31 October 2026 each have their licence next to the others", () => {
  const added = ["Poppins", "Montserrat", "Nunito", "Quicksand", "Lilita One", "Bangers", "Permanent Marker", "Pacifico", "Dancing Script", "Caveat", "Orbitron", "Silkscreen"];
  for (const name of added) {
    assert.ok(name in FONTS, `${name} can be chosen`);
    const licence = join(root, "public", "fonts", "licenses", `${slug(name)}-LICENSE.txt`);
    assert.ok(existsSync(licence), `${name}: licence file`);
    assert.match(readFileSync(licence, "utf8"), /SIL Open Font License|Apache License/, `${name}: a licence that allows serving the font with the site`);
  }
  for (const name of ["Baloo 2", "Fredoka", "Geist", "JetBrains Mono", "Plus Jakarta Sans", "Press Start 2P", "Space Grotesk", "Bricolage Grotesque"]) {
    assert.ok(existsSync(join(root, "public", "fonts", "licenses", `${slug(name)}-LICENSE.txt`)), `${name}: licence file (as before)`);
  }
});
