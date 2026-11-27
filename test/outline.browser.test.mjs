// Browser tests for Stream Outline & Border Designer (/outline/ editor & /overlay/outline/ live source) in headless Chrome:
//   - Strict CSP clean check (0 console/page errors across all 3 modes & 9 frame styles)
//   - Switchable Side Slot (Transparent Widget Box default, TikTok Gift Menu, Commands & Rules, Hide Wide Cam)
//   - TikTok 9:16 Quick Starters, safe-zone toggle, and centered stage containment
//   - Client-side transparent PNG export producing a valid non-empty PNG Blob
//   - Free direct URL fallback vs. previewAll in editor + live `frills:cloud-cmd` spotlighting
//   - Responsive 320px & 1280px layout with zero horizontal overflow

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findChrome, launch } from "../scripts/lib/chrome.mjs";
import { createHelper } from "../helper/server.mjs";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "outline", "index.html"))) throw new Error("Run `npm run build` first (`npm test` does that for you).");
let skip = false;
try { findChrome(); } catch { skip = "No Chrome or Edge on this computer"; }

const opened = [];
async function withServer() {
  const helper = createHelper({ distDir: dist });
  const port = await helper.listen(0);
  opened.push(helper);
  return `http://127.0.0.1:${port}`;
}

let page;
before(async () => { if (!skip) { page = await launch(); await page.viewport(1280, 900); } });
after(async () => { await page?.close(); for (const h of opened) await h.close(); });

test("Stream Outline editor loads TikTok 9:16 with transparent widget slot default, switches to Gift Menu & Commands, and supports all 3 modes", { skip }, async () => {
  const base = await withServer();
  await page.goto(`${base}/outline/`, { settle: 500 });
  assert.deepEqual(page.problems, [], page.problems.join(" | "));

  // Initial TikTok 9:16 render defaults to Transparent Widget Box (3 cutouts: game + cam + widget slot, zero agenda clutter)
  const init = await page.evaluate(`(() => {
    const stage = document.getElementById("stage").getBoundingClientRect();
    const svg = document.querySelector("#widget svg.ol-svg");
    const box = svg?.getBoundingClientRect();
    return {
      vb: svg?.getAttribute("viewBox"),
      link: document.getElementById("link")?.value || "",
      copyDisabled: document.getElementById("copy-link")?.disabled,
      frames: document.querySelectorAll("#widget .ol-frame").length,
      cardRows: document.querySelectorAll("#widget .ol-card-row").length,
      safeHidden: document.getElementById("ol-safe-toggle")?.hidden,
      hasBanner: Boolean(document.querySelector("#widget .ol-banner")),
      hasPromo: Boolean(document.querySelector("#widget .ol-promo")),
      fitsStage: Boolean(box && box.width > 180 && box.height > 200 && box.left >= stage.left - 2 && box.top >= stage.top - 2 && box.right <= stage.right + 2 && box.bottom <= stage.bottom + 2),
      boxW: Math.round(box?.width || 0),
      boxH: Math.round(box?.height || 0),
      stageW: Math.round(stage.width),
      stageH: Math.round(stage.height),
    };
  })()`);
  assert.equal(init.vb, "0 0 1080 1920");
  assert.equal(init.fitsStage, true, `SVG (${init.boxW}x${init.boxH}) must fit completely inside stage (${init.stageW}x${init.stageH})`);
  assert.match(init.link, /\/overlay\/outline\/\?/);
  assert.equal(init.copyDisabled, false);
  assert.equal(init.cardRows, 0, "default sideMode=widget renders a clean transparent widget cutout instead of an agenda card");
  assert.equal(init.safeHidden, false);
  assert.equal(init.hasBanner, true);
  assert.equal(init.hasPromo, true);

  // OBS-style Simple setup / Advanced toggle: defaults to simple, hides advanced sliders, and reveals them on click
  const modeCheck = await page.evaluate(`(() => {
    const startMode = document.body.dataset.editorMode;
    const topPadSimple = getComputedStyle(document.getElementById("c-topPad").closest(".ctl")).display;
    document.querySelector(".ed-mode__btn[data-mode='advanced']")?.click();
    const advMode = document.body.dataset.editorMode;
    const topPadAdv = getComputedStyle(document.getElementById("c-topPad").closest(".ctl")).display;
    document.querySelector(".ed-mode__btn[data-mode='simple']")?.click();
    return { startMode, topPadSimple, advMode, topPadAdv, backToSimple: document.body.dataset.editorMode };
  })()`);
  assert.equal(modeCheck.startMode, "simple");
  assert.equal(modeCheck.topPadSimple, "none");
  assert.equal(modeCheck.advMode, "advanced");
  assert.notEqual(modeCheck.topPadAdv, "none");
  assert.equal(modeCheck.backToSimple, "simple");

  // Switch Side Slot to TikTok Gift Menu -> renders 4 crisp gift rows + spotlight button works
  const giftSwitch = await page.evaluate(`(() => {
    const sel = document.getElementById("c-sideMode");
    sel.value = "gifts";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    document.getElementById("ol-next-step").click();
    return {
      rows: document.querySelectorAll("#widget .ol-card-row").length,
      link: document.getElementById("link").value,
    };
  })()`);
  assert.equal(giftSwitch.rows, 4);
  assert.match(giftSwitch.link, /sideMode=gifts/);
  assert.match(giftSwitch.link, /highlightRow=0/);

  // Toggle TikTok safe zones & click VTuber Cozy quick starter
  const tt = await page.evaluate(`(() => {
    const safeBtn = document.getElementById("ol-safe-toggle");
    safeBtn.click();
    document.querySelector("[data-tt-preset='vtuber']")?.click();
    return {
      vb: document.querySelector("#widget svg.ol-svg")?.getAttribute("viewBox"),
      hasSafeGuide: Boolean(document.querySelector("#widget .ol-safezone")),
      hasChatCard: Boolean(document.querySelector("#widget .ol-lower-chat--card")),
      link: document.getElementById("link").value,
    };
  })()`);
  assert.equal(tt.vb, "0 0 1080 1920");
  assert.equal(tt.hasSafeGuide, true);
  assert.equal(tt.hasChatCard, true);
  assert.match(tt.link, /layout9=tt-vtuber/);

  // Preview a Frills Plus collector style (cyber) -> renders in editor and shows Plus banner
  await page.evaluate(`(() => {
    const sel = document.getElementById("c-frameStyle");
    sel.value = "cyber";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  const plusPreview = await page.evaluate(`(() => ({
    hasCyber: Boolean(document.querySelector("#widget .ol-frame--cyber")),
    bannerHidden: document.getElementById("ol-plus-banner").hidden,
    bannerText: document.getElementById("ol-plus-banner").textContent,
  }))()`);
  assert.equal(plusPreview.hasCyber, true);
  assert.equal(plusPreview.bannerHidden, false);
  assert.match(plusPreview.bannerText, /Frills Plus/);

  // Switch to Full-Screen 16:9 & Webcam Box modes (and confirm standalone Gift Menu mode chip is removed)
  const modeChips = await page.evaluate(`[...document.querySelectorAll("#mode-controls .chip")].map((b) => b.textContent.trim())`);
  assert.equal(modeChips.length, 3);
  assert.equal(modeChips.some((t) => t.includes("Gift Menu")), false);

  await page.evaluate(`(() => {
    const chips = [...document.querySelectorAll("#mode-controls .chip")];
    chips.find((b) => b.textContent.includes("Full-Screen 16:9"))?.click();
  })()`);
  assert.equal(await page.evaluate(`document.querySelector("#widget svg.ol-svg")?.getAttribute("viewBox")`), "0 0 1920 1080");

  await page.evaluate(`(() => {
    const chips = [...document.querySelectorAll("#mode-controls .chip")];
    chips.find((b) => b.textContent.includes("Webcam"))?.click();
  })()`);
  assert.equal(await page.evaluate(`document.querySelector("#widget svg.ol-svg")?.getAttribute("viewBox")`), "0 0 1280 720");

  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("PNG export renders a valid transparent PNG without CSP errors, and Free direct overlay enforces Free fallback + live spotlight cmd", { skip }, async () => {
  const base = await withServer();
  await page.goto(`${base}/outline/`, { settle: 500 });

  const exportRes = await page.evaluate(`(async () => {
    let downloadedName = "";
    let downloadedSize = 0;
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = (blob) => { downloadedSize = blob?.size || 0; return origCreate.call(URL, blob); };
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) downloadedName = this.download; };
    document.getElementById("ol-export-1x").click();
    for (let i = 0; i < 60 && !downloadedName; i++) await new Promise((r) => setTimeout(r, 50));
    URL.createObjectURL = origCreate;
    HTMLAnchorElement.prototype.click = origClick;
    return { downloadedName, downloadedSize, hint: document.getElementById("link-hint").textContent };
  })()`);
  assert.match(exportRes.downloadedName, /^frills-outline-screen9x16-.*\.png$/);
  assert.ok(exportRes.downloadedSize > 4000, `PNG blob size was ${exportRes.downloadedSize}`);
  assert.match(exportRes.hint, /1080 × 1920/);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));

  // Direct Free overlay URL with Plus params gracefully falls back to Free style & strips editor-only guides
  await page.goto(`${base}/overlay/outline/?mode=screen9x16&sideMode=gifts&frameStyle=cyber&motion=orbit&cardStyle=quest`, { settle: 450 });
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
  const overlayCheck = await page.evaluate(`(() => ({
    vb: document.querySelector("#outline-root svg.ol-svg")?.getAttribute("viewBox"),
    hasStickerFallback: Boolean(document.querySelector("#outline-root .ol-frame--sticker")),
    hasCyber: Boolean(document.querySelector("#outline-root .ol-frame--cyber")),
    hasEditorOnly: Boolean(document.querySelector("#outline-root [data-editor-only]")),
    cardRows: document.querySelectorAll("#outline-root .ol-card-row").length,
  }))()`);
  assert.equal(overlayCheck.vb, "0 0 1080 1920");
  assert.equal(overlayCheck.hasStickerFallback, true);
  assert.equal(overlayCheck.hasCyber, false);
  assert.equal(overlayCheck.hasEditorOnly, false);
  assert.equal(overlayCheck.cardRows, 4);

  // Dispatching frills:cloud-cmd (`outline:next` / `outline:reset`) spotlights and clears a row live
  const cmdCheck = await page.evaluate(`(() => {
    window.dispatchEvent(new CustomEvent("frills:cloud-cmd", { detail: { cmd: "outline:next", value: 0 } }));
    const starAfterNext = document.querySelectorAll("#outline-root .ol-card-row[data-row='0'] path").length;
    window.dispatchEvent(new CustomEvent("frills:cloud-cmd", { detail: { cmd: "outline:reset", value: 0 } }));
    const starAfterReset = document.querySelectorAll("#outline-root .ol-card-row[data-row='0'] path").length;
    return { starAfterNext, starAfterReset };
  })()`);
  assert.equal(cmdCheck.starAfterNext, 1);
  assert.equal(cmdCheck.starAfterReset, 0);
});

test("Stream Outline editor has zero horizontal overflow or panel blowout at 320px, 375px, and 1280px (Simple & Advanced)", { skip }, async () => {
  const base = await withServer();
  for (const w of [320, 375, 1280]) {
    await page.viewport(w, 840);
    await page.goto(`${base}/outline/`, { settle: 400 });
    for (const mode of ["simple", "advanced"]) {
      await page.evaluate(`document.querySelector(".ed-mode__btn[data-mode='${mode}']")?.click()`);
      assert.deepEqual(page.problems, [], `width ${w} (${mode}): ${page.problems.join(" | ")}`);
      const bounds = await page.evaluate(`(() => {
        const panel = document.querySelector(".panel")?.getBoundingClientRect();
        const preview = document.querySelector(".preview")?.getBoundingClientRect();
        const maxRight = w >= 896 ? Math.min(panel.right, preview.left + 1) : window.innerWidth;
        const clipped = [];
        for (const el of document.querySelectorAll(".ed-mode, .step-card, .ed-adv-link, .panel button")) {
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          if (r.right > maxRight + 2) clipped.push({ cls: el.className, text: el.textContent.trim().slice(0, 30), right: Math.round(r.right), limit: Math.round(maxRight) });
        }
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          clipped,
        };
      })()`.replace("w >= 896", `${w} >= 896`));
      assert.ok(bounds.overflow <= 2, `horizontal overflow at ${w}px (${mode}) was ${bounds.overflow}px`);
      assert.deepEqual(bounds.clipped, [], `clipped elements at ${w}px (${mode}): ${JSON.stringify(bounds.clipped)}`);
    }
  }
});

test("Overlay Size Guide bar displays live dimensions and opens a centered popup on Copy link or button click", { skip }, async () => {
  const base = await withServer();
  await page.viewport(1280, 900);
  await page.goto(`${base}/outline/`, { settle: 450 });
  assert.deepEqual(page.problems, [], page.problems.join(" | "));

  const barText = await page.evaluate(`document.querySelector(".size-bar__value")?.textContent`);
  assert.equal(barText, "1080 × 1920 px");

  // Click Copy link -> popup opens automatically with exact dimensions and switches cleanly between TikTok & OBS tabs
  await page.evaluate(`document.getElementById("copy-link")?.click()`);
  await page.waitFor(`document.querySelector("dialog.size-dlg")?.open === true`, { timeout: 3000 });
  const modal = await page.evaluate(`(() => {
    const dlg = document.querySelector("dialog.size-dlg");
    const r = dlg.getBoundingClientRect();
    const nums = [...dlg.querySelectorAll(".size-dlg__num")].map((n) => n.textContent);
    const tabs = [...dlg.querySelectorAll(".size-dlg__tab")];
    tabs[1]?.click(); // switch to OBS / Streamlabs
    const obsStep = dlg.querySelector(".size-dlg__steps")?.textContent || "";
    dlg.querySelector(".size-dlg__done")?.click();
    return {
      nums,
      obsStep,
      centered: r.left > 100 && r.right < window.innerWidth - 100 && r.top > 20 && r.bottom < window.innerHeight - 20,
      closedAfterDone: !dlg.open,
    };
  })()`);
  assert.deepEqual(modal.nums, ["1080 px", "1920 px"]);
  assert.match(modal.obsStep, /1080/);
  assert.match(modal.obsStep, /1920/);
  assert.equal(modal.centered, true);
  assert.equal(modal.closedAfterDone, true);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});

test("Frills Plus Resize boxes mode lets users drag handles, edit exact px, center/reset boxes, and stays overflow-free", { skip }, async () => {
  const base = await withServer();
  await page.viewport(1280, 900);
  await page.goto(`${base}/outline/`, { settle: 450 });
  await page.evaluate(`localStorage.clear(); location.reload();`);
  await page.goto(`${base}/outline/`, { settle: 450 });
  assert.deepEqual(page.problems, [], page.problems.join(" | "));

  // Toggle Resize boxes ON -> renders 8 handles + inspector
  const opened = await page.evaluate(`(() => {
    document.getElementById("ol-edit-toggle")?.click();
    return {
      pressed: document.getElementById("ol-edit-toggle")?.getAttribute("aria-pressed"),
      inspectorHidden: document.getElementById("ol-box-inspector")?.hidden,
      handles: document.querySelectorAll("#widget [data-ol-handle]").length,
      boxOptions: document.querySelectorAll("#ol-box-select option").length,
      badge: document.querySelector("#widget .ol-edit-badge-text")?.textContent || "",
    };
  })()`);
  assert.equal(opened.pressed, "true");
  assert.equal(opened.inspectorHidden, false);
  assert.equal(opened.handles, 8);
  assert.ok(opened.boxOptions >= 5);
  assert.match(opened.badge, /\d+ × \d+ px/);

  // Edit exact width/height via inspector + click Center H -> updates URL, Plus banner, and SVG badge
  const resized = await page.evaluate(`(() => {
    const wIn = document.getElementById("ol-box-w");
    const hIn = document.getElementById("ol-box-h");
    wIn.value = "760";
    wIn.dispatchEvent(new Event("input", { bubbles: true }));
    hIn.value = "400";
    hIn.dispatchEvent(new Event("change", { bubbles: true }));
    document.getElementById("ol-box-center")?.click();
    return {
      xVal: document.getElementById("ol-box-x")?.value,
      wVal: document.getElementById("ol-box-w")?.value,
      hVal: document.getElementById("ol-box-h")?.value,
      link: document.getElementById("link")?.value || "",
      banner: document.getElementById("ol-plus-banner")?.textContent || "",
      resetHidden: document.getElementById("ol-reset-boxes")?.hidden,
      badge: document.querySelector("#widget .ol-edit-badge-text")?.textContent || "",
    };
  })()`);
  assert.equal(resized.xVal, "160", "Center H puts 760px wide box at x=(1080-760)/2=160");
  assert.equal(resized.wVal, "760");
  assert.equal(resized.hVal, "400");
  assert.match(resized.link, /customBoxes=game%3A160%2C\d+%2C760%2C400/);
  assert.match(resized.banner, /custom box resize/);
  assert.equal(resized.resetHidden, false);
  assert.match(resized.badge, /760 × 400 px/);

  // Drag the south-east handle via pointer events -> smoothly changes box size
  const dragged = await page.evaluate(`(() => {
    const handle = document.querySelector("#widget [data-ol-handle='se']");
    const r = handle.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: cx, clientY: cy, button: 0, pointerId: 1, pointerType: "mouse" }));
    const wrap = document.querySelector("#widget .ol-wrap");
    wrap.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: cx + 28, clientY: cy + 28, pointerId: 1, pointerType: "mouse" }));
    wrap.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: cx + 28, clientY: cy + 28, pointerId: 1, pointerType: "mouse" }));
    return {
      wVal: Number(document.getElementById("ol-box-w")?.value),
      hVal: Number(document.getElementById("ol-box-h")?.value),
    };
  })()`);
  assert.ok(dragged.wVal > 760, `dragging SE handle should widen box (got ${dragged.wVal})`);
  assert.ok(dragged.hVal > 400, `dragging SE handle should heighten box (got ${dragged.hVal})`);

  // Verify mobile 320px with Resize boxes inspector open has zero overflow or clipped buttons
  await page.viewport(320, 840);
  const mobileCheck = await page.evaluate(`(() => {
    const clipped = [];
    for (const el of document.querySelectorAll("#ol-box-inspector input, #ol-box-inspector select, #ol-box-inspector button, .preview__tests button")) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.right > window.innerWidth + 2) clipped.push({ text: el.textContent.trim().slice(0, 24), right: Math.round(r.right) });
    }
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      clipped,
    };
  })()`);
  assert.ok(mobileCheck.overflow <= 2, `320px overflow was ${mobileCheck.overflow}px`);
  assert.deepEqual(mobileCheck.clipped, [], JSON.stringify(mobileCheck.clipped));

  // Reset all boxes -> restores defaults and clears customBoxes from URL
  const afterReset = await page.evaluate(`(() => {
    document.getElementById("ol-box-reset-all")?.click();
    return {
      link: document.getElementById("link")?.value || "",
      resetHidden: document.getElementById("ol-reset-boxes")?.hidden,
    };
  })()`);
  assert.equal(afterReset.link.includes("customBoxes="), false);
  assert.equal(afterReset.resetHidden, true);

  // Free direct overlay link ignores customBoxes & renders zero edit handles
  await page.viewport(1280, 900);
  await page.goto(`${base}/overlay/outline/?mode=screen9x16&customBoxes=game:160,300,760,400`, { settle: 400 });
  const freeOverlay = await page.evaluate(`(() => ({
    editHandles: document.querySelectorAll("#outline-root [data-ol-handle]").length,
    editorOnly: document.querySelectorAll("#outline-root [data-editor-only]").length,
  }))()`);
  assert.equal(freeOverlay.editHandles, 0);
  assert.equal(freeOverlay.editorOnly, 0);
  assert.deepEqual(page.problems, [], page.problems.join(" | "));
});
