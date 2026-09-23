/**
 * Discord slash commands for the Tiao bot.
 *
 * Pure module: command definitions (what gets registered with Discord) and
 * the handlers that turn an interaction into a reply. All data access goes
 * through the injected `DiscordDataSource`, so this file has no Mongo
 * dependency and the handlers are unit-testable with plain fakes.
 *
 * Discord API constants are inlined rather than pulled from discord.js —
 * the server only needs the handful of numbers below.
 */

// Discord: ApplicationCommandType.ChatInput
const COMMAND_TYPE_CHAT_INPUT = 1;
// Discord: ApplicationCommandOptionType.String
const OPTION_TYPE_STRING = 3;

export const InteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
} as const;

export const InteractionResponseType = {
  Pong: 1,
  ChannelMessageWithSource: 4,
} as const;

/** Discord: MessageFlags.Ephemeral — only the invoking user sees the reply. */
const MESSAGE_FLAG_EPHEMERAL = 64;

// ---------------------------------------------------------------------------
// Data source contract
// ---------------------------------------------------------------------------

export interface LeaderboardEntry {
  displayName: string;
  elo: number;
  gamesPlayed: number;
}

export interface PlayerStats {
  displayName: string;
  elo: number;
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
}

export type PuzzleSide = "white" | "black";

export interface PuzzleOfTheWeek {
  /** Human-readable position description or notation. */
  position: string;
  sideToMove: PuzzleSide;
  difficulty: string;
  /** Publicly reachable board image, shown as the embed image. */
  imageUrl: string;
  /** Optional heading, e.g. "Puzzle #12". */
  title?: string;
  /** Optional ISO date (YYYY-MM-DD) the puzzle was published. */
  weekOf?: string;
}

export interface DiscordDataSource {
  topPlayers(limit: number): Promise<LeaderboardEntry[]>;
  findPlayerStats(username: string): Promise<PlayerStats | null>;
  currentPuzzle(): Promise<PuzzleOfTheWeek | null>;
}

// ---------------------------------------------------------------------------
// Wire types (subset of Discord's interaction payloads)
// ---------------------------------------------------------------------------

export interface DiscordCommandOption {
  name: string;
  type: number;
  value?: string | number | boolean;
}

export interface DiscordInteraction {
  type: number;
  data?: {
    name?: string;
    options?: DiscordCommandOption[];
  };
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  image?: { url: string };
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
}

export interface DiscordMessage {
  content?: string;
  embeds?: DiscordEmbed[];
  flags?: number;
}

export interface DiscordInteractionResponse {
  type: number;
  data?: DiscordMessage;
}

export interface DiscordCommandDefinition {
  name: string;
  description: string;
  type: number;
  options?: Array<{
    name: string;
    description: string;
    type: number;
    required: boolean;
    max_length?: number;
  }>;
}

// ---------------------------------------------------------------------------
// Command definitions — this is exactly what gets PUT to Discord's API
// ---------------------------------------------------------------------------

export const LEADERBOARD_SIZE = 10;
export const USERNAME_OPTION = "username";

export const COMMAND_DEFINITIONS: DiscordCommandDefinition[] = [
  {
    name: "leaderboard",
    description: `Top ${LEADERBOARD_SIZE} Tiao players by ELO`,
    type: COMMAND_TYPE_CHAT_INPUT,
  },
  {
    name: "stats",
    description: "ELO, games played and win rate for a Tiao player",
    type: COMMAND_TYPE_CHAT_INPUT,
    options: [
      {
        name: USERNAME_OPTION,
        description: "The player's Tiao username",
        type: OPTION_TYPE_STRING,
        required: true,
        max_length: 64,
      },
    ],
  },
  {
    name: "puzzle",
    description: "This week's Tiao puzzle",
    type: COMMAND_TYPE_CHAT_INPUT,
  },
];

// ---------------------------------------------------------------------------
// Reply helpers
// ---------------------------------------------------------------------------

const EMBED_COLOR = 0xd97706;

function reply(data: DiscordMessage): DiscordInteractionResponse {
  return { type: InteractionResponseType.ChannelMessageWithSource, data };
}

function ephemeral(content: string): DiscordInteractionResponse {
  return reply({ content, flags: MESSAGE_FLAG_EPHEMERAL });
}

/** Neutralise Discord markdown in user-controlled strings. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_~`|>])/g, "\\$1");
}

export function formatWinRate(gamesWon: number, gamesLost: number): string {
  const decided = gamesWon + gamesLost;
  if (decided === 0) return "n/a";
  return `${Math.round((gamesWon / decided) * 100)}%`;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleLeaderboard(
  source: DiscordDataSource,
): Promise<DiscordInteractionResponse> {
  const players = await source.topPlayers(LEADERBOARD_SIZE);
  if (players.length === 0) {
    return reply({ content: "No rated games have been played yet. Be the first!" });
  }

  const medals = ["🥇", "🥈", "🥉"];
  const lines = players.map((player, index) => {
    const rank = medals[index] ?? `**${index + 1}.**`;
    const games = player.gamesPlayed === 1 ? "1 game" : `${player.gamesPlayed} games`;
    return `${rank} ${escapeMarkdown(player.displayName)} — **${player.elo}** (${games})`;
  });

  return reply({
    embeds: [
      {
        title: `Tiao leaderboard — top ${players.length}`,
        description: lines.join("\n"),
        color: EMBED_COLOR,
      },
    ],
  });
}

export async function handleStats(
  source: DiscordDataSource,
  username: string | undefined,
): Promise<DiscordInteractionResponse> {
  const trimmed = username?.trim() ?? "";
  if (!trimmed) {
    return ephemeral("Please provide a username, e.g. `/stats username:Alice`.");
  }

  const stats = await source.findPlayerStats(trimmed);
  if (!stats) {
    return ephemeral(
      `No Tiao player named **${escapeMarkdown(trimmed)}** was found. Usernames are matched case-insensitively — check the spelling.`,
    );
  }

  return reply({
    embeds: [
      {
        title: escapeMarkdown(stats.displayName),
        color: EMBED_COLOR,
        fields: [
          { name: "ELO", value: String(stats.elo), inline: true },
          { name: "Games played", value: String(stats.gamesPlayed), inline: true },
          { name: "Win rate", value: formatWinRate(stats.gamesWon, stats.gamesLost), inline: true },
        ],
        footer: { text: `${stats.gamesWon} won · ${stats.gamesLost} lost` },
      },
    ],
  });
}

export async function handlePuzzle(source: DiscordDataSource): Promise<DiscordInteractionResponse> {
  const puzzle = await source.currentPuzzle();
  if (!puzzle) {
    return reply({ content: "There is no Puzzle of the Week right now. Check back soon!" });
  }

  const side = puzzle.sideToMove === "white" ? "White" : "Black";
  const title = puzzle.title ?? "Puzzle of the Week";
  const fields = [
    { name: "Side to move", value: side, inline: true },
    { name: "Difficulty", value: puzzle.difficulty, inline: true },
  ];

  return reply({
    embeds: [
      {
        title: puzzle.weekOf ? `${title} · ${puzzle.weekOf}` : title,
        description: puzzle.position,
        color: EMBED_COLOR,
        fields,
        image: { url: puzzle.imageUrl },
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function stringOption(interaction: DiscordInteraction, name: string): string | undefined {
  const option = interaction.data?.options?.find((entry) => entry.name === name);
  return typeof option?.value === "string" ? option.value : undefined;
}

/**
 * Route a verified interaction to its handler. Pings are answered with a
 * pong (Discord sends one when you save the endpoint URL); unknown commands
 * get an ephemeral error rather than a 4xx so Discord doesn't show the
 * generic "application did not respond" banner.
 */
export async function dispatchInteraction(
  interaction: DiscordInteraction,
  source: DiscordDataSource,
): Promise<DiscordInteractionResponse> {
  if (interaction.type === InteractionType.Ping) {
    return { type: InteractionResponseType.Pong };
  }

  if (interaction.type !== InteractionType.ApplicationCommand) {
    return ephemeral("Unsupported interaction.");
  }

  switch (interaction.data?.name) {
    case "leaderboard":
      return handleLeaderboard(source);
    case "stats":
      return handleStats(source, stringOption(interaction, USERNAME_OPTION));
    case "puzzle":
      return handlePuzzle(source);
    default:
      return ephemeral("Unknown command.");
  }
}
