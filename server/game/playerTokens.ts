import { randomUUID } from "crypto";
import { Request } from "express";
import jwt from "jsonwebtoken";
import { AuthResponse, PlayerIdentity } from "../../shared/src";
import { TOKEN_SECRET } from "../config/envVars";

type PlayerTokenPayload = {
  sub: string;
  kind: PlayerIdentity["kind"];
  displayName: string;
  email?: string;
  profilePicture?: string;
};

export function sanitizeDisplayName(displayName?: string): string {
  const trimmed = displayName?.trim();
  if (!trimmed) {
    return `Guest-${randomUUID().slice(0, 6)}`;
  }

  return trimmed.slice(0, 24);
}

export function createGuestAuth(displayName?: string): AuthResponse {
  const player: PlayerIdentity = {
    playerId: `guest-${randomUUID()}`,
    displayName: sanitizeDisplayName(displayName),
    kind: "guest",
  };

  return {
    token: signPlayerToken(player),
    player,
  };
}

export function createAccountAuth(account: {
  id: string;
  email: string;
  displayName: string;
  profilePicture?: string;
}): AuthResponse {
  const player: PlayerIdentity = {
    playerId: account.id,
    email: account.email,
    displayName: sanitizeDisplayName(account.displayName),
    kind: "account",
    profilePicture: account.profilePicture,
  };

  return {
    token: signPlayerToken(player),
    player,
  };
}

export function signPlayerToken(player: PlayerIdentity): string {
  const payload: PlayerTokenPayload = {
    sub: player.playerId,
    kind: player.kind,
    displayName: player.displayName,
    email: player.email,
    profilePicture: player.profilePicture,
  };

  return jwt.sign(payload, TOKEN_SECRET, {
    algorithm: "HS256",
    expiresIn: "30d",
  });
}

export function verifyPlayerToken(token: string): PlayerIdentity | null {
  try {
    const payload = jwt.verify(token, TOKEN_SECRET) as PlayerTokenPayload;

    return {
      playerId: payload.sub,
      displayName: payload.displayName,
      kind: payload.kind,
      email: payload.email,
      profilePicture: payload.profilePicture,
    };
  } catch {
    return null;
  }
}

export function getBearerToken(req: Request): string | null {
  const authorizationHeader = req.headers.authorization;
  if (!authorizationHeader) {
    return null;
  }

  const [type, token] = authorizationHeader.split(" ");
  if (type !== "Bearer" || !token) {
    return null;
  }

  return token;
}

export function getPlayerFromRequest(req: Request): PlayerIdentity | null {
  const token = getBearerToken(req);
  if (!token) {
    return null;
  }

  return verifyPlayerToken(token);
}

export function deriveDisplayNameFromEmail(email: string): string {
  const [localPart] = email.split("@");
  return sanitizeDisplayName(localPart || "Player");
}
