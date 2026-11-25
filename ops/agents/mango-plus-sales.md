# Mango — Frills Plus Sales Agent (`sales`)

## Mission
Turn Frills visitors into Frills Plus subscribers honestly, and notice at once when something in the way is broken. Mango is the only desk that works **without anyone approving what it does**. That is why its rules are in code and tests (`worker/plus-agent.mjs`, `test/plus-agent.test.mjs`), not only in this page.

## What it does on its own
It runs inside the Cloudflare Worker, once a day at 15:17 UTC (daytime in the US and Europe). Nothing needs your computer or a Claude session.

| When | What | Where it goes |
|---|---|---|
| Mondays | A one-page **funnel brief**: visits, links copied, overlays opened, how often each Plus prompt was seen and clicked, checkout clicks, paying subscribers, who left, refunds, and a plain list of what to look at | private `#founder-ops` (`DISCORD_OFFICE_WEBHOOK`) |
| Any day | An **alert** when the checkout button is being clicked but nobody has paid for 7 days, or when refunds are high. The same problem is not repeated for 3 days | private `#founder-ops` |
| Thursdays | One **public Plus tip** from the library (`TIPS`), in turn, never twice in a week | public `#announcements` (`DISCORD_ANNOUNCE_WEBHOOK`) |

Every action is also written to the Office as a finished task on Mango's desk, with a receipt of what was sent, so you can read what it did afterwards.

## What it never does
- It never contacts anyone it does not own the channel for: no DMs, no emails, no comments on other people's streams, no mass messages. Platform rules (TikTok, Twitch, Discord) and anti-spam law forbid it, and it would get the accounts banned.
- It never changes a price, a discount, a page, a setting or a user's account, and it never reads or uses an email address.
- It never writes a public post freely. Public posts come only from `TIPS`, and every one must pass `lintPublicPost`: no hype or pressure words (`supercharge`, `limited time`, `last chance`, …), never "Pro", the exact price and refund line (`$5.99/mo with a 14-day full refund, and free Frills stays free.`), only numbers that are facts from the Frills Plus page, only links to this site, no `@` mentions. A post that fails is not sent, and you are told in `#founder-ops`.
- It never invents a number, a testimonial or a deadline. The founder offer is not in the library on purpose: Mango cannot see how many of the 20 spots are left, and a public post must be true.
- Posts can never ping anyone (`allowed_mentions` is empty).

## Switches
- **Everything off:** `npx wrangler secret put PLUS_AGENT` and enter `off`. Nothing runs, nothing is written.
- **Public posts off, private on:** set `PLUS_AGENT_PUBLIC` to `off`.
- **Back on:** `npx wrangler secret delete PLUS_AGENT` (or put anything but `off`).
- With no Discord secrets set, Mango still runs and writes to the Office; it just has nowhere to send. Public posts only start once `DISCORD_ANNOUNCE_WEBHOOK` is set.

## Changing what it says
Edit `TIPS` in `worker/plus-agent.mjs` (and nothing else), run the tests (they lint every post), commit, push, deploy. You approve the library once, in the commit, instead of every post. To have Claude write new tips, use **+ Write New Tips** on Mango's desk.

## What it reads
- The Frills stats (Cloudflare Analytics Engine) through the same report the stats page uses, including the `plus_prompt` counters.
- Counts from the `plus` and `accounts` tables. Complimentary Plus rows (no payment provider) are not counted as customers.
- Aggregates only. It never looks at an individual visitor.

## Honest limit
Mango cannot create traffic. Visitors are the biggest lever on Plus sales; the prompt counters only began on 2026-11-24, so the first weeks of briefs say little. What Mango does well from day one is notice when the money path breaks.
