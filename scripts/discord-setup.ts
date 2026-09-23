#!/usr/bin/env tsx
/*
 * discord-setup — bootstrap the Tiao community Discord server.
 *
 * Creates the category / channel layout and the role list that the launch
 * checklist describes, plus the webhook the backend posts game results to.
 * Idempotent: anything that already exists by name is left alone, so the
 * script can be re-run after adding a channel or role to the plan below.
 *
 * Usage:
 *   pnpm setup:discord              # apply the plan to the guild
 *   pnpm setup:discord --dry-run    # print the plan, never talk to Discord
 *   pnpm setup:discord --help
 *
 * Environment (from the process, a root `.env`, or `server/.env`):
 *   DISCORD_BOT_TOKEN   bot token from https://discord.com/developers/applications
 *   DISCORD_GUILD_ID    the server (guild) to set up — enable Developer Mode in
 *                       Discord, right-click the server icon, "Copy Server ID"
 *
 * The bot must already be a member of the guild with Manage Roles, Manage
 * Channels and Manage Webhooks. The script prints the OAuth invite URL with
 * the right permission set once it has logged in (and a template of it in
 * dry-run mode).
 *
 * Pinned welcome / FAQ messages are posted by hand afterwards — see the
 * "Discord — scaffold" section of the launch checklist.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type CategoryChannel,
  ChannelType,
  Client,
  GatewayIntentBits,
  type Guild,
  type OverwriteResolvable,
  PermissionFlagsBits,
  PermissionsBitField,
  type TextChannel,
} from "discord.js";

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

interface ChannelPlan {
  name: string;
  topic: string;
  /** @everyone can read but not post. Announcement-style channels. */
  readOnly?: boolean;
  /** @everyone cannot see the channel until a moderator unlocks it. */
  locked?: boolean;
}

interface CategoryPlan {
  name: string;
  channels: ChannelPlan[];
}

interface RolePlan {
  name: string;
  color: number;
  /** Members can @-mention the role. Used for opt-in ping roles. */
  mentionable?: boolean;
}

const CATEGORIES: CategoryPlan[] = [
  {
    name: "📌 INFO",
    channels: [
      { name: "welcome", topic: "Welcome to Tiao. Start here.", readOnly: true },
      { name: "announcements", topic: "Official updates, patches, events.", readOnly: true },
      { name: "faq", topic: "Common questions answered.", readOnly: true },
    ],
  },
  {
    name: "🎮 PLAY",
    channels: [
      { name: "find-a-game", topic: "Ping @Looking to Play to find an opponent." },
      { name: "tournament-chat", topic: "Live discussion during tournaments.", locked: true },
      { name: "game-results", topic: "Auto-posted game results + share your wins." },
    ],
  },
  {
    name: "🧠 STRATEGY",
    channels: [
      { name: "strategy-discussion", topic: "Openings, tactics, endgame theory." },
      { name: "puzzle-of-the-week", topic: "Weekly puzzle challenge. Use spoiler tags." },
      { name: "game-analysis", topic: "Post a game, get feedback." },
    ],
  },
  {
    name: "💬 COMMUNITY",
    channels: [
      { name: "general", topic: "Off-topic, hanging out." },
      { name: "introductions", topic: "New here? Say hi." },
      { name: "feedback-and-bugs", topic: "Bug reports, feature requests, UX suggestions." },
      { name: "memes-and-clips", topic: "Funny moments, beautiful trap chains." },
    ],
  },
  {
    name: "🔧 DEVELOPMENT",
    channels: [
      { name: "devlog", topic: "Build updates from Rico." },
      { name: "contributors", topic: "Open-source contribution discussion." },
    ],
  },
];

const ROLES: RolePlan[] = [
  { name: "Developer", color: 0x3498db },
  { name: "Game Designer", color: 0xf1c40f },
  { name: "Supporter", color: 0x2ecc71 },
  { name: "Tournament Winner", color: 0x9b59b6 },
  { name: "Puzzle Master", color: 0xe67e22 },
  { name: "Contributor", color: 0x1abc9c },
  { name: "Beta Tester", color: 0x95a5a6 },
  { name: "Looking to Play", color: 0x57f287, mentionable: true },
  { name: "Tournament Notifications", color: 0x5865f2, mentionable: true },
  { name: "Devlog Updates", color: 0x5865f2, mentionable: true },
];

/** Channel the backend posts finished games into, and the webhook name it uses. */
const GAME_RESULTS_CHANNEL = "game-results";
const GAME_RESULTS_WEBHOOK = "Tiao Game Results";

/** Permissions the OAuth invite URL asks for. Mirrors the launch checklist. */
const BOT_PERMISSIONS = new PermissionsBitField([
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.UseApplicationCommands,
]);

// ---------------------------------------------------------------------------
// CLI + environment
// ---------------------------------------------------------------------------

const USAGE = `Usage: pnpm setup:discord [--dry-run] [--help]

  --dry-run   Print the channel/role plan and exit without contacting Discord.
  --help      Show this message.

Environment: DISCORD_BOT_TOKEN, DISCORD_GUILD_ID (see .env.example).`;

function parseArgs(argv: string[]): { dryRun: boolean } {
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}\n\n${USAGE}`);
      process.exit(2);
    }
  }
  return { dryRun };
}

/**
 * Load `.env` files if present: the root one first, then `server/.env`, which
 * already documents the same DISCORD_* keys for the backend. The process
 * environment always wins. `pnpm setup:discord` runs with the repo root as cwd.
 */
function loadDotEnv(): void {
  const before = { ...process.env };
  for (const file of [".env", "server/.env"]) {
    const envPath = join(process.cwd(), file);
    if (!existsSync(envPath)) continue;
    process.loadEnvFile(envPath);
  }
  for (const [key, value] of Object.entries(before)) {
    if (value !== undefined) process.env[key] = value;
  }
}

const REQUIRED_ENV = ["DISCORD_BOT_TOKEN", "DISCORD_GUILD_ID"] as const;

function requireEnv(): { token: string; guildId: string } {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    console.error(
      [
        `Missing required environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
        "",
        "Set them in your shell or in a root .env file (copy .env.example to get started):",
        ...missing.map((key) => `  ${key}=...`),
        "",
        "Run with --dry-run to see the plan without a bot.",
      ].join("\n"),
    );
    process.exit(1);
  }
  return {
    token: process.env.DISCORD_BOT_TOKEN as string,
    guildId: process.env.DISCORD_GUILD_ID as string,
  };
}

function inviteUrl(applicationId: string): string {
  return `https://discord.com/oauth2/authorize?client_id=${applicationId}&scope=bot%20applications.commands&permissions=${BOT_PERMISSIONS.bitfield}`;
}

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

function channelFlags(ch: ChannelPlan): string {
  const flags: string[] = [];
  if (ch.readOnly) flags.push("read-only");
  if (ch.locked) flags.push("locked");
  return flags.length > 0 ? ` [${flags.join(", ")}]` : "";
}

function printPlan(): void {
  console.log("Roles:");
  for (const role of ROLES) {
    const hex = `#${role.color.toString(16).padStart(6, "0")}`;
    console.log(`  ${role.name}  ${hex}${role.mentionable ? "  (mentionable)" : ""}`);
  }
  console.log("\nCategories and channels:");
  for (const category of CATEGORIES) {
    console.log(`  ${category.name}`);
    for (const ch of category.channels) {
      console.log(`    #${ch.name}${channelFlags(ch)} — ${ch.topic}`);
    }
  }
  console.log(`\nWebhook: "${GAME_RESULTS_WEBHOOK}" in #${GAME_RESULTS_CHANNEL}`);
  console.log(`Invite URL template: ${inviteUrl("<APPLICATION_ID>")}`);
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

async function ensureRoles(guild: Guild): Promise<void> {
  const existing = await guild.roles.fetch();
  for (const role of ROLES) {
    if (existing.some((r) => r.name === role.name)) {
      console.log(`Role exists:    ${role.name}`);
      continue;
    }
    await guild.roles.create({
      name: role.name,
      color: role.color,
      mentionable: role.mentionable ?? false,
      reason: "Tiao discord-setup",
    });
    console.log(`Created role:   ${role.name}`);
  }
}

function overwritesFor(guild: Guild, ch: ChannelPlan): OverwriteResolvable[] {
  const deny: bigint[] = [];
  if (ch.readOnly) deny.push(PermissionFlagsBits.SendMessages);
  if (ch.locked) deny.push(PermissionFlagsBits.ViewChannel);
  return deny.length > 0 ? [{ id: guild.roles.everyone.id, deny }] : [];
}

async function ensureChannels(guild: Guild): Promise<void> {
  const existing = await guild.channels.fetch();
  const categories = existing.filter(
    (c): c is CategoryChannel => c !== null && c.type === ChannelType.GuildCategory,
  );

  for (const category of CATEGORIES) {
    let cat = categories.find((c) => c.name === category.name);
    if (cat) {
      console.log(`Category exists: ${category.name}`);
    } else {
      cat = await guild.channels.create({
        name: category.name,
        type: ChannelType.GuildCategory,
        reason: "Tiao discord-setup",
      });
      console.log(`Created category: ${category.name}`);
    }
    const parentId = cat.id;

    for (const ch of category.channels) {
      if (existing.some((c) => c !== null && c.name === ch.name && c.parentId === parentId)) {
        console.log(`  Channel exists:  #${ch.name}`);
        continue;
      }
      await guild.channels.create({
        name: ch.name,
        type: ChannelType.GuildText,
        parent: parentId,
        topic: ch.topic,
        permissionOverwrites: overwritesFor(guild, ch),
        reason: "Tiao discord-setup",
      });
      console.log(`  Created channel: #${ch.name}${channelFlags(ch)}`);
    }
  }
}

async function ensureGameResultsWebhook(guild: Guild): Promise<void> {
  const channels = await guild.channels.fetch();
  const channel = channels.find(
    (c): c is TextChannel =>
      c !== null && c.type === ChannelType.GuildText && c.name === GAME_RESULTS_CHANNEL,
  );
  if (!channel) {
    console.warn(`No #${GAME_RESULTS_CHANNEL} text channel found; skipping webhook.`);
    return;
  }
  const hooks = await channel.fetchWebhooks();
  let hook = hooks.find((h) => h.name === GAME_RESULTS_WEBHOOK);
  if (hook) {
    console.log(`Webhook exists: "${GAME_RESULTS_WEBHOOK}"`);
  } else {
    hook = await channel.createWebhook({
      name: GAME_RESULTS_WEBHOOK,
      reason: "Auto-post game completions",
    });
    console.log(`Created webhook: "${GAME_RESULTS_WEBHOOK}"`);
  }
  if (hook.url) {
    console.log(`  DISCORD_WEBHOOK_GAME_RESULTS=${hook.url}`);
  } else {
    console.log("  (webhook token not visible to this bot; copy the URL from Server Settings)");
  }
  console.log(`  DISCORD_CHANNEL_GAME_RESULTS=${channel.id}`);
}

async function apply(token: string, guildId: string): Promise<void> {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  try {
    await client.login(token);
    const guild = await client.guilds.fetch(guildId);
    console.log(`Setting up "${guild.name}" (${guild.id})\n`);

    await ensureRoles(guild);
    console.log("");
    await ensureChannels(guild);
    console.log("");
    await ensureGameResultsWebhook(guild);

    const applicationId = client.application?.id ?? client.user?.id;
    if (applicationId) {
      console.log(`\nBot invite URL: ${inviteUrl(applicationId)}`);
    }
    console.log("\nServer setup complete.");
  } finally {
    await client.destroy();
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { dryRun } = parseArgs(process.argv.slice(2));
  loadDotEnv();

  if (dryRun) {
    console.log("Dry run — nothing will be sent to Discord.\n");
    printPlan();
    const missing = REQUIRED_ENV.filter((key) => !process.env[key]?.trim());
    if (missing.length > 0) {
      console.log(`\nNote: ${missing.join(", ")} not set; a real run will need them.`);
    }
    return;
  }

  const { token, guildId } = requireEnv();
  await apply(token, guildId);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
