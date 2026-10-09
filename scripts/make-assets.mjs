// Draws the brand images from the design tokens:  node scripts/make-assets.mjs
//   public/favicon.svg, favicon.ico, apple-touch-icon.png   the mark, in the site's own colours
//   public/og.png                                           the 1200 x 630 card shown when a link is shared
// It needs a Chrome or Edge on this computer. Run it again after changing the tokens or the headline.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { browser } from "./lib/chrome.mjs";
import { tokenHex } from "./tokens.mjs";

const root = join(import.meta.dirname, "..");
const pub = join(root, "public");
mkdirSync(pub, { recursive: true });

const pear = tokenHex("accent");
const ink = tokenHex("ink");
const paper = tokenHex("paper");

// The mark: a speech bubble with a frilled hem and a small face.
const mark = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="${size}" height="${size}"><path d="M10 28.4 6.4 36.4 17.4 29.4Z" fill="${pear}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/><path d="M13 4H27A9 9 0 0 1 36 13V27A4 4 0 0 1 28 27A4 4 0 0 1 20 27A4 4 0 0 1 12 27A4 4 0 0 1 4 27V13A9 9 0 0 1 13 4Z" fill="${pear}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/><circle cx="15" cy="15" r="2.2" fill="${ink}"/><circle cx="25" cy="15" r="2.2" fill="${ink}"/><path d="M17.5 20.2q2.5 2.6 5 0" fill="none" stroke="${ink}" stroke-width="2.1" stroke-linecap="round"/></svg>`;
writeFileSync(join(pub, "favicon.svg"), mark(40) + "\n");

const page = (body, background) => "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:${background};display:grid;place-items:center;overflow:hidden}</style>${body}`);

/** A PNG wrapped in the ICO container, which every browser accepts for /favicon.ico. */
function ico(png, size) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  header.writeUInt8(size, 6);
  header.writeUInt8(size, 7);
  header.writeUInt16LE(1, 10); // planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18); // where the image starts
  return Buffer.concat([header, png]);
}

await browser(async ({ shoot }) => {
  writeFileSync(join(pub, "apple-touch-icon.png"), await shoot(page(mark(128), paper), { width: 180, height: 180 }));
  writeFileSync(join(pub, "favicon.ico"), ico(await shoot(page(mark(32), "transparent"), { width: 32, height: 32, transparent: true }), 32));
  console.log("favicon.svg, favicon.ico, apple-touch-icon.png written");
});

// The share card is a real page, built only now, drawn with the real styles.
const run = (args, env = {}) => {
  const result = spawnSync(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
};
run(["build.mjs"], { OG_CARD: "1" });
const port = 3099;
const server = spawn(process.execPath, ["scripts/serve.mjs", String(port)], { cwd: root, stdio: "ignore" });
try {
  await new Promise((r) => setTimeout(r, 800));
  await browser(async ({ shoot }) => {
    writeFileSync(join(pub, "og.png"), await shoot(`http://localhost:${port}/og-card/`, { width: 1200, height: 630, settle: 900 }));
  });
  console.log("og.png written");
} finally {
  server.kill();
  run(["build.mjs"]); // put dist/ back to the real site, without the card
}
