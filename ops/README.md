# Frills Virtual Office (Operator Playbooks)

This directory holds the standing operating procedures (SOPs) for the five specialist desks shown in the private Virtual Office dashboard (`/admin/office/`).

## The 5 Desks

| Desk | Name | Mascot | Playbook | Focus |
|---|---|---|---|---|
| `ops` | **Mochi** | Frog | [mochi-ops.md](agents/mochi-ops.md) | Relay fleet health, Frills Plus accounts, storage & incident alerts |
| `growth` | **Yuzu** | Neko | [yuzu-growth.md](agents/yuzu-growth.md) | TikTok/Shorts demo scripts, X posts, VTuber outreach & changelogs |
| `community` | **Boba** | Bunny | [boba-community.md](agents/boba-community.md) | `/feedback/` triage, Discord FAQ macros, OBS/VTS troubleshooting & feature votes |
| `qa` | **Kero** | Hamster | [kero-qa.md](agents/kero-qa.md) | Automated regression tests, `/overlay/` 22.5 KB gzip gate, CSP & SEO audits |
| `sales` | **Mango** | Duck | [mango-plus-sales.md](agents/mango-plus-sales.md) | Frills Plus funnel brief, broken-checkout and refund alerts, one vetted public Plus tip a week. **Runs by itself, no approval.** |

> **Mango runs on its own.** The other four desks wait for you; Mango works inside the Cloudflare Worker (daily at 15:17 UTC) and its rules, its limits and its off switch (`PLUS_AGENT=off`) are in [mango-plus-sales.md](agents/mango-plus-sales.md).

## How to Run a Bot

1. **Live in the browser:** Open `https://frills.valwidgets.live/admin/office/`, unlock with `ADMIN_KEY`, click any 3D desk, and press **Run Live Scan**, **Approve**, or **Copy `<Bot>` Prompt**.
2. **Real Execution on Approve:**
   - **Auto-resolve `/feedback/`:** Approving or finishing any Boba task queued from unread feedback automatically marks that feedback message as **Done** in `/admin/`.
   - **Discord Webhooks:** Set `DISCORD_OFFICE_WEBHOOK` (private `#founder-ops`) and/or `DISCORD_ANNOUNCE_WEBHOOK` (public `#announcements`) as Cloudflare Worker secrets. Approving a card publishes an embedded message straight to Discord; Mochi’s Live Ops Scan also pings `#founder-ops` automatically on relay outages.
3. **Autonomous T3 Agent Sync CLI (`scripts/office-sync.mjs`):**
   Set `FRILLS_ADMIN_KEY` in your shell or scheduled run, then:
   - `node scripts/office-sync.mjs pull --status queued` — read queued assignments from live D1
   - `node scripts/office-sync.mjs checkin growth working "Drafting weekly TikTok script"` — animate Yuzu typing live at her 3D desk
   - `node scripts/office-sync.mjs deliver <id> --status needs_review --file draft.txt` — drop finished work into your Approval Queue
   - `node scripts/office-sync.mjs scan` — run Mochi’s live relay & feedback check on a schedule (via `/schedule`)
