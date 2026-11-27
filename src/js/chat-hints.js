// Editor-only helper text for chat and matcha controls. Kept out of settings.js and matcha.js so the OBS /overlay/ bundle stays lean.

export const CHAT_HINTS = {
  place: "Where the messages sit in your overlay: at the bottom, growing upward (as now), or at the top, growing downward. Make the browser source as tall as the space you want to give the chat.",
  source: "Shown when one chat reads both TikTok and Twitch.",
  deco: "Hand-drawn sticker packs laid over the bubbles: a friend peeking over the top, a corner scene, and sparkles.",
  decoSide: "The friend peeking over the top goes on the other side.",
  tag: "A pill puts the name in a small rounded label that overlaps the top-left edge of the bubble, in your look's accent color.",
  stay: "Messages never fade by themselves. The oldest one leaves only when newer ones need the room (see Messages on screen under More options).",
  blur: "Looks like frosted glass, but costs more on a weak PC.",
  avatar: "The round badge beside each message: a letter, or the chatter's own picture.",
  pictures: "TikTok chatters pick their own pictures, so turn this off if you would rather not risk showing one you didn't choose. Twitch has no pictures to show.",
};

export const MATCHA_HINTS = {
  ...CHAT_HINTS,
  round: "The corners of the boxes. Pixel Pond and Clean Broadcast have none.",
  opacity: "Clean Broadcast has no box, so it ignores this.",
  speed: "Used once you pick an entrance above.",
};

export const withHint = (control, hints = CHAT_HINTS) => (control.hint || !hints[control.key] ? control : { ...control, hint: hints[control.key] });
