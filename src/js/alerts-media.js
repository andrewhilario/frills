// The "your own image / GIF / sound" picker in the alerts editor: tick that you have the right to use the file, choose it, and it is
// uploaded to Frills (see worker/media.mjs). The setting holds only the file's id. The delete code Frills hands back is kept in this
// browser, so the same person can delete the file later; it is shown once so it can be kept somewhere else too.

import { el } from "./feed.js";
import { MEDIA_ID, mediaUrl } from "./alerts-settings.js";

const MAX = 300 * 1024;
const ACCEPT = { image: "image/png,image/jpeg,image/webp,image/gif", sound: "audio/mpeg,audio/ogg,audio/wav,.mp3,.ogg,.wav" };
const WORDS = {
  too_big: "That file is over 300 KB. Make it smaller (a shorter sound, or a smaller GIF) and try again.",
  bad_type: "Frills takes png, jpg, webp or gif pictures and mp3, ogg or wav sounds.",
  busy: "A lot of files were uploaded in the last hour. Please try again in a few minutes.",
  full: "Frills has no room for more files right now.",
  not_ready: "Uploads are not working right now. Please try again later.",
  no_consent: "Please tick that you have the right to use this file.",
  wrong_origin: "Uploads only work from the Frills website.",
};

const STORE = "frills:alerts:media:v1"; // { id: deleteCode }
const codes = () => { try { return JSON.parse(localStorage.getItem(STORE) ?? "{}"); } catch { return {}; } };
const remember = (id, code) => { try { localStorage.setItem(STORE, JSON.stringify({ ...codes(), [id]: code })); } catch { /* storage can be blocked */ } };
const forget = (id) => { try { const all = codes(); delete all[id]; localStorage.setItem(STORE, JSON.stringify(all)); } catch { /* ignore */ } };

/**
 * One picker. `kind` is "image" or "sound". `onSet(id)` runs when the file changes ("" when removed). Returns { row, write(id) } like
 * buildControl does, so the editor treats it as any other control.
 */
export function mountMediaPicker({ kind, label, hint, value, onSet, consentBox }) {
  const id = "media-" + Math.random().toString(36).slice(2, 8);
  const row = el("div", { className: "ctl ctl--wide media" });
  const title = el("span", { className: "ctl__label", textContent: label });
  const preview = el("div", { className: "media__preview" });
  const status = el("p", { className: "media__status", role: "status" });
  const input = el("input", { type: "file", id: id + "-file", accept: ACCEPT[kind], disabled: true });
  const choose = el("label", { className: "btn btn--soft btn--sm media__choose", htmlFor: id + "-file", textContent: kind === "image" ? "Choose an image or GIF" : "Choose a sound" });
  const clear = el("button", { type: "button", className: "btn btn--outline btn--sm", textContent: "Remove" });
  const erase = el("button", { type: "button", className: "btn btn--outline btn--sm", textContent: "Delete from Frills" });
  const tools = el("div", { className: "media__tools" }, choose, input, clear, erase);
  row.append(title);
  if (hint) row.append(el("small", { className: "ctl__hint", textContent: hint }));
  row.append(preview, tools, status);

  let current = "";
  const say = (text, bad = false) => { status.textContent = text; status.dataset.state = bad ? "error" : ""; };

  function write(next) {
    current = MEDIA_ID.test(next ?? "") ? next : "";
    preview.replaceChildren();
    if (current) {
      preview.append(kind === "image" ? el("img", { src: mediaUrl(current), alt: "Your uploaded image" }) : el("audio", { src: mediaUrl(current), controls: true, preload: "none" }));
    }
    clear.hidden = !current;
    erase.hidden = !current || !codes()[current];
  }

  const refreshChoose = () => {
    input.disabled = !consentBox.checked;
    choose.classList.toggle("is-off", !consentBox.checked);
    choose.title = consentBox.checked ? "" : "Tick the box above first: you need the right to use the file.";
  };
  consentBox.addEventListener("change", refreshChoose);
  refreshChoose();

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (file.size > MAX) return say(WORDS.too_big, true);
    say("Uploading…");
    try {
      const res = await fetch("/api/media", { method: "POST", headers: { "content-type": "application/octet-stream", "x-consent": consentBox.checked ? "yes" : "no" }, body: file });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok !== true) return say(WORDS[body.error] ?? "Sorry, that did not upload. Please try again.", true);
      if (body.kind !== kind) {
        // the wrong kind of file for this place (a sound where an image goes): take it back out again
        await fetch(`/api/media/${body.id}`, { method: "DELETE", headers: { "x-delete-code": body.deleteCode } }).catch(() => {});
        return say(kind === "image" ? "That is a sound. Choose a png, jpg, webp or gif picture here." : "That is a picture. Choose an mp3, ogg or wav sound here.", true);
      }
      remember(body.id, body.deleteCode);
      write(body.id);
      onSet(body.id);
      say(`Uploaded. Your delete code is ${body.deleteCode}. It is kept in this browser; copy it if you want to delete the file from another one.`);
    } catch {
      say("Sorry, that did not upload. Check your connection and try again.", true);
    }
  });

  clear.addEventListener("click", () => { write(""); onSet(""); say(""); });
  erase.addEventListener("click", async () => {
    const target = current;
    const code = codes()[target];
    if (!target || !code) return;
    try {
      const res = await fetch(`/api/media/${target}`, { method: "DELETE", headers: { "x-delete-code": code } });
      if (!res.ok && res.status !== 404) return say("Could not delete the file. Please try again.", true);
      forget(target);
      write("");
      onSet("");
      say("Deleted from Frills.");
    } catch {
      say("Could not delete the file. Check your connection and try again.", true);
    }
  });

  write(value);
  return { row, write };
}
