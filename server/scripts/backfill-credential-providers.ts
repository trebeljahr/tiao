/**
 * Backfill script: ensures every better-auth `user` that has a password hash
 * in the `account` collection also has a corresponding `credential` provider
 * entry, and vice versa — if a user has a passwordHash on their GameAccount
 * but no `account` entry at all, one is created.
 *
 * This fixes users migrated before the migration script handled all cases,
 * or users created through code paths that bypassed better-auth.
 *
 * Run with: npx tsx server/scripts/backfill-credential-providers.ts
 *
 * Safe to run multiple times (idempotent).
 */

import "dotenv/config";
import dotenv from "dotenv";

dotenv.config({ path: ".env.development" });

import mongoose from "mongoose";
import { MONGODB_URI } from "../config/envVars";

async function backfill() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.getClient().db();

  const gameAccounts = db.collection("gameaccounts");
  const baUsers = db.collection("user");
  const baAccounts = db.collection("account");

  let created = 0;
  let skipped = 0;
  let errors = 0;

  // Find all better-auth users that have NO account entry at all
  const allUsers = await baUsers.find({}).toArray();

  for (const user of allUsers) {
    const userId = user._id.toString();

    // Check if they already have any provider entries
    const existingAccounts = await baAccounts.find({ userId }).toArray();
    if (existingAccounts.length > 0) {
      skipped++;
      continue;
    }

    // No account entries — check if the GameAccount has a passwordHash
    const gameAccount = await gameAccounts.findOne({ _id: user._id });
    if (!gameAccount) {
      skipped++;
      continue;
    }

    try {
      if (gameAccount.passwordHash) {
        // User had a password — create a credential provider entry
        await baAccounts.insertOne({
          userId,
          accountId: userId,
          providerId: "credential",
          password: gameAccount.passwordHash,
          createdAt: gameAccount.createdAt || new Date(),
          updatedAt: gameAccount.updatedAt || new Date(),
        });
        console.log(`  + credential provider for ${gameAccount.displayName}`);
        created++;
      } else {
        // No password, no providers — nothing to backfill
        skipped++;
      }
    } catch (err) {
      errors++;
      console.error(`  Error backfilling account ${userId}:`, err);
    }
  }

  console.log(`\nBackfill complete: ${created} created, ${skipped} skipped, ${errors} errors`);

  await mongoose.disconnect();
}

backfill().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
