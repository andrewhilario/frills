// The questions. Written once here, used for the page and for the structured data, so they never disagree.
// `a` is HTML (links allowed); `text` is what search engines get.

export function faq({ kb, waitlistUrl, helperUrl, relayUrl }) {
  // Where to get the TikTok helper: a link once there is a download, a way to hear about it until then, nothing invented in between.
  const getHelper = helperUrl
    ? ` <a href="${helperUrl}" rel="noopener">Get the helper</a>.`
    : waitlistUrl
      ? ` There is no download yet. Want to know when it is ready? <a href="${waitlistUrl}" rel="noopener">Join the waitlist</a>.`
      : " There is no download yet. We will link it from the TikTok guide when it is ready.";
  const items = [
    {
      q: "Is Frills really free?",
      a: "Yes. Every look and every setting is free, with no limits and no account. If we ever add a paid plan, it will be for extras that cost money to run, like syncing your looks between computers, and we will say so up front.",
    },
    {
      q: "Does it work with TikTok LIVE?",
      a: relayUrl
        ? `Yes. TikTok has no official chat connection for overlays, so Frills reads your LIVE’s public chat for you, without logging in to TikTok. Open the editor, pick TikTok and type your @name: it works right in your browser through a free relay (beta) that we run, so there is nothing to install. The relay has a limited number of spots, so you may wait in line when it is busy. The <a href="/guides/tiktok/">TikTok guide</a> has the steps.`
        : `Yes. TikTok has no official way for overlays to read chat, so Frills uses a small free helper that runs on your own PC. It reads your LIVE’s public chat without logging in to TikTok and passes it to your overlay. The helper is still in testing. The <a href="/guides/tiktok/">TikTok guide</a> shows how it works.${getHelper}`,
    },
    {
      q: "Does it work with Twitch?",
      a: "Yes, and it needs nothing installed. Type your channel name and your browser reads the public chat, the way a viewer’s does.",
    },
    {
      q: "Can I show my TikTok and Twitch chat together?",
      a: "Yes, in one chat overlay. In the editor (or the Matcha page, or the <a href=\"/start/\">Quick start</a>) choose <strong>Both</strong>, type your TikTok @name and your Twitch channel, and copy the one link. Messages from both arrive in the same speech bubbles, each with a small TikTok or Twitch icon before the name (you can turn the icon off). A message a moderator deletes on one platform only disappears from that platform. Alerts are still one link for each platform, and last gifts, goals and top likers are for TikTok. This is new and in beta.",
    },
    {
      q: "Do I need an account?",
      a: "No. Your settings live in your browser and in the link you copy. Frills keeps a few things in a small database, but only ones you choose to send it: feedback, and any image, GIF or sound you upload for alerts. The <a href=\"/privacy/\">privacy page</a> lists all of it.",
    },
    {
      q: "How does it read my chat?",
      a: `${relayUrl ? "On TikTok, a free relay we run reads your LIVE’s public chat and passes it to your overlay. The relay keeps none of it." : "On TikTok, the helper on your PC reads your LIVE’s public chat and passes it to the overlay on that same PC."} On Twitch, your browser joins your channel’s public chat without logging in. Either way it can only read: it can’t post and it can’t moderate. Neither company documents these ways of reading chat, so one of them can change without warning. If that happens the overlay says so instead of staying blank, and for Twitch we would switch to Twitch login and say so here.`,
    },
    {
      q: "Do profile pictures show?",
      a: "On TikTok, yes: each chatter’s own picture sits in the round badge beside their message. You can turn that off under More options, because viewers choose their own pictures. Twitch doesn’t share pictures with chat, so Twitch chatters show a letter instead.",
    },
    {
      q: "Will it slow down my stream?",
      a: `The overlay is one small web page, about ${kb} KB with its code, and it draws only a handful of messages at a time, even when chat is fast. We haven’t benchmarked it against other tools, so we won’t claim it’s lighter.${relayUrl ? "" : " On TikTok the helper is a second small program running beside OBS."}`,
    },
    {
      q: "What happens when a moderator deletes a message?",
      a: `On Twitch it disappears from the overlay too, and a timeout or a ban removes everything that person said. ${relayUrl ? "On TikTok Frills passes on deletions as well" : "The TikTok helper passes on deletions as well"}, but we have only tried that with practice chat so far.`,
    },
    {
      q: "Is it safe, and is it allowed?",
      a: `Frills only reads public chat and never asks for your password. It keeps no chat and has no accounts; what it does store is short and listed on the <a href=\"/privacy/\">privacy page</a> (feedback you send, files you upload for alerts, and new Twitch followers’ names for one day if you use that feature). The one optional Twitch login, for follow alerts, happens on Twitch’s own page. ${relayUrl ? "On TikTok it doesn’t log in to your account either." : "The TikTok helper doesn’t log in to your TikTok account either."} TikTok offers no official way for overlays to read chat, so every overlay tool uses an unofficial one, and TikTok could change or block it. Frills isn’t affiliated with Twitch or TikTok.`,
    },
    {
      q: "Does Frills have alerts, a last gifts list, goals and top likers?",
      a: "Yes, for TikTok LIVE, in beta. Alerts pop up for follows, gifts and shares with your own words, animation, effect, sound, image or GIF, and bigger gifts get a bigger alert. Alerts also work for a Twitch channel: new subs and resubs, gifted subs, bits and raids, and follows too, after a one-time Twitch login on a private page that you keep open while you stream (Twitch only gives follows to a logged-in streamer). The last gifts list, the goals (followers, gifts or likes) and the top likers ranking work the same way: pick a look, try it with the test buttons, and copy the link into your streaming app. There are also <a href=\"/songs/\">song requests</a> (viewers ask for songs with !sr), with an optional Spotify player, in beta. See <a href=\"/overlays/\">all the overlays</a>, the <a href=\"/guides/alerts/\">alerts guide</a> and the <a href=\"/overlays/faq/\">overlays FAQ</a>.",
    },
    {
      q: "How do I add it to my stream?",
      a: "Paste your link into a Browser source in your streaming app. Some apps call it a web page or link source. The <a href=\"/guides/obs/\">setup guide</a> has every step for OBS, and other apps work the same way.",
    },
  ];
  return items.map((item) => ({ ...item, text: item.a.replace(/<[^>]+>/g, "") }));
}
