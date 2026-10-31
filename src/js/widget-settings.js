// Settings for the smaller overlays (Last Gifts, Follower Goal): the same idea as the alerts and chat settings, written once so each
// overlay only lists its options. One list of controls builds the editor, checks anything that arrives (saved in the browser, or in a
// link), and writes the link. Pure code, so it is tested without a page.

import { HEX } from "./color.js";
import { CONTROLS as ALERT_CONTROLS, DEFAULTS as ALERT_DEFAULTS, LOOKS, LOOK_KEYS, MEDIA_ID, SEASON_LOOKS } from "./alerts-settings.js";

export { LOOKS, LOOK_NAMES, alertVars as lookVars, currentLook, looksFor } from "./alerts-settings.js";

const LOOK_PICKS = ["accent", "bg", "text", "pop", "font", "size", "letterSpacing", "align", "radius", "border", "shadow"];
/** The look options every overlay shares (colours, font, size, corners, edge, shadow), taken from the alerts so they can never differ. */
export const LOOK_CONTROLS = ALERT_CONTROLS.filter((c) => c.section === "look" && LOOK_PICKS.includes(c.key));
export const LOOK_DEFAULTS = Object.fromEntries(LOOK_PICKS.map((k) => [k, ALERT_DEFAULTS[k]]));

export const range = (key, label, min, max, step, unit, extra = {}) => ({ key, type: "range", label, min, max, step, unit, ...extra });
export const number = (key, label, min, max, extra = {}) => ({ key, type: "number", label, min, max, ...extra });
export const toggle = (key, label, hint) => ({ key, type: "toggle", label, hint });
export const text = (key, label, max = 80, hint) => ({ key, type: "text", label, max, hint });
/** A picture the streamer uploads (the setting holds only its id, "" for none). */
export const imageOf = (key, label, hint) => ({ key, type: "media", media: "image", label, hint });
export const chipsOf = (key, label, options) => ({ key, type: "chips", label, options: options.map(([id, name]) => ({ id, name })) });
export const selectOf = (key, label, options, hint) => ({ key, type: "select", label, options: options.map(([id, name]) => ({ id, name })), hint });

/** One value, checked against its control. Returns undefined if it isn't acceptable. */
export function coerce(control, value) {
  if (control.type === "color") return typeof value === "string" && HEX.test(value) ? value.toLowerCase() : undefined;
  if (control.type === "range") {
    const n = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
    return Number.isFinite(n) ? Math.min(control.max, Math.max(control.min, Math.round(n / control.step) * control.step)) : undefined;
  }
  if (control.type === "number") {
    const n = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
    return Number.isFinite(n) ? Math.min(control.max, Math.max(control.min, Math.round(n))) : undefined;
  }
  if (control.type === "toggle") return typeof value === "boolean" ? value : undefined;
  if (control.type === "media") return value === "" || (typeof value === "string" && MEDIA_ID.test(value)) ? value : undefined;
  if (control.type === "text") return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, control.max) : undefined;
  return control.options.some((o) => o.id === value) ? value : undefined;
}

/**
 * Builds the settings functions for one overlay. `controls` is its own list (each with a `section` for the editor), `defaults` its own
 * defaults. The shared look options are added in front, with the starting looks.
 */
export function defineWidget({ controls, defaults }) {
  const all = [...LOOK_CONTROLS, ...controls];
  const base = { ...LOOK_DEFAULTS, ...defaults };

  const sanitize = (raw) => {
    const out = { ...base };
    if (!raw || typeof raw !== "object") return out;
    for (const control of all) {
      const value = coerce(control, raw[control.key]);
      if (value !== undefined) out[control.key] = value;
    }
    return out;
  };
  const fromParams = (params) => {
    const raw = {};
    const named = { ...LOOKS, ...SEASON_LOOKS }; // a seasonal look is understood all year
    const asked = params.get("look");
    if (Object.prototype.hasOwnProperty.call(named, asked)) Object.assign(raw, Object.fromEntries(LOOK_KEYS.filter((k) => LOOK_PICKS.includes(k)).map((k) => [k, named[asked][k]])));
    for (const control of all) {
      if (!params.has(control.key)) continue;
      const value = params.get(control.key);
      raw[control.key] = control.type === "toggle" ? value === "1" : control.type === "range" || control.type === "number" ? Number(value) : value;
    }
    return raw;
  };
  const toParams = (settings, params = new URLSearchParams()) => {
    for (const control of all) {
      const value = settings[control.key];
      if (value === base[control.key]) continue;
      params.set(control.key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
    }
    return params;
  };
  /** The address a streamer pastes into their streaming app. */
  const url = (overlayBase, { channel = "", settings = base } = {}) => {
    const params = new URLSearchParams();
    if (channel) {
      params.set("channel", channel);
      params.set("platform", "tiktok");
    }
    return overlayBase + "?" + toParams(settings, params);
  };
  return { controls: all, defaults: base, sanitize, fromParams, toParams, url };
}
