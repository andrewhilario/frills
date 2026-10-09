// Puts a look on a stage element: the general look (settings -> CSS variables) or one of the matcha styles. Returns the options the
// feed should be configured with.

import { ANIMS, FONTS, lookVars } from "./settings.js";
import { matchaVars } from "./matcha.js";

const MATCHA_CLASSES = ["look-latte", "look-glass", "look-sticker", "look-pixel", "look-minimal", "look-night"];

export function paintGeneral(stage, settings) {
  const { vars, attrs, feed } = lookVars(settings);
  stage.classList.remove(...MATCHA_CLASSES);
  stage.classList.add("look", "look-general");
  for (const [name, value] of Object.entries(vars)) stage.style.setProperty(name, value);
  stage.dataset.shape = attrs.shape;
  stage.dataset.avatar = attrs.avatar;
  return feed;
}

// The faces each look draws with, as CSS font shorthands, so they can be fetched before the first message is drawn.
export const generalFaces = (s) => [`500 ${s.size}px "${s.font}"`, `700 ${s.size}px "${s.font}"`];
export const MATCHA_FACES = {
  latte: ['500 16px "Fredoka"'],
  glass: ['600 16px "Plus Jakarta Sans"'],
  sticker: ['500 16px "Baloo 2"', '700 16px "Baloo 2"'],
  pixel: ['400 9px "Press Start 2P"'],
  minimal: ['700 17px "Plus Jakarta Sans"'],
  night: ['500 16px "Fredoka"'],
};

/** Resolves when the faces have loaded, or after `ms` whichever comes first, so a slow font never holds the chat back for long. */
export function fontsReady(faces, ms = 900) {
  if (!document.fonts) return Promise.resolve();
  const loaded = Promise.all(faces.map((face) => document.fonts.load(face).catch(() => [])));
  return Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, ms))]);
}

/** The faces a matcha look draws with: the style's own, or the one the settings picked instead. */
export const matchaFaces = (settings) => (settings.font ? generalFaces({ size: 16, font: settings.font }) : MATCHA_FACES[settings.style]);

export function paintMatcha(stage, settings) {
  stage.classList.remove("look-general", ...MATCHA_CLASSES);
  stage.classList.add("look", "look-" + settings.style);
  for (const [name, value] of Object.entries(matchaVars(settings))) stage.style.setProperty(name, value);
  // A font or an entrance picked in the settings replaces the style's own. Left empty, the variable is removed so the style's own shows.
  const anim = settings.anim ? ANIMS[settings.anim] : null;
  const picked = {
    "--m-font": settings.font ? FONTS[settings.font] : null,
    "--m-anim": anim?.name ?? null,
    "--m-ease": anim?.ease ?? null,
    "--m-speed": anim ? settings.speed + "ms" : null,
  };
  for (const [name, value] of Object.entries(picked)) {
    if (value) stage.style.setProperty(name, value);
    else stage.style.removeProperty(name);
  }
  stage.dataset.avatar = settings.avatar ? "on" : "off";
  stage.dataset.font = settings.font ? "custom" : "own";
  return { max: settings.max, life: settings.life * 1000, modIcon: settings.modIcon, colors: settings.colors, emotes: settings.emotes, pictures: settings.pictures };
}
