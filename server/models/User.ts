import { Schema, model, Document } from "mongoose";
import { CLOUDFRONT_URL } from "../config/envVars";

export type SharingState = "exact" | "city" | "country" | "none";
export interface FriendPrivacy {
  friendId: Schema.Types.ObjectId;
  visibility: SharingState;
}

export interface SingleLocation {
  name: string;
  latitude: number;
  longitude: number;
}

export interface UserLocation {
  lastUpdated: Date;
  country?: SingleLocation;
  city?: SingleLocation;
  exact?: SingleLocation;
}

const SingleLocationSchema = new Schema<SingleLocation>({
  name: {
    type: String,
    required: true,
  },
  latitude: {
    type: Number,
    required: true,
  },
  longitude: {
    type: Number,
    required: true,
  },
});

const UserLocationSchema = new Schema<UserLocation>({
  lastUpdated: {
    type: Date,
    required: true,
  },
  country: SingleLocationSchema,
  city: SingleLocationSchema,
  exact: SingleLocationSchema,
});

export interface IUser extends Document {
  username: string;
  email: string;
  password: string;
  location?: UserLocation;
  friends: Schema.Types.ObjectId[];
  privacySettings: FriendPrivacy[];
  receivedFriendRequests: Schema.Types.ObjectId[];
  sentFriendRequests: Schema.Types.ObjectId[];
  profilePicture: string;
  defaultPrivacy: SharingState;
}

const FriendPrivacySchema = new Schema<FriendPrivacy>({
  friendId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  visibility: {
    type: String,
    enum: ["exact", "city", "country", "none"],
    default: "none",
  },
});

const UserSchema = new Schema<IUser>({
  username: { type: String, required: true, unique: true },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: { type: String, required: true },
  location: { type: UserLocationSchema, default: { lastUpdated: new Date() } },
  receivedFriendRequests: [
    { type: Schema.Types.ObjectId, ref: "User", default: [] },
  ],
  sentFriendRequests: [
    { type: Schema.Types.ObjectId, ref: "User", default: [] },
  ],
  defaultPrivacy: {
    type: String,
    enum: ["exact", "city", "country", "none"],
    default: "city",
  },
  friends: [{ type: Schema.Types.ObjectId, ref: "User", default: [] }],
  privacySettings: { type: [FriendPrivacySchema], default: [] },
  profilePicture: { type: String, default: `${CLOUDFRONT_URL}/no-user.webp` },
});

const User = model<IUser>("User", UserSchema);

export default User;
