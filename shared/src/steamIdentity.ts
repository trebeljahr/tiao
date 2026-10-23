export type SteamProfileDefaults = {
  displayName: string;
  suggestedUsername: string;
  avatarUrl?: string;
};

/** Steam labels are editable suggestions; internal player IDs never derive from them. */
export function steamUsernameSuggestion(name: string): string {
  const value = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z0-9]+|[-_]+$/g, "")
    .slice(0, 32);
  return value.length > 0 && value.length < 3 ? `${value}-player` : value;
}
