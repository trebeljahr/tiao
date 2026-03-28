/**
 * Database cleanup script — removes all test data while preserving
 * the two real user accounts and their games/tournaments.
 *
 * Usage:
 *   cd server
 *   MONGODB_URI="mongodb://..." npx ts-node scripts/cleanup-database.ts
 *
 * Or from project root:
 *   MONGODB_URI="mongodb://..." npx ts-node server/scripts/cleanup-database.ts
 *
 * ⚠️  This is DESTRUCTIVE. Run with --dry-run first to see what would be deleted.
 *
 *   MONGODB_URI="mongodb://..." npx ts-node scripts/cleanup-database.ts --dry-run
 */

import mongoose from "mongoose";

// ─── Configuration ──────────────────────────────────────────────────

const KEEP_USERNAMES = ["Andreas Edmeier", "ricotrebeljahr"];

const DRY_RUN = process.argv.includes("--dry-run");

// ─── Models (inline to avoid import path issues) ────────────────────

const GameAccount = mongoose.model(
  "GameAccount",
  new mongoose.Schema({}, { strict: false, collection: "gameaccounts" }),
);
const GameSession = mongoose.model(
  "GameSession",
  new mongoose.Schema({}, { strict: false, collection: "gamesessions" }),
);
const GameRoom = mongoose.model(
  "GameRoom",
  new mongoose.Schema({}, { strict: false, collection: "gamerooms" }),
);
const GameInvitation = mongoose.model(
  "GameInvitation",
  new mongoose.Schema({}, { strict: false, collection: "gameinvitations" }),
);
const Tournament = mongoose.model(
  "Tournament",
  new mongoose.Schema({}, { strict: false, collection: "tournaments" }),
);

// ─── Helpers ────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(`${DRY_RUN ? "[DRY RUN] " : ""}${msg}`);
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("Error: MONGODB_URI environment variable is required.");
    process.exit(1);
  }

  log(`Connecting to ${uri.replace(/\/\/[^@]+@/, "//***@")}...`);
  await mongoose.connect(uri);
  log(`Connected to database: ${mongoose.connection.db?.databaseName}\n`);

  // 1. Find the accounts to keep
  const keepAccounts = await GameAccount.find({
    displayName: { $in: KEEP_USERNAMES },
  }).lean();

  const keepAccountIds = new Set(keepAccounts.map((a: any) => String(a._id)));
  const keepPlayerIds = new Set(keepAccounts.map((a: any) => String(a._id)));

  log(`Accounts to KEEP (${keepAccounts.length}):`);
  for (const a of keepAccounts) {
    log(`  - ${(a as any).displayName} (${(a as any)._id})`);
  }

  if (keepAccounts.length !== KEEP_USERNAMES.length) {
    const found = keepAccounts.map((a: any) => a.displayName);
    const missing = KEEP_USERNAMES.filter((u) => !found.includes(u));
    console.warn(`\n⚠️  Warning: Could not find accounts for: ${missing.join(", ")}`);
    console.warn("   Proceeding will delete everything except what was found.\n");
  }

  // 2. Count what will be deleted
  const totalAccounts = await GameAccount.countDocuments();
  const deleteAccountCount = totalAccounts - keepAccounts.length;

  const totalSessions = await GameSession.countDocuments();
  // Keep sessions for kept accounts
  const keepSessionCount = await GameSession.countDocuments({
    playerId: { $in: [...keepPlayerIds] },
  });

  // 3. Find games between the two kept users (both must be players)
  const allRooms = await GameRoom.find().lean();
  const keepRoomIds: string[] = [];
  const deleteRoomIds: string[] = [];

  for (const room of allRooms) {
    const r = room as any;
    const playerIds = (r.players || []).map((p: any) => String(p.playerId));
    const allPlayersKept =
      playerIds.length > 0 && playerIds.every((id: string) => keepPlayerIds.has(id));
    if (allPlayersKept) {
      keepRoomIds.push(r.roomId);
    } else {
      deleteRoomIds.push(r.roomId);
    }
  }

  // 4. Find tournaments where all participants are kept users
  const allTournaments = await Tournament.find().lean();
  const keepTournamentIds: string[] = [];
  const deleteTournamentIds: string[] = [];

  for (const t of allTournaments) {
    const tournament = t as any;
    const participantIds = (tournament.participants || []).map((p: any) => String(p.playerId));
    const allKept =
      participantIds.length > 0 && participantIds.every((id: string) => keepPlayerIds.has(id));
    if (allKept) {
      keepTournamentIds.push(tournament.tournamentId);
    } else {
      deleteTournamentIds.push(tournament.tournamentId);
    }
  }

  // 5. Invitations — keep only those between kept users
  const totalInvitations = await GameInvitation.countDocuments();
  const keepInvitationCount = await GameInvitation.countDocuments({
    senderId: { $in: [...keepAccountIds].map((id) => new mongoose.Types.ObjectId(id)) },
    recipientId: { $in: [...keepAccountIds].map((id) => new mongoose.Types.ObjectId(id)) },
  });

  // ─── Summary ──────────────────────────────────────────────────────

  console.log("\n════════════════════════════════════════");
  console.log("  CLEANUP SUMMARY");
  console.log("════════════════════════════════════════\n");
  console.log(
    `  Accounts:     ${deleteAccountCount} delete / ${keepAccounts.length} keep (of ${totalAccounts})`,
  );
  console.log(
    `  Sessions:     ${totalSessions - keepSessionCount} delete / ${keepSessionCount} keep (of ${totalSessions})`,
  );
  console.log(
    `  Game Rooms:   ${deleteRoomIds.length} delete / ${keepRoomIds.length} keep (of ${allRooms.length})`,
  );
  console.log(
    `  Tournaments:  ${deleteTournamentIds.length} delete / ${keepTournamentIds.length} keep (of ${allTournaments.length})`,
  );
  console.log(
    `  Invitations:  ${totalInvitations - keepInvitationCount} delete / ${keepInvitationCount} keep (of ${totalInvitations})`,
  );
  console.log();

  if (DRY_RUN) {
    log("Dry run complete. No changes made. Remove --dry-run to execute.\n");
    await mongoose.disconnect();
    return;
  }

  // ─── Execute deletions ────────────────────────────────────────────

  // Delete test accounts
  const accountResult = await GameAccount.deleteMany({
    _id: { $nin: [...keepAccountIds].map((id) => new mongoose.Types.ObjectId(id)) },
  });
  log(`Deleted ${accountResult.deletedCount} accounts.`);

  // Delete sessions for deleted accounts
  const sessionResult = await GameSession.deleteMany({
    playerId: { $nin: [...keepPlayerIds] },
  });
  log(`Deleted ${sessionResult.deletedCount} sessions.`);

  // Delete game rooms not between kept users
  if (deleteRoomIds.length > 0) {
    const roomResult = await GameRoom.deleteMany({
      roomId: { $in: deleteRoomIds },
    });
    log(`Deleted ${roomResult.deletedCount} game rooms.`);
  } else {
    log("No game rooms to delete.");
  }

  // Delete tournaments not between kept users
  if (deleteTournamentIds.length > 0) {
    const tournamentResult = await Tournament.deleteMany({
      tournamentId: { $in: deleteTournamentIds },
    });
    log(`Deleted ${tournamentResult.deletedCount} tournaments.`);
  } else {
    log("No tournaments to delete.");
  }

  // Delete invitations not between kept users
  const invitationResult = await GameInvitation.deleteMany({
    $or: [
      { senderId: { $nin: [...keepAccountIds].map((id) => new mongoose.Types.ObjectId(id)) } },
      { recipientId: { $nin: [...keepAccountIds].map((id) => new mongoose.Types.ObjectId(id)) } },
    ],
  });
  log(`Deleted ${invitationResult.deletedCount} invitations.`);

  // Clean up friend references on kept accounts (remove deleted users from lists)
  const _deletedAccountIds = await GameAccount.find(
    { _id: { $nin: [...keepAccountIds].map((id) => new mongoose.Types.ObjectId(id)) } },
    { _id: 1 },
  ).lean();
  // (already deleted, but clean up kept accounts' friend lists)
  for (const accountId of keepAccountIds) {
    await GameAccount.updateOne(
      { _id: new mongoose.Types.ObjectId(accountId) },
      {
        $pull: {
          friends: { $nin: [...keepAccountIds].map((id) => new mongoose.Types.ObjectId(id)) },
          receivedFriendRequests: {
            $nin: [...keepAccountIds].map((id) => new mongoose.Types.ObjectId(id)),
          },
          sentFriendRequests: {
            $nin: [...keepAccountIds].map((id) => new mongoose.Types.ObjectId(id)),
          },
        },
      },
    );
  }
  log("Cleaned up friend references on kept accounts.");

  console.log("\n✅ Cleanup complete.\n");

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
