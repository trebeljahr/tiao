/**
 * Register (bulk-overwrite) the Tiao slash commands with Discord.
 *
 * Usage (from the repo root):
 *   pnpm discord:register            # registers commands
 *   pnpm discord:register --dry-run  # prints the payload, sends nothing
 *
 * Env (see server/.env.example):
 *   DISCORD_BOT_TOKEN       required
 *   DISCORD_PUBLIC_KEY      required (gates the whole integration)
 *   DISCORD_APPLICATION_ID  required
 *   DISCORD_GUILD_ID        optional — when set, commands are registered for
 *                           that guild only (instant); otherwise globally
 *                           (Discord may take up to an hour to propagate).
 */

import { COMMAND_DEFINITIONS } from "../server/discord/commands";
import { discordConfigFromEnv } from "../server/discord/config";
import { createDiscordRest, DiscordRestError } from "../server/discord/rest";

// Same files the server reads (see server/config/envVars.ts). Values already
// present in the environment win; missing files are fine.
for (const file of ["server/.env", "server/.env.development"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // no such file — skip
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const config = discordConfigFromEnv();

  if (!config) {
    console.error("DISCORD_BOT_TOKEN and DISCORD_PUBLIC_KEY must both be set.");
    process.exit(1);
  }
  if (!config.applicationId) {
    console.error("DISCORD_APPLICATION_ID must be set to register commands.");
    process.exit(1);
  }

  const target = config.guildId
    ? `guild ${config.guildId} (live immediately)`
    : "all servers (global — up to an hour to propagate)";

  console.log(`${dryRun ? "[dry-run] Would register" : "Registering"} for ${target}:`);
  console.log(JSON.stringify(COMMAND_DEFINITIONS, null, 2));

  if (dryRun) {
    console.log(`[dry-run] ${COMMAND_DEFINITIONS.length} command(s) NOT sent.`);
    return;
  }

  const rest = createDiscordRest({ botToken: config.botToken });
  try {
    const registered = await rest.bulkOverwriteCommands(
      config.applicationId,
      COMMAND_DEFINITIONS,
      config.guildId,
    );
    for (const command of registered) {
      console.log(`registered /${command.name} (id ${command.id})`);
    }
  } catch (error) {
    if (error instanceof DiscordRestError) {
      console.error(`Discord answered ${error.status}: ${error.body}`);
      process.exit(1);
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
