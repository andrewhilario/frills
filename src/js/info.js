// What the account itself says, sent by the relay when it connects and now and then after: whether the LIVE is on, the follower count and how many
// are watching. The relay sends the numbers as they come from TikTok, so every page that uses them checks them here first. This is kept out of
// tiktok.js on purpose: the chat overlay loads that file and has no use for these numbers, and it has almost no room to spare (see site.test.mjs).

/** The numbers worth passing on ({ live, followers, viewers }, each 0 or false when not said), or null when there is nothing in it. */
export function acceptInfo(raw) {
  const whole = (value, max) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n > 0 && n < max ? n : 0;
  };
  const followers = whole(raw?.followers, 1e10);
  const viewers = whole(raw?.viewers, 1e9);
  const live = raw?.live === true;
  return followers || viewers || live ? { live, followers, viewers } : null;
}
