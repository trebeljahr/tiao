import { createHash } from "node:crypto";
import type { ObjectId } from "mongodb";
import mongoose from "mongoose";
import { betterAuthIdFilter } from "./betterAuthIds";

export type DesktopSessionRecord = {
  _id: string;
  userId: string;
  sourceSessionId: string;
  securityState: string;
  nonce: string;
  expiresAt: number;
  absoluteExpiresAt: number;
  purgeAt?: Date;
};

export interface DesktopSessionStore {
  securityState(userId: string, sourceSessionId: string): Promise<string | null>;
  insert(record: DesktopSessionRecord): Promise<void>;
  read(id: string): Promise<DesktopSessionRecord | null>;
  rotate(id: string, nonce: string, next: string, expiresAt: number): Promise<boolean>;
  delete(id: string): Promise<void>;
}

type AuthId = string | ObjectId;
type AuthUser = {
  _id: AuthId;
  email?: string;
  emailVerified?: boolean;
  isAnonymous?: boolean;
  banned?: boolean;
  role?: string;
};
type AuthSession = { _id: AuthId; userId: AuthId; expiresAt: Date };
type AuthAccount = {
  _id: AuthId;
  userId: AuthId;
  providerId?: string;
  accountId?: string;
  password?: string;
};
type GameAccountSecurity = { _id: AuthId; isAdmin?: boolean };

function db() {
  return mongoose.connection.getClient().db();
}
function sessions() {
  return db().collection<DesktopSessionRecord>("desktopSessions");
}

/** No cache: revocation and account-security changes apply on the next request. */
export const desktopSessionStore: DesktopSessionStore = {
  async securityState(userId, sourceSessionId) {
    const userFilter = betterAuthIdFilter(userId);
    const sourceFilter = betterAuthIdFilter(sourceSessionId);
    if (!userFilter || !sourceFilter) return null;
    const [user, gameAccount, session, accounts] = await Promise.all([
      db()
        .collection<AuthUser>("user")
        .findOne(
          { _id: userFilter },
          { projection: { email: 1, emailVerified: 1, banned: 1, role: 1, isAnonymous: 1 } },
        ),
      db()
        .collection<GameAccountSecurity>("gameaccounts")
        .findOne({ _id: userFilter }, { projection: { isAdmin: 1 } }),
      db()
        .collection<AuthSession>("session")
        .findOne({
          _id: sourceFilter,
          userId: userFilter,
          expiresAt: { $gt: new Date() },
        }),
      db()
        .collection<AuthAccount>("account")
        .find({ userId: userFilter }, { projection: { providerId: 1, accountId: 1, password: 1 } })
        .toArray(),
    ]);
    if (!user || !gameAccount || user.isAnonymous || user.banned || !session) return null;
    // Ignore OAuth access-token refreshes and profile edits. Credentials,
    // verified email, linked providers, and privilege changes revoke access.
    const credentials = accounts.map((a) => [
      String(a._id),
      a.providerId,
      a.accountId,
      a.password ?? null,
    ]);
    credentials.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return createHash("sha256")
      .update(
        JSON.stringify([
          user.email,
          user.emailVerified,
          user.banned ?? false,
          user.role ?? null,
          gameAccount.isAdmin ?? false,
          credentials,
        ]),
      )
      .digest("hex");
  },
  async insert(record) {
    await sessions().insertOne({ ...record, purgeAt: new Date(record.absoluteExpiresAt) });
  },
  async read(id) {
    return sessions().findOne({ _id: id });
  },
  async rotate(id, nonce, next, expiresAt) {
    const result = await sessions().updateOne(
      { _id: id, nonce },
      { $set: { nonce: next, expiresAt } },
    );
    return result.modifiedCount === 1;
  },
  async delete(id) {
    await sessions().deleteOne({ _id: id });
  },
};
