import { type SteamProfileDefaults, steamUsernameSuggestion } from "../../shared/src/steamIdentity";

export { steamUsernameSuggestion } from "../../shared/src/steamIdentity";
export type SteamProfile = SteamProfileDefaults;

export function steamAvatarUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return undefined;
    if (
      ![
        "avatars.steamstatic.com",
        "avatars.akamai.steamstatic.com",
        "steamcdn-a.akamaihd.net",
      ].includes(url.hostname)
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

/** Profile lookup is optional: unavailable/private metadata must not prevent login. */
export async function fetchSteamProfile(steamId: string): Promise<SteamProfile> {
  const fallback = { displayName: "", suggestedUsername: `player-${steamId.slice(-6)}` };
  const key = process.env.STEAM_WEB_API_KEY || process.env.STEAM_PUBLISHER_WEB_API_KEY;
  if (!key || !/^\d{17}$/.test(steamId)) return fallback;
  try {
    const url = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/");
    url.search = new URLSearchParams({ key, steamids: steamId }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "error" });
    if (!response.ok) return fallback;
    const body = (await response.json()) as {
      response?: {
        players?: Array<{ steamid?: string; personaname?: string; avatarfull?: string }>;
      };
    };
    const player = body.response?.players?.find((player) => player.steamid === steamId);
    const displayName =
      typeof player?.personaname === "string" ? player.personaname.slice(0, 128) : "";
    return {
      displayName,
      suggestedUsername: steamUsernameSuggestion(displayName) || fallback.suggestedUsername,
      avatarUrl: steamAvatarUrl(player?.avatarfull),
    };
  } catch {
    return fallback;
  }
}
