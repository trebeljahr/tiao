import { type Document, type Model, model, models, Schema } from "mongoose";

/**
 * Generic key/value store for small bits of server state that don't
 * belong to any player — e.g. the id of the pinned Discord leaderboard
 * message. One document per key, keyed by a stable string constant.
 *
 * Prefer a dedicated model once a setting grows past a single string.
 */
export interface IAppSetting extends Document {
  key: string;
  value: string;
  updatedAt: Date;
}

const AppSettingSchema = new Schema<IAppSetting>(
  {
    key: { type: String, required: true, unique: true, trim: true },
    value: { type: String, required: true },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

export async function getAppSetting(key: string): Promise<string | null> {
  const doc = (await AppSetting.findOne({ key }, { value: 1 }).lean()) as {
    value?: string;
  } | null;
  return doc?.value ?? null;
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  await AppSetting.updateOne({ key }, { $set: { value } }, { upsert: true });
}

const AppSetting: Model<IAppSetting> =
  (models.AppSetting as Model<IAppSetting> | undefined) ??
  model<IAppSetting>("AppSetting", AppSettingSchema);

export default AppSetting;
