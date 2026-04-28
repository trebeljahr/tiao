import { type Document, type Model, model, models, Schema } from "mongoose";

export interface IAchievement extends Document {
  playerId: Schema.Types.ObjectId;
  achievementId: string;
  unlockedAt: Date;
}

// Lazy-initialise the model so that tests which never touch achievements
// don't crash when Mongoose has no active connection.
let _model: Model<IAchievement> | null = null;

function getModel(): Model<IAchievement> {
  if (_model) return _model;
  if (models.Achievement) {
    _model = models.Achievement as Model<IAchievement>;
    return _model;
  }

  const AchievementSchema = new Schema<IAchievement>(
    {
      playerId: {
        type: Schema.Types.ObjectId,
        ref: "GameAccount",
        required: true,
      },
      achievementId: {
        type: String,
        required: true,
        trim: true,
      },
      unlockedAt: {
        type: Date,
        default: () => new Date(),
      },
    },
    {
      timestamps: false,
    },
  );

  AchievementSchema.index({ playerId: 1, achievementId: 1 }, { unique: true });
  AchievementSchema.index({ playerId: 1 });

  _model = model<IAchievement>("Achievement", AchievementSchema);
  return _model;
}

// Proxy that lazily initialises the real model on first use.
// Tests that never call Achievement methods won't trigger model compilation.
// Tests can override individual methods (e.g. `Achievement.find = ...`) and
// those overrides will be used instead of hitting the real Mongoose model.
const _overrides = new Map<string | symbol, unknown>();

const Achievement = new Proxy({} as Model<IAchievement>, {
  get(_target, prop, _receiver) {
    if (_overrides.has(prop)) return _overrides.get(prop);
    const realModel = getModel();
    const value = (realModel as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? (value as Function).bind(realModel) : value;
  },
  set(_target, prop, value) {
    _overrides.set(prop, value);
    return true;
  },
});

export default Achievement;
