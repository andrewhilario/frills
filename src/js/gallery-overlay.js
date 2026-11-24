// Gift Gallery Rotator overlay (/overlay/gallery/): what OBS Studio or TikTok LIVE Studio opens.
// Rotates smoothly through your custom TikTok LIVE Gift Gallery (lighting up gifts live as viewers send them)
// or auto-collects every unique gift sent during your LIVE.
//   /overlay/gallery/?channel=yourname&rotateSec=5
//   add &demo=1 for practice gift unlocks instead of a real stream

import { GALLERY, GiftGallery, catalogGift, loadGallery, saveGallery } from "./gallery.js";
import { createGalleryView } from "./widgets-view.js";
import { channelFromParams, connectEvents } from "./widget-overlay.js";
import { practiceName } from "./fake-alerts.js";
import { fontsReady, generalFaces } from "./look.js";

const params = new URLSearchParams(location.search);
const settings = GALLERY.sanitize(GALLERY.fromParams(params));
const demoPace = Number(params.get("pace")) ? Math.min(10000, Math.max(400, Number(params.get("pace")))) : 0;

const note = document.getElementById("note");
const say = (text) => { if (!note) return; note.hidden = !text; note.textContent = text; };
const channel = channelFromParams(params, "tiktok");
const demo = params.get("demo") === "1";

const view = createGalleryView(document.getElementById("gallery"));
view.apply(settings);
let saving = 0;

const gallery = new GiftGallery(settings, {
  initial: !demo && settings.keep && channel ? loadGallery(globalThis.localStorage, channel) : null,
  onChange: (snap) => {
    view.render(snap);
    if (!demo && settings.keep && channel && !saving) {
      saving = setTimeout(() => { saving = 0; saveGallery(globalThis.localStorage, channel, gallery); }, 1500);
    }
  },
});

if (demo) {
  const first = gallery.nextUnlitGift();
  const d0 = first.diamonds || catalogGift(first.gift).diamonds || 1;
  gallery.add({ kind: "gift", id: "demo-0", user: "Mochi Bun", name: "Mochi Bun", gift: first.gift, diamonds: d0, count: 2, total: d0 * 2, picture: "", avatar: "" });
  view.render(gallery.snapshot());
  fontsReady(generalFaces(settings), 1000).then(() => {
    const tick = () => {
      const target = gallery.nextUnlitGift();
      const who = practiceName();
      const diamonds = target.diamonds || catalogGift(target.gift).diamonds || 1;
      gallery.add({ kind: "gift", id: `demo-${Date.now()}`, user: who, name: who, gift: target.gift, diamonds, count: 1, total: diamonds, picture: "", avatar: "" });
      const waitMs = demoPace ? demoPace : (2600 + Math.random() * 2000);
      setTimeout(tick, waitMs);
    };
    setTimeout(tick, demoPace || 2200);
  });
} else {
  view.render(gallery.snapshot());
  if (!channel) {
    say("Add ?channel=yourname to this link.");
  } else {
    const fonts = fontsReady(generalFaces(settings), 1000);
    connectEvents({
      channel,
      platform: "tiktok",
      events: ["gift"],
      onAlert: (event) => fonts.then(() => gallery.add(event)),
      say,
    });
  }
}
