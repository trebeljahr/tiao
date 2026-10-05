import { type Document, type Model, model, models, Schema } from "mongoose";
import type { ShopItemType } from "../config/shopCatalog";

/**
 * Ledger of purchases made through a platform store (Steam
 * Microtransactions, Microsoft Store add-ons). Stripe keeps its own record
 * of truth and retries webhooks; the store APIs do not, so this collection
 * is what makes their fulfillment idempotent and binds each store
 * transaction to exactly one Tiao account.
 *
 * `(provider, externalId)` is unique:
 *   - steam   → the 64-bit orderid we generate for InitTxn
 *   - msstore → the collection `itemId` Microsoft returns for the add-on
 *
 * Lifecycle: `pending` (Steam order initiated, awaiting the player's
 * approval in the overlay) → `granted` (entitlement written to the
 * account) or `failed` (denied, expired, refunded before grant). Microsoft
 * Store records are created directly as `granted`.
 */
export type StoreProvider = "steam" | "msstore";
export type StorePurchaseStatus = "pending" | "granted" | "failed";

export interface IStorePurchase extends Document {
  provider: StoreProvider;
  externalId: string;
  playerId: string;
  itemType: ShopItemType;
  itemId: string;
  status: StorePurchaseStatus;
  /** Steam: buyer SteamID64 from the authenticated Web API ticket. */
  steamId?: string;
  /** Steam transid / Microsoft transactionId, for support lookups. */
  transactionId?: string;
  failureReason?: string;
  grantedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const StorePurchaseSchema = new Schema<IStorePurchase>(
  {
    provider: { type: String, required: true, enum: ["steam", "msstore"] },
    externalId: { type: String, required: true },
    playerId: { type: String, required: true, index: true },
    itemType: { type: String, required: true, enum: ["badge", "theme"] },
    itemId: { type: String, required: true },
    status: {
      type: String,
      required: true,
      enum: ["pending", "granted", "failed"],
      default: "pending",
    },
    steamId: { type: String },
    transactionId: { type: String },
    failureReason: { type: String },
    grantedAt: { type: Date },
  },
  { timestamps: true },
);

StorePurchaseSchema.index({ provider: 1, externalId: 1 }, { unique: true });
StorePurchaseSchema.index({ provider: 1, playerId: 1, status: 1, createdAt: -1 });

const StorePurchase: Model<IStorePurchase> =
  (models.StorePurchase as Model<IStorePurchase> | undefined) ??
  model<IStorePurchase>("StorePurchase", StorePurchaseSchema);

export default StorePurchase;
