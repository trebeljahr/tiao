import { model, models, Schema } from "mongoose";

/** One immutable checkout attempt. Active attempts are shared across tabs and API workers. */
const schema = new Schema(
  {
    _id: { type: String, required: true },
    purchaseKey: { type: String, required: true },
    playerId: { type: String, required: true, index: true },
    itemType: { type: String, enum: ["badge", "theme"], required: true },
    itemId: { type: String, required: true },
    desktop: { type: Boolean, default: false },
    active: { type: Boolean, required: true, default: true },
    sessionId: { type: String },
    state: {
      type: String,
      enum: ["open", "pending", "granted", "failed", "expired", "revoked"],
      default: "open",
    },
    createdAt: { type: Date, required: true },
  },
  { versionKey: false },
);
schema.index({ purchaseKey: 1 }, { unique: true, partialFilterExpression: { active: true } });
schema.index({ sessionId: 1 }, { unique: true, sparse: true });

export default models.StripePurchase || model("StripePurchase", schema);
