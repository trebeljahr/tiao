export interface DiscordConfig {
  botToken: string;
  publicKey: string;
  applicationId?: string;
  guildId?: string;
  puzzleFile?: string;
}

/**
 * The whole Discord integration is opt-in: without BOTH the bot token and
 * the public key it is treated as absent, and the interactions route
 * answers 404 exactly as if it had never been mounted.
 */
export function discordConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DiscordConfig | null {
  const botToken = env.DISCORD_BOT_TOKEN?.trim();
  const publicKey = env.DISCORD_PUBLIC_KEY?.trim();
  if (!botToken || !publicKey) return null;
  return {
    botToken,
    publicKey,
    applicationId: env.DISCORD_APPLICATION_ID?.trim() || undefined,
    guildId: env.DISCORD_GUILD_ID?.trim() || undefined,
    puzzleFile: env.DISCORD_PUZZLE_FILE?.trim() || undefined,
  };
}
