import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import express, { Request, Response } from "express";
import { BUCKET_NAME, CLOUDFRONT_URL } from "../config/envVars";
import { s3Client } from "../config/s3Client";
import { isAuthenticated, jwtMiddleware } from "../middleware/jwt.middleware";
import { multerUploadMiddleware } from "../middleware/multerUploadMiddleware";
import User, {
  FriendPrivacy,
  IUser,
  SharingState,
  UserLocation,
} from "../models/User";
import { Jimp } from "jimp";
import { rateLimiter, userSearchRateLimiter } from "../middleware/rateLimiter";

// this makes the auth field *always* available in the Request object, which is only true when the jwt and authentication middleware are set up
declare global {
  namespace Express {
    interface Request {
      auth: {
        _id: string;
      };
    }
  }
}

const router = express.Router();

router.use(jwtMiddleware);
router.use(isAuthenticated);

router.post(
  "/users/profile-picture",
  rateLimiter,
  multerUploadMiddleware.single("profilePicture"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded." });
      }
      const user = await User.findById(req.auth._id);

      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const fileName = `${randomUUID()}.jpeg`;

      const size = {
        width: 288,
      };

      const image = await Jimp.read(req.file.buffer);
      image.resize({ w: size.width });

      const processedImageBuffer = await image.getBuffer("image/jpeg");

      const uploadParams = {
        Bucket: BUCKET_NAME,
        Key: fileName,
        Body: processedImageBuffer,
        ContentType: "image/jpeg",
      };

      const uploadCommand = new PutObjectCommand(uploadParams);
      await s3Client.send(uploadCommand);

      try {
        const defaultProfilePicture = `${CLOUDFRONT_URL}/no-user.webp`;
        if (user.profilePicture !== defaultProfilePicture) {
          const deleteParams = {
            Bucket: BUCKET_NAME,
            Key: user.profilePicture.split("/").pop(),
          };
          const deleteCommand = new DeleteObjectCommand(deleteParams);
          await s3Client.send(deleteCommand);
        }
      } catch (err) {
        console.error("Error deleting old profile picture from S3:", err);
      }

      const fileUrl = `${CLOUDFRONT_URL}/${fileName}`;

      user.profilePicture = fileUrl;
      await user.save();

      return res.status(200).json({
        message: "Profile picture uploaded successfully",
        profilePicture: user.profilePicture,
      });
    } catch (error) {
      console.error("Error uploading to S3:", error);
      return res.status(500).json({ message: "Internal Server Error." });
    }
  }
);

function mapSharingStateToLocation(
  sharingState: SharingState,
  location?: UserLocation
) {
  if (!location) return;

  if (sharingState === "exact") {
    return location.exact;
  } else if (sharingState === "city") {
    return location.city;
  } else if (sharingState === "country") {
    return location.country;
  }
  return;
}

router.get("/friends", async (req: Request<{ _id: string }>, res) => {
  try {
    const { _id: userId } = req.auth;

    const user = await User.findById(userId)
      .populate("friends", "username profilePicture privacySettings location")
      .lean();

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const friendsWithPrivacy = user.friends.map((friend: any) => {
      const typedFriend = friend as IUser;
      const sharingState =
        (typedFriend.privacySettings as FriendPrivacy[]).find(
          (setting) => setting.friendId.toString() === userId.toString()
        )?.visibility || "country";

      return {
        _id: typedFriend._id,
        username: typedFriend.username,
        profilePicture: typedFriend.profilePicture,
        sharingState,
        location: mapSharingStateToLocation(sharingState, typedFriend.location),
      };
    });

    return res.json(friendsWithPrivacy);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.delete("/friends", async (req: Request, res) => {
  const { _id: userId } = req.auth;
  const { friendId } = req.body;

  try {
    const user = await User.findById(userId);
    const friend = await User.findById(friendId);

    if (!user || !friend) {
      return res.status(404).json({ message: "User not found" });
    }

    if (
      !user.friends.includes(friend.id) ||
      !friend.friends.includes(user.id)
    ) {
      return res.status(400).json({ message: "User is not your friend" });
    }

    user.friends = user.friends.filter((id) => id.toString() !== friendId);
    friend.friends = friend.friends.filter((id) => id.toString() !== userId);

    user.privacySettings = user.privacySettings.filter(
      (setting) => setting.friendId.toString() !== friendId
    );

    friend.privacySettings = friend.privacySettings.filter(
      (setting) => setting.friendId.toString() !== userId
    );

    await user.save();
    await friend.save();

    return res.status(200).json({ message: "Friend removed successfully" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.put("/friends/privacy", async (req: Request, res) => {
  const { _id: currentUserId } = req.auth;
  const { friendId, newVisibility } = req.body;

  try {
    const user = await User.findById(currentUserId);

    if (
      !user ||
      !user.friends.includes(friendId) ||
      friendId === currentUserId
    ) {
      return res.status(404).json({ message: "User not found." });
    }

    const friendPrivacy = user.privacySettings.find(
      (privacy: any) => privacy.friendId.toString() === friendId
    );

    if (friendPrivacy) {
      friendPrivacy.visibility = newVisibility;
    } else {
      user.privacySettings.push({
        friendId: friendId,
        visibility: newVisibility,
      });
    }

    await user.save();
    return res.json({ message: "Privacy settings updated successfully" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get(
  "/profiles/:username",
  userSearchRateLimiter,
  async (req: Request, res) => {
    const { username } = req.params;

    try {
      const user = await User.findOne(
        { username },
        "username profilePicture defaultPrivacy"
      ).lean();

      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      return res.json(user);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

router.put("/users/default-privacy", async (req: Request, res) => {
  try {
    const { _id: userId } = req.auth;
    const { defaultPrivacy } = req.body;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    user.defaultPrivacy = defaultPrivacy;
    await user.save();

    return res
      .status(200)
      .json({ message: "Default privacy updated successfully." });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get(
  "/users/search",
  userSearchRateLimiter,
  async (req: Request, res) => {
    try {
      const { username } = req.query;
      const { _id: currentUserId } = req.auth;

      const friend = await User.findOne({ username });
      const user = await User.findById(currentUserId);

      if (!friend) {
        return res.status(404).json({ message: "User not found." });
      }

      if (!user) {
        return res
          .status(403)
          .json({ message: "It seems like you are not authenticated." });
      }

      if (friend.id === currentUserId) {
        return res
          .status(400)
          .json({ message: "You cannot add yourself as a friend." });
      }

      if (
        friend.friends.includes(user.id) ||
        user.friends.includes(friend.id)
      ) {
        return res
          .status(400)
          .json({ message: "User is already your friend." });
      }

      if (
        friend.receivedFriendRequests.includes(user.id) ||
        user.receivedFriendRequests.includes(friend.id)
      ) {
        return res
          .status(400)
          .json({ message: "Friend request already sent." });
      }

      return res.status(200).json(friend);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

router.post("/friends/requests", async (req: Request, res) => {
  const { _id: userId } = req.auth;
  const { friendId } = req.body;

  try {
    const user = await User.findById(userId);
    const friend = await User.findById(friendId);

    if (!user || !friend) {
      return res.status(404).json({ message: "User not found." });
    }

    if (user.id === friendId) {
      return res
        .status(400)
        .json({ message: "You cannot add yourself as a friend" });
    }

    if (user.friends.includes(friendId)) {
      return res
        .status(400)
        .json({ message: "You are already friends with this user" });
    }

    if (user.sentFriendRequests.includes(user.id)) {
      return res.status(400).json({ message: "Friend request already sent" });
    }

    friend.receivedFriendRequests.push(user.id);
    await friend.save();

    user.sentFriendRequests.push(friendId);
    await user.save();

    return res
      .status(200)
      .json({ message: "Friend request sent successfully" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/friends/requests", async (req: Request, res) => {
  const { _id: userId } = req.auth;
  try {
    const user = await User.findById(userId)
      .populate("receivedFriendRequests", "username profilePicture")
      .lean();

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const receivedFriendRequests = user.receivedFriendRequests.map(
      (requester: any) => ({
        _id: requester._id,
        username: requester.username,
        profilePicture: requester.profilePicture,
      })
    );

    return res.json(receivedFriendRequests);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/friends/requests/accept", async (req: Request, res) => {
  const { _id: userId } = req.auth;
  const { requesterId } = req.body;

  try {
    const user = await User.findById(userId);
    const requester = await User.findById(requesterId);

    if (
      !user ||
      !requester ||
      user.friends.includes(requesterId) ||
      user.id === requesterId
    ) {
      return res.status(404).json({ message: "User not found." });
    }

    if (!user.receivedFriendRequests.includes(requesterId)) {
      return res
        .status(400)
        .json({ message: "No pending friend request from this user" });
    }

    user.receivedFriendRequests = user.receivedFriendRequests.filter(
      (id) => id.toString() !== requesterId
    );

    requester.sentFriendRequests = requester.sentFriendRequests.filter(
      (id) => id.toString() !== userId
    );

    user.friends.push(requesterId);
    requester.friends.push(user.id);

    user.privacySettings.push({
      friendId: requesterId,
      visibility: "city",
    });

    requester.privacySettings.push({
      friendId: user.id,
      visibility: "city",
    });

    await user.save();
    await requester.save();

    return res.status(200).json({ message: "Friend request accepted" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/friends/requests/revoke", async (req: Request, res) => {
  const { _id: userId } = req.auth;
  const { friendId } = req.body;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    if (!user.sentFriendRequests.includes(friendId)) {
      return res
        .status(400)
        .json({ message: "No pending friend request to this user" });
    }

    const potentialFriend = await User.findById(friendId);

    if (!potentialFriend) {
      return res.status(404).json({ message: "Potential Friend not found." });
    }

    user.sentFriendRequests = user.sentFriendRequests.filter(
      (id) => id.toString() !== friendId
    );

    potentialFriend.receivedFriendRequests =
      potentialFriend.receivedFriendRequests.filter(
        (id) => id.toString() !== userId
      );

    await user.save();
    await potentialFriend.save();

    return res
      .status(200)
      .json({ message: "Friend request revoked succesfully." });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/friends/requests/decline", async (req: Request, res) => {
  const { _id: userId } = req.auth;
  const { requesterId } = req.body;

  try {
    const user = await User.findById(userId);
    const requester = await User.findById(requesterId);

    if (!user || !requester) {
      return res.status(404).json({ message: "User not found." });
    }

    if (user.id === requesterId) {
      return res
        .status(400)
        .json({ message: "You cannot decline your own friend request" });
    }

    if (!user.receivedFriendRequests.includes(requesterId)) {
      return res
        .status(400)
        .json({ message: "No pending friend request from this user" });
    }

    user.receivedFriendRequests = user.receivedFriendRequests.filter(
      (id) => id.toString() !== requesterId
    );

    requester.sentFriendRequests = requester.sentFriendRequests.filter(
      (id) => id.toString() !== userId
    );

    await user.save();
    await requester.save();

    return res.status(200).json({ message: "Friend request declined" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.put("/users/location", async (req: Request, res) => {
  const { _id: userId } = req.auth;
  const { country, city, exact } = req.body as UserLocation;

  try {
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    user.location = {
      lastUpdated: new Date(),
      country,
      city,
      exact,
    };

    await user.save();

    return res.status(200).json({ message: "Location updated successfully" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
