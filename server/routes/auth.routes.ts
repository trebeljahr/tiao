import bcrypt from "bcryptjs";
import express, { NextFunction, Response, Request } from "express";
import jwt from "jsonwebtoken";
import User from "../models/User";
import { isAuthenticated, jwtMiddleware } from "../middleware/jwt.middleware";
import { ALTCHA_HMAC_KEY, TOKEN_SECRET } from "../config/envVars";
import { createChallenge, extractParams, verifySolution } from "altcha-lib";
import { AltchaChallenge } from "../models/CaptchaChallenges";
import { rateLimiter } from "../middleware/rateLimiter";

const router = express.Router();
const saltRounds = 10;

const passwordRegex =
  /^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$%^&*-]).{12,}$/g;

const passwordRegexNotMatchingError =
  "Your password must have at least 12 characters and contain at least one number, one lowercase, one uppercase and one special character.";

router.get("/altcha-challenge", async (_: Request, res: Response) => {
  try {
    const challenge = await createChallenge({
      hmacKey: ALTCHA_HMAC_KEY,
    });

    const altchaChallenge = new AltchaChallenge({
      challenge: challenge.challenge,
      signature: challenge.signature,
      salt: challenge.salt,
      algorithm: challenge.algorithm,
      maxnumber: challenge.maxnumber,
    });

    await altchaChallenge.save();

    res.status(200).json(challenge);
  } catch (error) {
    console.error("Error creating challenge:", error);
    return res.status(500).json({ message: "Error creating challenge" });
  }
});

async function verifyAltchaChallenge(req: Request, res: Response) {
  try {
    const { altchaPayload } = req.body;
    const decodedString = Buffer.from(altchaPayload, "base64").toString("utf8");

    const decodedJSON = JSON.parse(decodedString) as {
      algorithm: string;
      challenge: string;
      number: number;
      salt: string;
      signature: string;
      took: number;
    };

    const existingChallenge = await AltchaChallenge.findOne({
      challenge: decodedJSON.challenge,
    });

    if (!existingChallenge) {
      res.status(404).json({ message: "Challenge not found or expired" });
      return;
    }

    if (existingChallenge.isSolved) {
      res.status(403).json({ message: "Challenge already solved" });
      return;
    }

    const altchaOk = await verifySolution(altchaPayload, ALTCHA_HMAC_KEY);
    if (!altchaOk) {
      res.status(403).json({ message: "Altcha solution invalid" });
      return;
    }

    return {
      markAsSolved: async () => {
        existingChallenge.isSolved = true;
        await existingChallenge.save();
      },
    };
  } catch (error) {
    console.error("Error verifying altcha solution:", error);
    res.status(500).json({ message: "Error verifying altcha solution" });
    return;
  }
}

router.post("/signup", rateLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password, username } = req.body;

    const solution = await verifyAltchaChallenge(req, res);

    if (!solution) {
      return;
    }

    if (email === "" || password === "" || username === "") {
      res.status(400).json({ message: "Provide email, password and username" });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ message: "Provide a valid email address." });
      return;
    }

    if (!passwordRegex.test(password)) {
      res.status(400).json({
        message: passwordRegexNotMatchingError,
      });
      return;
    }

    const foundUserByEmail = await User.findOne({ email });

    if (foundUserByEmail) {
      return res.status(400).json({
        message: "A user with this email already exists. Please login instead.",
      });
    }

    const foundUserByUsername = await User.findOne({ username });

    if (foundUserByUsername) {
      return res.status(400).json({
        message:
          "A user with this username already exists. Please choose another username.",
      });
    }

    const salt = bcrypt.genSaltSync(saltRounds);
    const hashedPassword = bcrypt.hashSync(password, salt);

    const createdUser = await User.create({
      email,
      password: hashedPassword,
      username,
    });

    solution.markAsSolved();

    const { _id } = createdUser;
    const payload = { _id };

    const authToken = jwt.sign(payload, TOKEN_SECRET, {
      algorithm: "HS256",
      expiresIn: "6h",
    });

    res.status(200).json({ authToken });
  } catch (error) {
    console.error("Error creating user:", error);
    return res.status(500).json({ message: "Error creating user" });
  }
});

router.post("/login", async (req: Request, res: Response) => {
  try {
    const { emailOrUsername, password } = req.body;

    if (emailOrUsername === "" || password === "") {
      res.status(400).json({ message: "Provide email and password." });
      return;
    }

    const foundUserByEmail = await User.findOne({ email: emailOrUsername });

    const foundUserByUsername = await User.findOne({
      username: emailOrUsername,
    });

    const foundUser = foundUserByEmail || foundUserByUsername;

    if (!foundUser) {
      res
        .status(401)
        .json({ message: "No user found for this email or username." });
      return;
    }

    const passwordCorrect = bcrypt.compareSync(password, foundUser.password);

    if (passwordCorrect) {
      const { _id } = foundUser;

      const payload = { _id };

      const authToken = jwt.sign(payload, TOKEN_SECRET, {
        algorithm: "HS256",
        expiresIn: "6h",
      });

      res.status(200).json({ authToken });
    } else {
      res.status(401).json({ message: "Unable to authenticate the user" });
    }
  } catch (error) {
    console.error("Error logging in user:", error);
    return res.status(500).json({ message: "Error logging in user" });
  }
});

router.post(
  "/change-password",
  rateLimiter,
  jwtMiddleware,
  isAuthenticated,
  async (req: Request, res: Response) => {
    try {
      const { oldPassword, newPassword } = req.body;

      if (!oldPassword || !newPassword) {
        return res
          .status(400)
          .json({ message: "Provide old and new password" });
      }

      const user = await User.findById(req.auth._id);

      if (!user) {
        return res.status(403).json({ message: "User not authorized" });
      }

      const passwordCorrect = bcrypt.compareSync(oldPassword, user.password);
      if (!passwordCorrect) {
        return res.status(401).json({ message: "Incorrect password" });
      }

      if (!passwordRegex.test(newPassword)) {
        return res.status(400).json({
          message: passwordRegexNotMatchingError,
        });
      }

      const salt = bcrypt.genSaltSync(saltRounds);
      const hashedPassword = bcrypt.hashSync(newPassword, salt);

      user.password = hashedPassword;
      await user.save();

      return res.status(200).json({ message: "Password succesfully updated!" });
    } catch (error) {
      return res.status(500).json({ message: "Error saving the new password" });
    }
  }
);

router.get(
  "/verify",
  jwtMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    const user = await User.findById(req.auth?._id)
      .populate("friends", "username profilePicture")
      .populate("sentFriendRequests", "profilePicture username")
      .populate("receivedFriendRequests", "profilePicture username");

    if (!user) {
      return res.status(403).json({ message: "User not authorized" });
    }

    const resObject = {
      _id: user._id,
      username: user.username,
      profilePicture: user.profilePicture,
      location: user.location,
      friends: user.friends,
      email: user.email,
      privacySettings: user.privacySettings,
      receivedFriendRequests: user.receivedFriendRequests,
      sentFriendRequests: user.sentFriendRequests,
      defaultPrivacy: user.defaultPrivacy,
    };

    res.status(200).json(resObject);
  }
);

export default router;
