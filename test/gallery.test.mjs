// Pure unit tests for Gift Gallery Rotator (src/js/gallery.js): settings, URL round-trip, catalog lookup,
// custom gallery unlock + repeat + jump + rotation, live auto-collect mode, and localStorage persistence.

import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GALLERY_ITEMS,
  GALLERY,
  GALLERY_LAYOUTS,
  GALLERY_PRESETS,
  GiftGallery,
  MAX_GALLERY_ITEMS,
  catalogGift,
  decodeGalleryItems,
  encodeGalleryItems,
  galleryKey,
  loadGallery,
  saveGallery,
} from "../src/js/gallery.js";
import { coerce } from "../src/js/widget-settings.js";

function clock() {
  let now = 0;
  let next = 1;
  const jobs = new Map();
  return {
    setTimeout: (fn, ms) => { const id = next++; jobs.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: (id) => jobs.delete(id),
    tick(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...jobs].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        jobs.delete(due[0]);
        due[1].fn();
      }
      now = end;
    },
  };
}

test("Gallery settings, catalog lookup, presets, and URL round-trip validate cleanly", () => {
  assert.ok(GALLERY_LAYOUTS.length >= 7);
  assert.ok(GALLERY_PRESETS.length >= 3);
  for (const c of GALLERY.controls) assert.notEqual(coerce(c, GALLERY.defaults[c.key]), undefined, c.key);

  assert.equal(catalogGift("galaxy").diamonds, 1000);
  assert.equal(catalogGift("Rose").icon, "rose");
  assert.equal(catalogGift("Mystery Custom Gift").icon, "gift");

  const customItems = [
    { gift: "Rose", diamonds: 1, caption: "Shoutout" },
    { gift: "Confetti", diamonds: 100, caption: "Sticky note on face" },
    { gift: "rose", diamonds: 99, caption: "Duplicate ignored" },
  ];
  const encoded = encodeGalleryItems(customItems);
  const decoded = decodeGalleryItems(encoded);
  assert.deepEqual(decoded, [
    { gift: "Rose", diamonds: 1, caption: "Shoutout" },
    { gift: "Confetti", diamonds: 100, caption: "Sticky note on face" },
  ]);

  const s = GALLERY.sanitize({ mode: "custom", layout: "neon", enter: "flip", anim: "pulse", rotateSec: 99, title: "My\u0000Gifts", items: encoded });
  assert.deepEqual([s.layout, s.enter, s.anim, s.rotateSec, s.title], ["neon", "flip", "pulse", 30, "My Gifts"]);

  const url = new URL(GALLERY.url("https://x.test/overlay/gallery/", { channel: "pondpal", platform: "tiktok", settings: s }));
  assert.equal(url.searchParams.get("layout"), "neon");
  assert.equal(url.searchParams.get("enter"), "flip");
  assert.equal(url.searchParams.get("anim"), "pulse");
  assert.deepEqual(GALLERY.sanitize(GALLERY.fromParams(url.searchParams)), s);

  // Default payload stays omitted from URL so links stay clean and short
  const defUrl = new URL(GALLERY.url("https://x.test/overlay/gallery/", { channel: "pondpal", platform: "tiktok", settings: GALLERY.defaults }));
  assert.equal(defUrl.searchParams.has("items"), false);
  assert.equal(defUrl.searchParams.has("anim"), false);
  assert.equal(decodeGalleryItems("not-valid-base64!!!").length, DEFAULT_GALLERY_ITEMS.length);

  // Enforces MAX_GALLERY_ITEMS cap
  const many = Array.from({ length: 30 }, (_, i) => ({ gift: `Gift ${i + 1}`, diamonds: i + 1, caption: "" }));
  assert.equal(decodeGalleryItems(encodeGalleryItems(many)).length, MAX_GALLERY_ITEMS);
});

test("Custom GiftGallery lights up matching gifts, jumps & celebrates, ignores non-gallery gifts, and rotates on schedule", () => {
  const timers = clock();
  const items = encodeGalleryItems([
    { gift: "Rose", diamonds: 1, caption: "Thanks!" },
    { gift: "Confetti", diamonds: 100, caption: "Sticky note" },
    { gift: "Galaxy", diamonds: 1000, caption: "Slow-mo replay" },
  ]);
  const gallery = new GiftGallery({ ...GALLERY.defaults, rotateSec: 4, items }, { timers });

  assert.equal(gallery.snapshot().totalSlots, 3);
  assert.equal(gallery.snapshot().unlockedCount, 0);
  assert.equal(gallery.snapshot().card.gift, "Rose");
  assert.equal(gallery.snapshot().card.unlocked, false);

  // Unlisted gift is ignored in custom mode
  assert.equal(gallery.add({ kind: "gift", user: "a", name: "Ann", gift: "Lion", diamonds: 29999, count: 1 }), false);
  assert.equal(gallery.snapshot().unlockedCount, 0);

  // Matching gift lights up slot, jumps straight to it, and marks celebrateKind = "unlock"
  assert.equal(gallery.add({ kind: "gift", user: "m", name: "Mochi", gift: "Confetti", diamonds: 100, count: 1, picture: "https://p16.tiktokcdn.com/confetti.png" }), true);
  let snap = gallery.snapshot();
  assert.equal(snap.card.gift, "Confetti");
  assert.equal(snap.card.unlocked, true);
  assert.equal(snap.card.sender, "Mochi");
  assert.equal(snap.card.count, 1);
  assert.equal(snap.card.picture, "https://p16.tiktokcdn.com/confetti.png");
  assert.equal(snap.unlockedCount, 1);
  assert.equal(snap.celebrateKind, "unlock");

  // Second send of same gift increments count, keeps firstSender as "Lit up by", sets celebrateKind = "repeat"
  assert.equal(gallery.add({ kind: "gift", user: "p", name: "Pond", gift: "confetti", diamonds: 100, count: 2 }), true);
  snap = gallery.snapshot();
  assert.equal(snap.card.count, 3);
  assert.equal(snap.card.sender, "Mochi");
  assert.equal(snap.card.lastSender, "Pond");
  assert.equal(snap.celebrateKind, "repeat");

  // Rotation advances strictly every 4 seconds
  const seen = [gallery.snapshot().card.gift];
  timers.tick(4000); seen.push(gallery.snapshot().card.gift);
  timers.tick(4000); seen.push(gallery.snapshot().card.gift);
  timers.tick(4000); seen.push(gallery.snapshot().card.gift);
  assert.deepEqual(seen, ["Confetti", "Galaxy", "Rose", "Confetti"]);
  gallery.stop();
});

test("Auto-collect live GiftGallery collects unique gifts, persists via localStorage, and resets cleanly", () => {
  const timers = clock();
  const gallery = new GiftGallery({ ...GALLERY.defaults, mode: "live", rotateSec: 5 }, { timers });
  assert.equal(gallery.snapshot().card.empty, true);
  assert.equal(gallery.snapshot().count, 0);

  gallery.add({ kind: "gift", user: "u1", name: "Ann", gift: "Rose", diamonds: 1, count: 5 });
  gallery.add({ kind: "gift", user: "u2", name: "Ben", gift: "Galaxy", diamonds: 1000, count: 1 });
  gallery.add({ kind: "gift", user: "u3", name: "Cat", gift: "Rose", diamonds: 1, count: 2 });

  assert.equal(gallery.snapshot().count, 2);
  assert.equal(gallery.snapshot().unlockedCount, 2);
  assert.equal(gallery.cards().find((c) => c.gift === "Rose").count, 7);
  assert.equal(gallery.cards().find((c) => c.gift === "Rose").sender, "Ann");

  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  saveGallery(storage, "pondpal", gallery);
  assert.ok(store.has(galleryKey("pondpal")));

  const restored = new GiftGallery({ ...GALLERY.defaults, mode: "live" }, { timers, initial: loadGallery(storage, "pondpal") });
  assert.deepEqual(restored.cards().map((c) => [c.gift, c.count, c.sender]), [["Rose", 7, "Ann"], ["Galaxy", 1, "Ben"]]);

  gallery.clear();
  assert.equal(gallery.snapshot().count, 0);
  assert.equal(gallery.snapshot().card.empty, true);
  gallery.stop();
  restored.stop();
});
