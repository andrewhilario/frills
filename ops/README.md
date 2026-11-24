# Frills Virtual Office (Operator Playbooks)

This directory holds the standing operating procedures (SOPs) for the four specialist desks shown in the private Virtual Office dashboard (`/admin/office/`).

## The 4 Desks

| Desk | Name | Mascot | Playbook | Focus |
|---|---|---|---|---|
| `ops` | **Mochi** | Frog | [mochi-ops.md](agents/mochi-ops.md) | Relay fleet health, Frills Plus accounts, storage & incident alerts |
| `growth` | **Yuzu** | Neko | [yuzu-growth.md](agents/yuzu-growth.md) | TikTok/Shorts demo scripts, X posts, VTuber outreach & changelogs |
| `community` | **Boba** | Bunny | [boba-community.md](agents/boba-community.md) | `/feedback/` triage, Discord FAQ macros, OBS/VTS troubleshooting & feature votes |
| `qa` | **Kero** | Hamster | [kero-qa.md](agents/kero-qa.md) | Automated regression tests, `/overlay/` 22.5 KB gzip gate, CSP & SEO audits |

## How to Run a Bot

1. **Live in the browser:** Open `https://frills.valwidgets.live/admin/office/`, unlock with `ADMIN_KEY`, click any desk, and press **Run Live Scan** or **Copy Agent Prompt**.
2. **In T3 Code / Antigravity:** Paste a desk's prompt (or ask *"Run Yuzu to draft this week's TikTok script"* / *"Run Kero to check tests & overlay size"*). The agent reads its playbook file in `ops/agents/` and produces ready-to-approve outputs.
3. **On a schedule:** Use `/schedule` in T3 Code to run Mochi (daily ops check) or Yuzu (weekly growth pack) automatically.
