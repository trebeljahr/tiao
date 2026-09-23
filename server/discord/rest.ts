/**
 * Minimal Discord REST client for bot-token calls.
 *
 * Deliberately tiny: no discord.js, no gateway, just the three message
 * endpoints the leaderboard job needs plus the slash-command registration
 * call used by scripts/discord-register-commands.ts. `fetchImpl` is
 * injectable so unit tests can assert on the exact requests without
 * touching the network.
 */

const DISCORD_API_BASE = "https://discord.com/api/v10";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface DiscordMessage {
  id: string;
  channel_id: string;
  content: string;
  pinned?: boolean;
}

export class DiscordRestError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: string,
  ) {
    super(`Discord ${method} ${path} failed with ${status}: ${body}`);
    this.name = "DiscordRestError";
  }
}

export interface RegisteredCommand {
  id: string;
  name: string;
}

export interface DiscordRest {
  createMessage(channelId: string, content: string): Promise<DiscordMessage>;
  editMessage(channelId: string, messageId: string, content: string): Promise<DiscordMessage>;
  pinMessage(channelId: string, messageId: string): Promise<void>;
  /**
   * Replace the application's slash commands wholesale (PUT). With a
   * `guildId` the commands are scoped to that guild and go live at once;
   * without one they are global and may take up to an hour to propagate.
   */
  bulkOverwriteCommands(
    applicationId: string,
    commands: unknown[],
    guildId?: string,
  ): Promise<RegisteredCommand[]>;
}

export interface DiscordRestOptions {
  botToken: string;
  fetchImpl?: FetchLike;
  apiBase?: string;
}

export function createDiscordRest(options: DiscordRestOptions): DiscordRest {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const apiBase = options.apiBase ?? DISCORD_API_BASE;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bot ${options.botToken}`,
      "User-Agent": "TiaoBot (https://playtiao.com, 1.0)",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const response = await fetchImpl(`${apiBase}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new DiscordRestError(response.status, method, path, text);
    }

    // 204 No Content (e.g. pin) has no body.
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    createMessage(channelId, content) {
      return request<DiscordMessage>("POST", `/channels/${channelId}/messages`, { content });
    },
    editMessage(channelId, messageId, content) {
      return request<DiscordMessage>("PATCH", `/channels/${channelId}/messages/${messageId}`, {
        content,
      });
    },
    async pinMessage(channelId, messageId) {
      await request<void>("PUT", `/channels/${channelId}/pins/${messageId}`);
    },
    bulkOverwriteCommands(applicationId, commands, guildId) {
      const path = guildId
        ? `/applications/${applicationId}/guilds/${guildId}/commands`
        : `/applications/${applicationId}/commands`;
      return request<RegisteredCommand[]>("PUT", path, commands);
    },
  };
}
