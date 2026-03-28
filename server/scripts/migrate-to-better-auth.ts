/**
 * One-time migration script: copies existing GameAccount data into
 * better-auth's `user` and `account` collections.
 *
 * Run with: npx tsx server/scripts/migrate-to-better-auth.ts
 *
 * IMPORTANT: Run this BEFORE deploying the better-auth code.
 * After migration, all users must log in again (sessions are not migrated).
 */

import "dotenv/config";
import dotenv from "dotenv";
dotenv.config({ path: ".env.development" });

import mongoose from "mongoose";
import { MONGODB_URI } from "../config/envVars";

async function migrate() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.getClient().db();

  const gameAccounts = db.collection("gameaccounts");
  const baUsers = db.collection("user");
  const baAccounts = db.collection("account");

  const cursor = gameAccounts.find({});
  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  while (await cursor.hasNext()) {
    const account = await cursor.next();
    if (!account) continue;

    const userId = account._id.toString();

    // Skip if already migrated
    const existing = await baUsers.findOne({ _id: userId as any });
    if (existing) {
      skipped++;
      continue;
    }

    try {
      // Determine email — use real email or generate placeholder for email-less accounts
      const email = account.email || `${account.displayName}@no-email.tiao.local`;
      const emailVerified = !!account.email;

      // Create better-auth user document
      await baUsers.insertOne({
        _id: userId as any,
        name: account.displayName,
        email,
        emailVerified,
        image: account.profilePicture || null,
        isAnonymous: false,
        displayName: account.displayName,
        createdAt: account.createdAt || new Date(),
        updatedAt: account.updatedAt || new Date(),
      });

      // Create better-auth account document (credential provider)
      // better-auth stores the password hash in the account table
      if (account.passwordHash) {
        await baAccounts.insertOne({
          userId,
          accountId: userId,
          providerId: "credential",
          password: account.passwordHash,
          createdAt: account.createdAt || new Date(),
          updatedAt: account.updatedAt || new Date(),
        });
      }

      migrated++;
      if (migrated % 100 === 0) {
        console.log(`  migrated ${migrated} accounts...`);
      }
    } catch (err) {
      errors++;
      console.error(`  Error migrating account ${userId}:`, err);
    }
  }

  console.log(
    `\nMigration complete: ${migrated} migrated, ${skipped} skipped (already exist), ${errors} errors`,
  );

  // Create indexes for better-auth collections
  console.log("Ensuring indexes...");
  await baUsers.createIndex({ email: 1 }, { unique: true });
  await baAccounts.createIndex({ userId: 1 });
  await baAccounts.createIndex({ providerId: 1, accountId: 1 }, { unique: true });

  console.log("Done. You can now deploy the better-auth code.");
  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
