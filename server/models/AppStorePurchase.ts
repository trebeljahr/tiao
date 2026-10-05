import { type Document, model, models, Schema } from "mongoose";

export type AppStorePurchaseStatus = "active" | "past_due" | "canceled" | "expired" | "revoked";

/**
 * One row per App Store purchase chain (keyed by originalTransactionId,
 * which stays fixed across subscription renewals and restores). The row
 * binds the purchase to the Tiao account that first proved it, so a
 * restore or notification can never move an entitlement to a different
 * account, and it records the latest state Apple reported.
 */
export interface IAppStorePurchase extends Document {
  originalTransactionId: string;
  /** Most recent transaction id seen for this chain (renewals change it). */
  transactionId: string;
  playerId: string;
  productId: string;
  itemType: "badge" | "theme";
  itemId: string;
  kind: "non_consumable" | "auto_renewable_subscription";
  environment: string;
  status: AppStorePurchaseStatus;
  /** Subscription period end (including any billing grace period). */
  expiresAt?: Date;
  revokedAt?: Date;
  /**
   * Apple `signedDate` of the newest payload applied. Older payloads
   * (out-of-order notifications, a stale JWS replayed by a client) are
   * ignored so they cannot roll the state back.
   */
  lastSignedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AppStorePurchaseSchema = new Schema<IAppStorePurchase>(
  {
    originalTransactionId: { type: String, required: true, unique: true },
    transactionId: { type: String, required: true },
    playerId: { type: String, required: true, index: true },
    productId: { type: String, required: true },
    itemType: { type: String, enum: ["badge", "theme"], required: true },
    itemId: { type: String, required: true },
    kind: {
      type: String,
      enum: ["non_consumable", "auto_renewable_subscription"],
      required: true,
    },
    environment: { type: String, required: true },
    status: {
      type: String,
      enum: ["active", "past_due", "canceled", "expired", "revoked"],
      required: true,
    },
    expiresAt: { type: Date },
    revokedAt: { type: Date },
    lastSignedAt: { type: Date, required: true },
  },
  { timestamps: true },
);

const AppStorePurchase =
  models.AppStorePurchase || model<IAppStorePurchase>("AppStorePurchase", AppStorePurchaseSchema);

export default AppStorePurchase;
