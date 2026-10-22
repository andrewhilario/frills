// The questions about the overlays (alerts, last gifts, goals, top likers), for their own page at /overlays/faq/. Written once here and used for
// the page and for the structured data, like the main FAQ. `a` is HTML (links allowed); `text` is what search engines get.
// Every answer says only what has been built and tried; what is only planned says "coming soon".

export function overlaysFaq({ kb = 19, relayUrl = "" } = {}) {
  const items = [
    {
      q: "Which overlays are there?",
      a: "The <a href=\"/editor/\">chat overlay</a>, <a href=\"/alerts/\">alerts</a>, <a href=\"/gifts/\">last gifts</a>, <a href=\"/goal/\">goals</a> (followers, gifts or likes) and <a href=\"/likers/\">top likers</a>. Each has its own editor, its own look and its own link. All of them are free, with no Frills account. The overlays other than chat are in beta. Song requests are coming soon and are not open to everyone yet.",
    },
    {
      q: "Do the overlays work with Twitch?",
      a: "The chat overlay and the alerts do. On Twitch the alerts show new subs and resubs, gifted subs, bits and raids, and follows too, once you log in to Twitch on one private page (see the questions below). Last gifts, goals and top likers are for TikTok LIVE only for now, because they are built on TikTok gifts and likes. Twitch has no likes, and its gifts are subs and bits, which those overlays do not show yet.",
    },
    {
      q: "How do I add an overlay to my stream?",
      a: "Open the editor, pick a look, press the test buttons, type your name, and copy the link. In your streaming app add a Browser source (some apps call it a web page or link source) and paste the link. Every overlay is its own link and its own source, so you can run as many as you like at the same time. The <a href=\"/guides/obs/\">setup guide</a> has every step. For a vertical LIVE, make the source 1080 wide and 1920 high.",
    },
    {
      q: "Can I try an overlay without going LIVE?",
      a: "Yes. Every editor has test buttons that make a made-up alert, gift or like, and on TikTok the name <code>frills_demo</code> sends a practice LIVE. Nothing is real until you type your own name and you are LIVE. The <a href=\"/guides/test/\">test guide</a> shows how to check your overlay in your streaming app first.",
    },
    {
      q: "Why does my overlay say it is waiting, or nothing arrives?",
      a: "On TikTok, follows, gifts, shares and likes only come while your account is LIVE, and only when someone actually does them. If you just went LIVE, disconnect and connect again in the editor. A quiet chat is not a broken overlay: the editor says it is reading your LIVE as soon as it has heard anything at all. If the free relay is full, the page says you are waiting for a spot, and the line moves as people finish.",
    },
    {
      q: "Why does it say too many Frills pages are open from my internet address?",
      a: "The free relay limits how many Frills pages one internet address can hold open at once, so that one address cannot hog it. Every overlay (chat, alerts, last gifts, goals, top likers) and every editor that is connected counts as one page, so a full set plus a few editors adds up. Close the editors and tabs you are not using, or just wait: the page tries again by itself every few seconds, and pages left behind by a dropped connection (a Wi-Fi blip, a PC that went to sleep) clear on their own. The message says how many pages the relay allows. Some internet providers share one address between many homes, so if you keep seeing it with only your own overlays open, please <a href=\"/feedback/\">tell us</a>.",
    },
    {
      q: "Can I use my own images, GIFs and sounds in alerts?",
      a: "Yes. Under each alert you can upload one image or GIF and one sound, a picture or GIF up to 1 MB and a sound up to 300 KB (PNG, JPEG, WebP or GIF; MP3, OGG or WAV). You have to tick that you have the right to use the file. It is stored by Frills so your link can load it, and you get a delete code once, which you need to keep to delete it yourself. Anyone who has your link can see the file, so do not upload anything private. See the <a href=\"/privacy/\">privacy page</a> for exactly what is kept.",
    },
    {
      q: "Why is there no sound in my streaming app?",
      a: "The alert sound plays from the overlay page itself. We have tried it in a browser, and not in every streaming app, and some apps keep a page silent until you allow it. If yours stays silent, check that the source is not muted in the app’s audio mixer, make sure the alerts volume in the editor is above 0, and tell us which app it is on the <a href=\"/feedback/\">feedback page</a> so we can look into it.",
    },
    {
      q: "How do follow alerts work on Twitch, and why do they need a login?",
      a: "Twitch only tells a logged-in streamer who follows them, so Frills cannot see follows from public chat the way it sees subs and bits. Open <a href=\"/twitch/\">the Twitch follows page</a>, log in with Twitch once (it asks for one permission: seeing who follows your channel), and keep that page open while you stream. Each new follower becomes an alert. In the alerts editor, pick Twitch and tick \"Show Twitch follows in my alerts link\", then copy the link into your streaming app. Twitch logins end after a while, and the page tells you when you need to log in again.",
    },
    {
      q: "Is my Twitch login safe?",
      a: "The login stays in your own browser and is never sent to Frills. Frills only receives the name of each new follower (so your overlay can show it), and keeps those names for one day. You can log out on the follows page, and you can remove Frills in your Twitch connections settings at any time. We have tried this with a test login, so tell us if anything looks wrong.",
    },
    {
      q: "Why are some gifts, follows or likes missing?",
      a: "A few things can hold an alert back: that kind is switched off in the editor, a gift is smaller than the smallest gift you chose to show, or many alerts arrived at once. When the line is longer than you allowed, the oldest follows and shares are dropped first and gifts are kept longest, and a crowd of follows is joined into one alert. TikTok also sends gift streaks (one gift tapped again and again) in pieces, and only the finished streak is shown, once.",
    },
    {
      q: "How do the goals and the top likers count?",
      a: "They count what they see from the moment they connect. The follower goal can start from the account’s real follower count when TikTok tells the relay, while gift and like goals start from zero. Top likers adds up each person’s taps and ranks them live. If the page reloads the goals and the ranking start again, unless you turn on \"remember\" in their editor, which keeps the count in your own browser or streaming app and nowhere else.",
    },
    {
      q: "What happens if the relay restarts or is busy?",
      a: `${relayUrl ? "TikTok comes through the free Frills relay, which has a limited number of spots." : "TikTok comes through a small program that runs on your PC."} If the connection drops, an overlay tries again by itself, waiting a little longer each time, and carries on from then; anything that happened while it was disconnected is missed. If one does not come back, reload it once. We do not keep the chat or the alerts that pass through.`,
    },
    {
      q: "Will the overlays slow down my stream?",
      a: `Each overlay is one small web page, about ${kb} KB with its code for the chat overlay, and it draws only a few things at a time. The frosted blur in the chat looks costs more on a weak PC, so turn it off if your stream stutters. We have not measured it against other tools.`,
    },
    {
      q: "What does Frills keep about me and my viewers?",
      a: "No account and no chat. The relay passes chat, gifts and likes to your overlay and does not keep them. What Frills stores is short: feedback you send, any image or sound you upload for alerts, the new Twitch followers' names for one day if you use that feature, and the song playing if you share Spotify. The <a href=\"/privacy/\">privacy page</a> lists all of it.",
    },
  ];
  return items.map((item) => ({ ...item, text: item.a.replace(/<[^>]+>/g, "") }));
}
