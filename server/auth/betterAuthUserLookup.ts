import mongoose from "mongoose";
import { betterAuthIdFilter, normalizeAuthId } from "./betterAuthIds";

/**
 * Shape of the subset of the better-auth `user` collection document that
 * `toPlayerIdentity` in sessionHelper.ts cares about.  Mirrors the
 * `session.user` shape returned by `auth.api.getSession()` so the same
 * `toPlayerIdentity` function works for both cookie-based sessions and
 * bearer-token-based desktop sessions.
 */
export type BetterAuthUserDocument = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  isAnonymous?: boolean | null;
  displayName?: string | null;
};

/**
 * Load a better-auth user record by its primary key (`_id` in the `user`
 * collection).  Returns a normalized subset for `toPlayerIdentity`.
 *
 * Uses the raw mongoose connection to query the `user` collection directly
 * — better-auth doesn't expose a public `getUser(id)` API, and defining a
 * mongoose model would duplicate schema knowledge that better-auth already
 * owns.  This is the same pattern used in `auth.ts` databaseHooks.
 *
 * Returns null on any error (missing user, DB disconnection, bad input)
 * so the caller — sessionHelper's bearer-token fallback — can degrade
 * gracefully to "no session" rather than 500ing.
 */
export async function lookupBetterAuthUser(userId: string): Promise<BetterAuthUserDocument | null> {
  if (!userId || typeof userId !== "string") return null;
  try {
    const db = mongoose.connection.getClient().db();
    // better-auth stores _id as the user's primary key (string or ObjectId
    // depending on adapter config), so match both when the id is ObjectId-like.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = await db.collection("user").findOne({ _id: betterAuthIdFilter(userId) as any });
    if (!doc) return null;
    return {
      id: normalizeAuthId(doc._id) ?? String(doc._id),
      name: typeof doc.name === "string" ? doc.name : "",
      email: typeof doc.email === "string" ? doc.email : "",
      image: typeof doc.image === "string" ? doc.image : null,
      isAnonymous: doc.isAnonymous === true ? true : null,
      displayName: typeof doc.displayName === "string" ? doc.displayName : null,
    };
  } catch (err) {
    console.error("[betterAuthUserLookup] lookup failed:", err);
    return null;
  }
}
