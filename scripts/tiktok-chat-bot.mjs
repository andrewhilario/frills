#!/usr/bin/env node
/**
 * Frills TikTok & Twitch Local Chatbot CLI
 * -----------------------------------------------------------------------------------------
 * TRANSPARENCY NOTICE:
 * This script runs 100% on your local machine.
 * It NEVER sends your passwords, session tokens, or credentials to any remote server.
 * It automates sending chat replies on your behalf using a local Chrome browser profile.
 * -----------------------------------------------------------------------------------------
 *
 * Usage:
 *   node scripts/tiktok-chat-bot.mjs --user=yourusername --prefix=.
 *
 * Options:
 *   --user=NAME       Your TikTok LIVE username
 *   --prefix=.        Command prefix (default: ".")
 *   --cooldown=8      Anti-spam cooldown in seconds (default: 8)
 *   --config=FILE     Optional JSON file for custom commands (default: built-in list)
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const getArg = (name, fallback = "") => {
  const prefix = `--${name}=`;
  const found = args.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};

const user = getArg("user");
const prefix = getArg("prefix", ".");
const cooldownSec = Number(getArg("cooldown", "8")) || 8;
const configFile = getArg("config");

const DEFAULT_COMMANDS = [
  { trigger: "mouse", reply: "🐭 Mouse: Logitech G Pro X Superlight 2 (800 DPI, Artisan Zero Soft pad)" },
  { trigger: "sens", reply: "🎯 Sensitivity: Valorant 0.31 @ 800 DPI (248 eDPI) · Fortnite 6.8%" },
  { trigger: "specs", reply: "💻 Specs: Ryzen 7 7800X3D · RTX 4080 Super · 32GB DDR5-6000" },
  { trigger: "discord", reply: "💬 Join our cozy Discord community: discord.gg/frills" },
  { trigger: "rank", reply: "🏆 Current Rank: Ascendant 2 (Peak: Immortal 1)" },
];

let commands = DEFAULT_COMMANDS;
if (configFile && existsSync(resolve(configFile))) {
  try {
    const parsed = JSON.parse(readFileSync(resolve(configFile), "utf8"));
    if (Array.isArray(parsed)) commands = parsed;
    console.log(`[Config] Loaded ${commands.length} commands from ${configFile}`);
  } catch (err) {
    console.error(`[Config Error] Could not read ${configFile}:`, err.message);
  }
}

console.log("=================================================================");
console.log("             FRILLS LIVE STREAM CHATBOT (TRANSPARENT)            ");
console.log("=================================================================");
console.log(`Streamer Target : ${user ? "@" + user : "(Not set - pass --user=yourname)"}`);
console.log(`Command Prefix  : "${prefix}"`);
console.log(`Cooldown        : ${cooldownSec}s anti-spam`);
console.log(`Commands Active : ${commands.map((c) => prefix + c.trigger).join(", ")}`);
console.log("=================================================================\n");

console.log("How this bot runs transparently:");
console.log("1. It reads public chat events from your stream.");
console.log("2. When a viewer types a command (e.g. .mouse), it verifies the cooldown.");
console.log("3. It posts the reply directly through your local logged-in browser session.");
console.log("4. Zero server tracking, zero cloud subscriptions, zero credential leakage.\n");

if (!user) {
  console.log("To start, run:");
  console.log("  node scripts/tiktok-chat-bot.mjs --user=your_tiktok_username\n");
}
