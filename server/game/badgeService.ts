import GameAccount from "../models/GameAccount";

class BadgeServiceError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function getAccountOrThrow(playerId: string) {
  const account = await GameAccount.findById(playerId);
  if (!account) {
    throw new BadgeServiceError(404, "ACCOUNT_NOT_FOUND", "Player not found.");
  }
  return account;
}

export async function grantBadge(playerId: string, badgeId: string) {
  const account = await getAccountOrThrow(playerId);
  if (!account.badges.includes(badgeId)) {
    account.badges.push(badgeId);
    await account.save();
  }
  return { badges: account.badges, activeBadges: account.activeBadges };
}

export async function revokeBadge(playerId: string, badgeId: string) {
  const account = await getAccountOrThrow(playerId);
  account.badges = account.badges.filter((id: string) => id !== badgeId);
  account.activeBadges = account.activeBadges.filter((id: string) => id !== badgeId);
  await account.save();
  return { badges: account.badges, activeBadges: account.activeBadges };
}

export async function grantTheme(playerId: string, themeId: string) {
  const account = await getAccountOrThrow(playerId);
  const themes = new Set(account.unlockedThemes ?? []);
  themes.add(themeId);
  account.unlockedThemes = [...themes];
  await account.save();
  return { unlockedThemes: account.unlockedThemes };
}

export async function revokeTheme(playerId: string, themeId: string) {
  const account = await getAccountOrThrow(playerId);
  account.unlockedThemes = (account.unlockedThemes ?? []).filter((id: string) => id !== themeId);
  await account.save();
  return { unlockedThemes: account.unlockedThemes };
}
