import { type Document, model, models, Schema } from "mongoose";

/**
 * One Google Play purchase token and the account it was granted to.
 *
 * The unique index on `purchaseToken` is what makes Play fulfillment
 * idempotent: the client callback, a restore and the RTDN push can all
 * race on the same token and only one account can ever own it. A
 * subscription keeps one token across renewals; an upgrade or resubscribe
 * issues a new token whose `linkedPurchaseToken` points at the old one.
 */

export type PlayPurchaseKind = "one_time" | "subscription";

export interface IPlayPurchase extends Document {
  purchaseToken: string;
  playerId: string;
  productId: string;
  kind: PlayPurchaseKind;
  itemType: "badge" | "theme";
  itemId: string;
  /** Last Google state we saw (purchaseState for one-time, subscriptionState for subs). */
  state: string;
  orderId?: string;
  expiryTime?: Date;
  acknowledged: boolean;
  testPurchase: boolean;
  /** Set when Google voided the purchase (refund/chargeback) or a newer token replaced it. */
  revokedAt?: Date;
  supersededBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PlayPurchaseSchema = new Schema<IPlayPurchase>(
  {
    purchaseToken: { type: String, required: true, unique: true },
    playerId: { type: String, required: true, index: true },
    productId: { type: String, required: true },
    kind: { type: String, enum: ["one_time", "subscription"], required: true },
    itemType: { type: String, enum: ["badge", "theme"], required: true },
    itemId: { type: String, required: true },
    state: { type: String, required: true },
    orderId: { type: String },
    expiryTime: { type: Date },
    acknowledged: { type: Boolean, default: false },
    testPurchase: { type: Boolean, default: false },
    revokedAt: { type: Date },
    supersededBy: { type: String },
  },
  { timestamps: true },
);

const PlayPurchase =
  models.PlayPurchase || model<IPlayPurchase>("PlayPurchase", PlayPurchaseSchema);

export default PlayPurchase;
