# Plan: Top Likers, Last Gifts, Follower Goal and Alerts

Plan only. Nothing is built yet. TikTok only (Twitch gives chat without login, but not likes, gifts or follows).

## What TikTok gives us (read from the connector's own typings, version 2.5.0)

| Event | What is in it | What we can build |
| --- | --- | --- |
| Like | who tapped, how many taps in this batch (`likeCount`), the room's total (`totalLikeCount`) | Top Likers: add up each person's taps ourselves |
| Gift | who, the gift name, picture, diamond value, repeat count, whether the streak ended | Last Gifts, gift alerts |
| Follow (social event) | who followed; a `followCount` field | Follower goal, follow alerts |
| Share | who shared | share alerts |
| Subscribe | a subscribe notice | subscribe alerts (if it fires for the account) |
| Room ranking | TikTok's own top gifters with coin counts | an optional "Top Gifters" board later |
| Goal update | TikTok's own LIVE goal with progress and target | optional: mirror the streamer's TikTok goal later |

Things I have NOT verified and will check first on a real LIVE:
1. Whether `followCount` is the streamer's current follower total or something else. If it isn't, the goal starts from a number the streamer types (or from zero: "gained this LIVE").
2. Whether like events carry a per-person total. I expect not, so Top Likers counts only from the moment the page connected. It cannot see taps that happened before.
3. How often like events arrive on a busy LIVE (they can be many per second).
4. Whether subscribe notices arrive at all.

## How it fits what exists

- The relay (and the PC helper) already read TikTok and send chat to the page. We add more event kinds to the same stream: `gift`, `like`, `follow`, `share`, `sub`. A page asks only for what it needs (`events=gift,like`), so the chat overlay does not get extra traffic.
- The relay stays stateless. The totals (who liked most, how many followers gained) are added up in the overlay page, in memory, and optionally saved in that browser only (localStorage in OBS). Frills' servers keep no viewer data. That matches the privacy page.
- Likes are the heavy one. The relay adds up each person's likes for one second before sending, so a busy LIVE sends about one small message per liker per second, not one per tap.
- Slots count accounts, not pages (checked in `helper/rooms.mjs`), so chat + likers + gifts + goal + alerts for one streamer use one slot. But the per-visitor limit is 4 open pages, and five overlays is 5. It needs raising to about 8.
- The practice account `frills_demo` gets made-up likes, gifts, follows and shares too, so every widget can be tried and recorded without a LIVE.

## The four widgets (each is its own link, same looks and options style as chat)

**1. Last Gifts** (build first, it is the smallest)
- A chat-style list of the most recent gifts: picture of the chatter, name, "sent Rose ×3", and the gift picture.
- Options: how many to show (1 to 20, default 10), new at top or bottom, how long each stays (or stays), show diamond value, minimum diamonds to show, collapse streaks into one line (on by default), same colours, fonts, roundness and entrance as the chat looks.

**2. Top Likers** (Top 1 to Top 10)
- A ranked list: rank number, round picture, name, like count. The top 3 get a small crown (the frog crown for the matcha looks). When someone passes someone else the rows slide into their new places.
- Options: how many (3 to 10, default 10), title text, show counts, show pictures (follows the same "use profile pictures" choice), count since this LIVE started or keep across LIVEs, minimum likes to appear, hide the streamer's own account, a Reset button in the editor.
- Honest limit: it only counts taps it saw. If the page is opened mid-LIVE, earlier taps are not counted.

**3. Follower Goal**
- A progress bar: "Followers 37 / 50", with a label you can rename.
- Starts from the streamer's current followers if TikTok gives that number, otherwise from a number they type, or from zero ("gained this LIVE"). Each follow adds one. Unfollows are not seen.
- When the goal is reached: a small celebration, then an optional "next goal" (add a step, for example +25).
- Options: target, step, label, bar shape and colours, show numbers or percent.
- The same bar can later count likes or gifts instead of followers with almost no extra work.

**4. Alerts**
- Pop-up banners: "mochi_bun just followed!", "kero_chan sent Rose ×5", "tadpole shared the LIVE", optional like milestones ("1,000 likes!").
- Options: which kinds are on, text for each (with `{name}` and `{gift}`), minimum gift value, how long it shows, a cap on the queue so a flood of follows does not run for ten minutes, and the same looks.
- Sounds: soft built-in pops made in the browser (no files). OBS only plays a browser source's sound if "Control audio via OBS" is ticked, so the guide has to say that. Custom sounds later, if wanted.
- Not included: "viewer joined" alerts. They are very frequent and add little.

## The editor and pages

- A new page `/widgets/` with one card per widget (live preview with made-up events, settings, link). Linked from the nav and the home page.
- One new guide section per widget, an FAQ entry, the privacy page updated ("totals are added up in your browser").
- Each overlay page stays small (the chat overlay is held to 20 KB; each widget gets its own budget and test).

## Order of work and rough size

| Step | What | Size |
| --- | --- | --- |
| 0 | Check the four unknowns above on a real LIVE (reads only, no viewer data kept) | small, needs you to go LIVE or to name a public LIVE |
| 1 | The shared part: new event kinds, per-page filter, like adding-up, per-visitor limit to 8, practice events, tests | medium |
| 2 | Last Gifts | small |
| 3 | Top Likers | medium |
| 4 | Follower Goal | small to medium |
| 5 | Alerts | medium |
| 6 | `/widgets/` page, guides, FAQ, privacy, nav, tests, deploy | medium |

Each step ends with tests and a look in a real browser; I push when you ask.

## Risks to say out loud

- All of it rests on TikTok's unofficial feed. A TikTok change can break likes, gifts and follows separately from chat.
- Gift and like numbers can be off by what the feed drops (a reconnect, a missed batch). The overlay is a good-looking guide, not an accounting tool. I would say so in the guide.
- More event kinds mean more traffic on your phone. Like adding-up and the per-page filter keep it small, but it should be load-tested with `frills_demo` before many streamers use it.
- Gift pictures belong to TikTok. We load them straight from TikTok's servers and never copy or store them. Whether TikTok minds is not something I have checked.

## Decisions for you

1. Build order: Gifts, Likers, Goal, Alerts (my suggestion), or another order?
2. Should Top Likers and the goal remember their totals between LIVEs by default, or start fresh each LIVE (my suggestion: fresh, with "keep" as an option)?
3. Do you want an "all in one" overlay (several widgets in one OBS source) as a later step, or is one link per widget fine?
4. Step 0 needs a real LIVE. Will you be on LIVE soon, or should I use someone else's public LIVE for the check (counts only, nothing saved)?
