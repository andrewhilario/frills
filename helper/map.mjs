// TikTok's events -> the chat messages Frills draws. Pure functions: no network and no TikTok library needed, so they can be tested alone.
// The shapes below are what tiktok-live-connector 2.5.0 really delivers (checked against a live room on 2026-10-07): the text is in
// `content`, the person is `user` (`displayId` is their @name, `id` their number, `nickname` what is shown), and what they are to the
// streamer is in `userIdentity`. Older versions used `comment` and `uniqueId`, so those are read too.

import { isAvatarUrl } from "../src/js/tiktok.js";

/** One line of plain text: no control characters, no runs of spaces, at most `max` characters. */
const clean = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * The address of a chatter's profile picture, or "". TikTok lists several addresses per picture (the same image on other servers, as
 * WebP and as JPEG); the first one the page may load is used. HEIC is skipped because browsers can't draw it.
 */
export function avatarUrl(user) {
  for (const image of [user?.avatarThumb, user?.avatarMedium, user?.avatarLarge]) {
    for (const address of Array.isArray(image?.urlList) ? image.urlList : []) if (isAvatarUrl(address)) return address;
  }
  return "";
}

/** A chat event -> a message, or null when there is nothing to draw. */
export function mapChat(d) {
  const text = clean(d?.content ?? d?.comment, 300);
  const u = d?.user;
  if (!text || !u) return null;
  const handle = clean(u.displayId ?? u.uniqueId, 40);
  const who = d.userIdentity ?? {};
  return {
    id: clean(d.common?.msgId ?? d.msgId, 60),
    user: clean(u.idStr || u.id || u.userId || handle, 40),
    name: clean(u.nickname, 40) || handle || "viewer",
    text,
    mod: who.isModeratorOfAnchor === true,
    gifter: who.isGiftGiverOfAnchor === true,
    gift: false,
    avatar: avatarUrl(u),
  };
}

/**
 * A gift event -> a message like "sent Rose ×3", or null. Some gifts come as a streak that counts up: those arrive again and again,
 * and only the last one (repeatEnd) carries the final count, so that is the only one shown.
 */
export function mapGift(d) {
  const u = d?.user;
  if (!u) return null;
  const gift = d.gift ?? d.giftDetails ?? {};
  const streak = Number(gift.type ?? gift.giftType) === 1;
  if (streak && !d.repeatEnd) return null;
  const name = clean(gift.name ?? gift.giftName ?? d.giftName, 40) || "a gift";
  const count = Math.max(1, Math.min(9999, Math.round(Number(d.repeatCount) || Number(d.groupCount) || 1)));
  const handle = clean(u.displayId ?? u.uniqueId, 40);
  return {
    id: clean(d.common?.msgId ?? d.msgId, 60),
    user: clean(u.idStr || u.id || u.userId || handle, 40),
    name: clean(u.nickname, 40) || handle || "viewer",
    text: `sent ${name} ×${count}`,
    mod: false,
    gifter: true,
    gift: true,
    avatar: avatarUrl(u),
  };
}

/** A moderator's delete event -> the message ids and the person ids whose messages go. */
export function mapDelete(d) {
  const list = (v) => (Array.isArray(v) ? v.map((x) => clean(x, 60)).filter(Boolean) : []);
  return { ids: list(d?.deleteMsgIds), users: list(d?.deleteUserIds) };
}
