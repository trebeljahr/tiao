import { ObjectId } from "mongodb";
import mongoose from "mongoose";

/**
 * For a list of player IDs, look up SSO profile pictures from
 * better-auth's `user` collection for any that are missing one.
 * Returns a map from player ID → SSO image URL.
 */
export async function fetchSsoProfilePictures(playerIds: string[]): Promise<Map<string, string>> {
  if (playerIds.length === 0) return new Map();

  try {
    const db = mongoose.connection.getClient().db();
    const baUsers = await db
      .collection("user")
      .find({
        _id: { $in: playerIds.flatMap((id) => [id, new ObjectId(id)]) } as any,
        image: { $ne: null },
      })
      .project({ _id: 1, image: 1 })
      .toArray();
    return new Map(baUsers.filter((u) => u.image).map((u) => [String(u._id), u.image as string]));
  } catch {
    return new Map();
  }
}

/**
 * Patch missing profile pictures in a MultiplayerGameSummary-like object
 * by fetching SSO images for players that don't have one.
 */
export async function applySsoProfilePicturesToSummaries<
  T extends {
    players: Array<{ player: { playerId: string; profilePicture?: string } }>;
    seats: Record<string, { player: { playerId: string; profilePicture?: string } } | null>;
  },
>(summaries: T[]): Promise<T[]> {
  // Collect all player IDs with missing profile pictures
  const missingIds = new Set<string>();
  for (const s of summaries) {
    for (const p of s.players) {
      if (!p.player.profilePicture) missingIds.add(p.player.playerId);
    }
    for (const seat of Object.values(s.seats)) {
      if (seat && !seat.player.profilePicture) missingIds.add(seat.player.playerId);
    }
  }

  if (missingIds.size === 0) return summaries;

  const ssoMap = await fetchSsoProfilePictures(Array.from(missingIds));
  if (ssoMap.size === 0) return summaries;

  // Apply SSO pictures
  for (const s of summaries) {
    for (const p of s.players) {
      if (!p.player.profilePicture) {
        const ssoPic = ssoMap.get(p.player.playerId);
        if (ssoPic) p.player.profilePicture = ssoPic;
      }
    }
    for (const seat of Object.values(s.seats)) {
      if (seat && !seat.player.profilePicture) {
        const ssoPic = ssoMap.get(seat.player.playerId);
        if (ssoPic) seat.player.profilePicture = ssoPic;
      }
    }
  }

  return summaries;
}
