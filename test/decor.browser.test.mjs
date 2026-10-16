// Decorations and the name tag pill in a real headless Chrome, on the chat overlay in its practice mode. The pieces lie over the bubble's edges
// (a friend on top, a scene on a bottom corner, sparkles), leave room so a neighbor is not covered, never take a click, load only when a pack is
// chosen, and the name tag pill sits on the top edge. Skipped on a computer with no Chrome or Edge. `npm test` builds first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch } from "../scripts/lib/chrome.mjs";
import { createStatic } from "../scripts/lib/static.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "decor", "frog", "corner-pond.webp"))) throw new Error("dist/ has no decoration pictures. Run `npm run build` first (`npm test` does that for you).");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

let server;
let base;
let page;
before(async () => {
  if (skip) return;
  server = http.createServer(createStatic(dist));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  page = await launch();
  await page.viewport(520, 640);
});
after(async () => {
  await page?.close();
  server?.closeAllConnections?.();
  server?.close();
});

const open = async (query) => {
  await page.goto(`${base}/overlay/?demo=1&${query}`, { settle: 300 });
  await page.waitFor(`document.querySelectorAll("#chat .m").length >= 4`);
  await page.waitFor(`document.querySelectorAll("#chat .m")[3].getBoundingClientRect().height > 0`);
};

test("no decoration and no name tag changes nothing: no pieces, and no picture is asked for", { skip }, async () => {
  await open("look=bubblegum");
  assert.equal(await page.evaluate(`document.querySelectorAll("#chat .deco").length`), 0);
  assert.equal(await page.evaluate(`document.getElementById("stage").dataset.deco`), "none");
  assert.equal(await page.evaluate(`performance.getEntriesByType("resource").filter((r) => r.name.includes("/decor/")).length`), 0, "nothing is downloaded for a pack nobody picked");
});

test("every message gets a cat on top, a kitten on a bottom corner and little pieces around, and none of it takes a click", { skip }, async () => {
  await open("look=bubblegum&deco=neko");
  await page.waitFor(`[...document.querySelectorAll("#chat .deco img")].every((i) => i.complete)`);
  const r = await page.evaluate(`(() => {
    const ms = [...document.querySelectorAll("#chat .m")];
    const m = ms[2];
    const body = m.querySelector(".body").getBoundingClientRect();
    const corner = m.querySelector(".deco__corner").getBoundingClientRect();
    return {
      all: ms.every((x) => x.querySelector(".deco")),
      sparks: m.querySelectorAll(".deco__spark").length,
      cornerLeftOfBubble: corner.left < body.left && corner.bottom > body.bottom,
      clicks: getComputedStyle(m.querySelector(".deco")).pointerEvents,
      hasClasses: m.classList.contains("has-peek") && m.classList.contains("has-corner"),
      hidden: m.querySelector(".deco").getAttribute("aria-hidden"),
      alt: [...m.querySelectorAll(".deco img")].every((i) => i.alt === ""),
    };
  })()`);
  assert.deepEqual({ ...r }, { all: true, sparks: 3, cornerLeftOfBubble: true, clicks: "none", hasClasses: true, hidden: "true", alt: true });
});

test("frog pond: the lily-pad scene and the sparkles are real pictures that load, and the empty peeker slot leaves no gap above the bubble", { skip }, async () => {
  await open("style=latte&palette=latte&deco=frog");
  await page.waitFor(`[...document.querySelectorAll("#chat .deco img")].every((i) => i.complete)`);
  const r = await page.evaluate(`(() => {
    const imgs = [...document.querySelectorAll("#chat .deco img")];
    const m = document.querySelectorAll("#chat .m")[2];
    return { count: imgs.length, loaded: imgs.every((i) => i.naturalWidth > 0), fromSite: imgs.every((i) => new URL(i.src).origin === location.origin && i.src.includes("/decor/frog/")), corner: Boolean(m.querySelector("img.deco__corner")), peek: Boolean(m.querySelector(".deco__peek")), margin: getComputedStyle(m).marginTop };
  })()`);
  assert.ok(r.count >= 8, `${r.count} pictures`);
  assert.equal(r.loaded, true);
  assert.equal(r.fromSite, true);
  assert.equal(r.corner, true);
  assert.equal(r.peek, false, "the frog has no peeking friend yet");
  assert.equal(r.margin, "0px", "so nothing is made room for");
});

test("the corner side, the size and the switches change what is drawn; who gets them can be mods only", { skip }, async () => {
  await open("look=bubblegum&deco=neko&decoSide=right&decoSize=200&decoPeek=0&decoSpark=0");
  const r = await page.evaluate(`(() => {
    const m = document.querySelectorAll("#chat .m")[2];
    const body = m.querySelector(".body").getBoundingClientRect();
    const corner = m.querySelector(".deco__corner").getBoundingClientRect();
    return { peek: Boolean(m.querySelector(".deco__peek")), sparks: m.querySelectorAll(".deco__spark").length, rightSide: corner.right > body.right - 30 && corner.left > body.left + body.width / 2, width: Math.round(corner.width) };
  })()`);
  assert.deepEqual({ peek: r.peek, sparks: r.sparks, rightSide: r.rightSide }, { peek: false, sparks: 0, rightSide: true });
  assert.ok(r.width >= 80, `twice the size (${r.width} px)`);
  await open("look=bubblegum&deco=neko&decoFor=mods");
  await page.waitFor(`document.querySelector("#chat .m .ico")`, { timeout: 30000 }); // the practice chat is random: wait until a moderator has written
  const mods = await page.evaluate(`[...document.querySelectorAll("#chat .m")].map((m) => [Boolean(m.querySelector(".ico")), Boolean(m.querySelector(".deco"))])`);
  assert.ok(mods.length >= 4);
  assert.ok(mods.every(([isMod, has]) => isMod === has), "decorations only on moderators' messages");
  assert.ok(mods.some(([isMod]) => isMod), "(and the practice chat has some)");
});

test("the name tag pill sits on the top-left edge of the bubble in the look's accent color, follows the alignment, and the name stays readable", { skip }, async () => {
  await open("look=blueberry&tag=pill");
  const get = () => page.evaluate(`(() => {
    const m = document.querySelectorAll("#chat .m")[2];
    const body = m.querySelector(".body").getBoundingClientRect();
    const who = m.querySelector(".who").getBoundingClientRect();
    const cs = getComputedStyle(m.querySelector(".who"));
    return { stage: document.getElementById("stage").dataset.tag, straddles: who.top < body.top && who.bottom > body.top, insideLeft: who.left >= body.left && who.left - body.left < 40, centered: Math.abs((who.left + who.right) / 2 - (body.left + body.right) / 2) < 4, rightEdge: body.right - who.right < 40, radius: parseFloat(cs.borderTopLeftRadius) >= 20, bg: cs.backgroundColor, ink: getComputedStyle(m.querySelector(".name")).color, pos: cs.position };
  })()`);
  const left = await get();
  assert.deepEqual([left.stage, left.straddles, left.insideLeft, left.radius, left.pos], ["pill", true, true, true, "absolute"]);
  assert.notEqual(left.bg, "rgba(0, 0, 0, 0)");
  assert.notEqual(left.bg, left.ink, "the name is not the same color as its pill");
  await open("look=blueberry&tag=pill&align=center");
  assert.equal((await get()).centered, true);
  await open("look=blueberry&tag=pill&align=right");
  assert.equal((await get()).rightEdge, true);
  await open("style=night&palette=night&tag=pill");
  const night = await get();
  assert.equal(night.straddles, true, "the matcha looks have it too");
  await open("look=blueberry");
  assert.equal((await page.evaluate(`getComputedStyle(document.querySelectorAll("#chat .m")[2].querySelector(".who")).position`)), "static", "off: the name is in the bubble as before");
});

test("the chat editor: the decoration settings appear when a pack is picked and go when it is None, the preview wears them, and the link carries them", { skip }, async () => {
  await page.viewport(1280, 900);
  await page.goto(`${base}/editor/`, { settle: 900 });
  const shown = () => page.evaluate(`[...document.querySelectorAll("#main-controls > *")].filter((r) => r.style.display !== "none").map((r) => r.querySelector(".ctl__label")?.textContent.trim() ?? "")`);
  const chip = (label, row = "") => page.evaluate(`(() => { const rows = [...document.querySelectorAll("#main-controls > *")].filter((r) => !${JSON.stringify(row)} || r.querySelector(".ctl__label")?.textContent.trim() === ${JSON.stringify(row)}); const b = rows.flatMap((r) => [...r.querySelectorAll(".chip")]).find((c) => c.textContent.trim() === ${JSON.stringify(label)}); b.click(); })()`);
  const hidden = await shown();
  assert.ok(hidden.includes("Decorations on the bubbles") && hidden.includes("Name tag"));
  assert.ok(!hidden.includes("Decoration size") && !hidden.includes("Sparkles"), "nothing about decorations until a pack is picked");
  await chip("Neko cafe");
  const open = await shown();
  for (const label of ["Decoration size", "Corner scene sits on the", "A friend peeking over the top", "A scene on a corner", "Sparkles", "Who gets decorations"]) assert.ok(open.includes(label), label);
  await chip("A pill on the edge");
  await page.evaluate(`(() => { const i = document.getElementById("source-channel"); i.value = "pond_cafe"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await page.waitFor(`document.querySelectorAll("#chat .m .deco").length >= 2`, 8000);
  assert.equal(await page.evaluate(`document.getElementById("stage").dataset.tag`), "pill");
  const link = new URL(await page.evaluate(`document.getElementById("link").value`));
  assert.equal(link.searchParams.get("deco"), "neko");
  assert.equal(link.searchParams.get("tag"), "pill");
  await chip("None", "Decorations on the bubbles");
  assert.ok(!(await shown()).includes("Sparkles"), "and they go again");
  await page.waitFor(`document.querySelectorAll("#chat .m .deco").length === 0`);
});

test("the matcha page has a Pictures choice up front: Frog pond puts the frog on a lily pad on the cards, and it stays in step with More options", { skip }, async () => {
  await page.viewport(1280, 900);
  await page.goto(`${base}/matcha/`, { settle: 900 });
  const pressed = () => page.evaluate(`[...document.querySelectorAll("#decos .chip")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent.trim())`);
  assert.deepEqual(await pressed(), ["None"]);
  assert.equal(await page.evaluate(`document.querySelectorAll(".chatbox .deco").length`), 0);
  await page.evaluate(`[...document.querySelectorAll("#decos .chip")].find((b) => b.textContent.trim() === "Frog pond").click()`);
  await page.waitFor(`document.querySelectorAll(".chatbox .deco img.deco__corner").length >= 6`, { timeout: 15000 });
  const seen = await page.evaluate(`[...new Set([...document.querySelectorAll(".chatbox .deco img.deco__corner")].map((i) => i.src.split("/").pop()))].sort()`);
  assert.deepEqual(seen, ["corner-lily.webp", "corner-pond.webp"], "the frog on its lily pad and the lotus both turn up");
  const rows = await page.evaluate(`[...document.querySelectorAll("#more-controls > *")].filter((r) => r.style.display !== "none").map((r) => r.querySelector(".ctl__label")?.textContent.trim())`);
  assert.ok(rows.includes("Decoration size"), "the settings under More options appear");
  await page.evaluate(`[...document.querySelectorAll("#more-controls .chip")].find((b) => b.textContent.trim() === "None" && b.closest("#more-controls > *")?.querySelector(".ctl__label")?.textContent.trim() === "Decorations on the bubbles").click()`);
  assert.deepEqual(await pressed(), ["None"], "choosing None under More options moves the quick choice too");
  await page.waitFor(`document.querySelectorAll(".chatbox .deco").length === 0`);
});

test("neko cafe: a cat peeks over the top edge with room left for it, a kitten sits on the corner, and little cat things are scattered", { skip }, async () => {
  await open("style=latte&palette=latte&deco=neko");
  await page.waitFor(`[...document.querySelectorAll("#chat .deco img")].every((i) => i.complete)`);
  const r = await page.evaluate(`(() => {
    const ms = [...document.querySelectorAll("#chat .m")];
    const m = ms[2];
    const body = m.querySelector(".body").getBoundingClientRect();
    const peek = m.querySelector("img.deco__peek");
    const box = peek.getBoundingClientRect();
    const prev = ms[1].getBoundingClientRect();
    return {
      loaded: [...document.querySelectorAll("#chat .deco img")].every((i) => i.naturalWidth > 0 && i.src.includes("/decor/neko/")),
      onTop: box.bottom > body.top && box.bottom - body.top <= 10,
      clearOfNeighbor: box.top >= prev.bottom - 1,
      corner: Boolean(m.querySelector("img.deco__corner")),
      sparks: m.querySelectorAll(".deco__spark").length,
      both: new Set(ms.map((x) => x.querySelector("img.deco__peek")?.src.split("/").pop())).size,
    };
  })()`);
  assert.deepEqual({ ...r, both: undefined }, { loaded: true, onTop: true, clearOfNeighbor: true, corner: true, sparks: 3, both: undefined });
  assert.ok(r.both >= 1);
});

test("the name tag pill never wraps a letter per line in a short message, and the cat on top keeps off the tag, whichever way the text is aligned", { skip }, async () => {
  for (const align of ["left", "center", "right"]) {
    for (const side of ["left", "right"]) {
      await open(`look=bubblegum&deco=neko&tag=pill&align=${align}&decoSide=${side}`);
      await page.waitFor(`[...document.querySelectorAll("#chat .deco img")].every((i) => i.complete)`);
      const r = await page.evaluate(`(() => {
        const ms = [...document.querySelectorAll("#chat .m")].filter((m) => m.querySelector("img.deco__peek"));
        const size = parseFloat(getComputedStyle(document.querySelector("#chat .m .name")).fontSize);
        return ms.map((m) => {
          const who = m.querySelector(".who").getBoundingClientRect();
          const cat = m.querySelector("img.deco__peek").getBoundingClientRect();
          return { oneLine: who.height < size * 2, apart: cat.right <= who.left + 1 || cat.left >= who.right - 1 };
        });
      })()`);
      assert.ok(r.length >= 3);
      assert.ok(r.every((x) => x.oneLine), `${align}/${side}: the name stays on one line`);
      assert.ok(r.every((x) => x.apart), `${align}/${side}: the cat and the tag do not overlap`);
    }
  }
});

test("the name inside the tag stays readable on a gift message, in every look that fills its bubbles", { skip }, async () => {
  for (const query of ["look=butter&tag=pill", "look=bubblegum&tag=pill", "style=latte&palette=latte&tag=pill"]) {
    await open(query);
    const r = await page.evaluate(`(() => {
      const m = document.querySelector("#chat .m");
      m.classList.add("gift"); // the practice chat rarely sends a gift, so one of its messages is marked as one
      const who = getComputedStyle(m.querySelector(".who"));
      return { ink: getComputedStyle(m.querySelector(".name")).color, tag: who.backgroundColor, tagInk: who.color };
    })()`);
    assert.notEqual(r.ink, r.tag, `${query}: the name is not the color of its tag`);
    assert.equal(r.ink, r.tagInk, `${query}: the name takes the tag's ink`);
  }
});
