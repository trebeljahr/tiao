import { type Document, model, models, Schema } from "mongoose";

/**
 * Processed App Store Server Notifications v2, keyed by notificationUUID.
 * Apple retries a notification until it gets a 200, and may resend one
 * that already succeeded; this log turns those repeats into no-ops.
 */
export interface IAppStoreNotification extends Document {
  notificationUUID: string;
  notificationType: string;
  subtype?: string;
  originalTransactionId?: string;
  environment?: string;
  processedAt: Date;
}

const AppStoreNotificationSchema = new Schema<IAppStoreNotification>({
  notificationUUID: { type: String, required: true, unique: true },
  notificationType: { type: String, required: true },
  subtype: { type: String },
  originalTransactionId: { type: String },
  environment: { type: String },
  // Apple stops retrying after ~3 days; keep a month for debugging.
  processedAt: { type: Date, required: true, default: Date.now, expires: 60 * 60 * 24 * 30 },
});

const AppStoreNotification =
  models.AppStoreNotification ||
  model<IAppStoreNotification>("AppStoreNotification", AppStoreNotificationSchema);

export default AppStoreNotification;
