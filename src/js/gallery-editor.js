// Gift Gallery Rotator editor page (/gallery/): customize a rotating TikTok LIVE Gift Gallery or Gift Menu,
// test lighting up each gift live with animations, connect your TikTok account, and copy one Browser Source link.

import {
  GALLERY,
  GALLERY_GIFT_NAMES,
  GALLERY_PRESETS,
  GiftGallery,
  MAX_GALLERY_ITEMS,
  catalogGift,
  decodeGalleryItems,
  encodeGalleryItems,
  sanitizeGalleryItems,
} from "./gallery.js";
import { createGalleryView } from "./widgets-view.js";
import { startWidgetEditor } from "./widget-editor.js";
import { practiceName } from "./fake-alerts.js";
import { el } from "./feed.js";

const $ = (id) => document.getElementById(id);

startWidgetEditor({
  widget: GALLERY,
  storeKey: "frills:gallery:editor:v1",
  overlayPath: "/overlay/gallery/",
  platforms: ["tiktok"],
  events: ["gift"],
  idleHint: "Type your TikTok name, or frills_demo for made-up gifts. Press Test light up above to preview unlocking each gift.",
  create(host, settings, ctx) {
    let current = settings;
    let items = decodeGalleryItems(settings.items);

    const view = createGalleryView(host);
    const gallery = new GiftGallery(settings, {
      onChange: (snap) => view.render(snap),
    });

    // Seed two lit-up gifts on initial editor preview so visitors immediately see both lit and unlit cards
    const firstTwo = items.slice(0, 2);
    const seedNames = ["Mochi Bun", "Pond Pal"];
    firstTwo.forEach((slot, idx) => {
      gallery.add({
        kind: "gift",
        id: `seed-${idx}`,
        user: seedNames[idx] || "Pond Pal",
        name: seedNames[idx] || "Pond Pal",
        gift: slot.gift,
        diamonds: slot.diamonds || catalogGift(slot.gift).diamonds,
        count: idx === 0 ? 3 : 1,
        total: (slot.diamonds || catalogGift(slot.gift).diamonds) * (idx === 0 ? 3 : 1),
        picture: "",
        avatar: "",
      });
    });
    gallery.select(0);
    view.apply(settings);
    view.render(gallery.snapshot());

    // ── Friendly custom Gift Gallery row editor ────────────────────────────────────────────────────────────────
    const customBox = $("gal-custom-box");
    const liveNote = $("gal-live-note");
    const presetsHost = $("gal-presets");
    const rowsHost = $("gal-rows");
    const countBadge = $("gal-count");
    const addBtn = $("gal-add");
    const dl = $("gal-gifts-dl");

    if (dl) {
      dl.replaceChildren(...GALLERY_GIFT_NAMES.map((name) => el("option", { value: name })));
    }

    const syncModeUi = () => {
      const isLive = current.mode === "live";
      if (customBox) customBox.hidden = isLive;
      if (liveNote) liveNote.hidden = !isLive;
    };

    const commitItems = ({ rerender = false } = {}) => {
      if (rerender) items = sanitizeGalleryItems(items);
      current.items = encodeGalleryItems(items);
      gallery.setSettings(current);
      ctx.refresh();
      ctx.save();
      if (countBadge) countBadge.textContent = `${items.length} / ${MAX_GALLERY_ITEMS} gifts`;
      if (addBtn) addBtn.disabled = items.length >= MAX_GALLERY_ITEMS;
      if (rerender) renderRows();
    };

    if (presetsHost) {
      for (const preset of GALLERY_PRESETS) {
        const btn = el("button", { type: "button", className: "chip items__preset gal-preset", textContent: preset.name });
        btn.addEventListener("click", () => {
          items = preset.items.map((i) => ({ ...i }));
          commitItems({ rerender: true });
        });
        presetsHost.append(btn);
      }
    }

    const renderRows = () => {
      if (!rowsHost) return;
      rowsHost.replaceChildren();
      if (countBadge) countBadge.textContent = `${items.length} / ${MAX_GALLERY_ITEMS} gifts`;
      if (addBtn) addBtn.disabled = items.length >= MAX_GALLERY_ITEMS;

      items.forEach((item, idx) => {
        const row = el("div", { className: "gal-row" });

        const giftInput = el("input", {
          type: "text",
          className: "gal-row__gift",
          value: item.gift,
          placeholder: "Gift name (e.g. Galaxy)",
          maxLength: 36,
          autocomplete: "off",
          spellcheck: false,
        });
        giftInput.setAttribute("list", "gal-gifts-dl");
        giftInput.setAttribute("aria-label", `Gift ${idx + 1} name`);

        const diamondsInput = el("input", {
          type: "number",
          className: "gal-row__diamonds",
          value: String(item.diamonds || ""),
          placeholder: "◆",
          min: "0",
          max: "1000000",
          inputMode: "numeric",
        });
        diamondsInput.setAttribute("aria-label", `Gift ${idx + 1} diamonds`);

        const captionInput = el("input", {
          type: "text",
          className: "gal-row__caption",
          value: item.caption || "",
          placeholder: "Optional reward (e.g. Sticky note)",
          maxLength: 44,
          autocomplete: "off",
          spellcheck: false,
        });
        captionInput.setAttribute("aria-label", `Gift ${idx + 1} caption`);

        giftInput.addEventListener("input", () => {
          const val = giftInput.value.trim().slice(0, 36);
          item.gift = val || item.gift;
          const cat = catalogGift(val);
          if (cat.diamonds > 0 && val.toLowerCase() === cat.gift.toLowerCase()) {
            item.diamonds = cat.diamonds;
            diamondsInput.value = String(cat.diamonds);
          }
          commitItems();
        });
        diamondsInput.addEventListener("input", () => {
          const n = Math.round(Number(diamondsInput.value));
          item.diamonds = Number.isFinite(n) && n >= 0 ? Math.min(1000000, n) : 0;
          commitItems();
        });
        captionInput.addEventListener("input", () => {
          item.caption = captionInput.value.slice(0, 44);
          commitItems();
        });

        const upBtn = el("button", { type: "button", className: "btn btn--soft btn--sm gal-row__move", textContent: "↑" });
        upBtn.setAttribute("aria-label", `Move ${item.gift} up`);
        upBtn.disabled = idx === 0;
        upBtn.addEventListener("click", () => {
          if (idx <= 0) return;
          [items[idx - 1], items[idx]] = [items[idx], items[idx - 1]];
          commitItems({ rerender: true });
        });

        const rmBtn = el("button", { type: "button", className: "items__remove", textContent: "×" });
        rmBtn.setAttribute("aria-label", `Remove ${item.gift}`);
        rmBtn.disabled = items.length <= 1;
        rmBtn.addEventListener("click", () => {
          if (items.length <= 1) return;
          items.splice(idx, 1);
          commitItems({ rerender: true });
        });

        const actions = el("span", { className: "gal-row__acts" }, upBtn, rmBtn);
        row.append(giftInput, diamondsInput, captionInput, actions);
        rowsHost.append(row);
      });
    };

    addBtn?.addEventListener("click", () => {
      if (items.length >= MAX_GALLERY_ITEMS) return;
      const used = new Set(items.map((i) => i.gift.toLowerCase()));
      const pickName = GALLERY_GIFT_NAMES.find((g) => !used.has(g.toLowerCase())) || `Gift ${items.length + 1}`;
      const cat = catalogGift(pickName);
      items.push({ gift: pickName, diamonds: cat.diamonds || 10, caption: "" });
      commitItems({ rerender: true });
    });

    syncModeUi();
    renderRows();

    return {
      apply(next) {
        current = next;
        view.apply(next);
        gallery.setSettings(next);
        syncModeUi();
      },
      onReset(next) {
        current = next;
        items = decodeGalleryItems(next.items);
        gallery.setSettings(next);
        syncModeUi();
        renderRows();
      },
      onEvent: (event) => gallery.add(event),
      tests: {
        unlock: () => {
          const target = gallery.nextUnlitGift();
          const who = practiceName();
          const diamonds = target.diamonds || catalogGift(target.gift).diamonds || 1;
          gallery.add({
            kind: "gift",
            id: `test-${Date.now()}-${Math.random()}`,
            user: who,
            name: who,
            gift: target.gift,
            diamonds,
            count: 1,
            total: diamonds,
            picture: "",
            avatar: "",
          });
        },
        gift: () => {
          const pool = current.mode === "custom" && items.length ? items : GALLERY_PRESETS[0].items;
          const slot = pool[Math.floor(Math.random() * pool.length)];
          const who = practiceName();
          const diamonds = slot.diamonds || catalogGift(slot.gift).diamonds || 1;
          const count = diamonds >= 100 ? 1 : 1 + Math.floor(Math.random() * 5);
          gallery.add({
            kind: "gift",
            id: `test-${Date.now()}-${Math.random()}`,
            user: who,
            name: who,
            gift: slot.gift,
            diamonds,
            count,
            total: diamonds * count,
            picture: "",
            avatar: "",
          });
        },
        next: () => gallery.next(),
        clear: () => gallery.clear(),
      },
    };
  },
});
