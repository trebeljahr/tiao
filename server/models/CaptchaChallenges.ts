import { Schema, model, Document } from "mongoose";

interface IAltchaChallenge extends Document {
  challenge: string;
  signature: string;
  salt: string;
  algorithm: string;
  maxnumber?: number;
  createdAt: Date;
  isSolved: boolean;
}

const AltchaChallengeSchema = new Schema<IAltchaChallenge>({
  challenge: { type: String, required: true },
  signature: { type: String, required: true },
  salt: { type: String, required: true },
  algorithm: { type: String, required: true },
  maxnumber: { type: Number },
  createdAt: { type: Date, default: Date.now },
  isSolved: { type: Boolean, default: false },
});

AltchaChallengeSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3600 });

export const AltchaChallenge = model<IAltchaChallenge>(
  "AltchaChallenge",
  AltchaChallengeSchema
);
