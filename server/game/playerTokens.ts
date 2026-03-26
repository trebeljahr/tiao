import { randomUUID } from "crypto";
import { IncomingMessage } from "http";
import { Request, Response } from "express";
import { AuthResponse, PlayerIdentity } from "../../shared/src";
import {
  createStoredPlayerSession,
  deleteStoredPlayerSession,
  readStoredPlayerSession,
  replaceStoredPlayerSession,
} from "../auth/playerSessionStore";

const SESSION_COOKIE_BASE = "tiao.session";
const SESSION_COOKIE_NAME =
  process.env.NODE_ENV === "development" && process.env.PORT
    ? `${SESSION_COOKIE_BASE}.${process.env.PORT}`
    : SESSION_COOKIE_BASE;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

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
    player,
  };
}

export function createAccountAuth(account: {
  id: string;
  email?: string;
  displayName: string;
  profilePicture?: string;
  hasSeenTutorial?: boolean;
}): AuthResponse {
  const player: PlayerIdentity = {
    playerId: account.id,
    email: account.email,
    displayName: sanitizeDisplayName(account.displayName),
    kind: "account",
    profilePicture: account.profilePicture,
    hasSeenTutorial: account.hasSeenTutorial ?? false,
  };

  return {
    player,
  };
}

function parseCookieHeader(cookieHeader?: string): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!cookieHeader) {
    return cookies;
  }

  for (const entry of cookieHeader.split(";")) {
    const [rawName, ...valueParts] = entry.trim().split("=");
    if (!rawName || valueParts.length === 0) {
      continue;
    }

    cookies.set(rawName, decodeURIComponent(valueParts.join("=")));
  }

  return cookies;
}

function getSessionCookieValue(
  request: Pick<Request, "headers"> | Pick<IncomingMessage, "headers">
): string | null {
  return parseCookieHeader(request.headers.cookie).get(SESSION_COOKIE_NAME) ?? null;
}

function isSecureRequest(
  request: Pick<Request, "headers" | "secure"> | Pick<IncomingMessage, "headers">
): boolean {
  const forwardedProto = request.headers["x-forwarded-proto"];
  const protocol = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto?.split(",")[0]?.trim();

  return ("secure" in request && request.secure) || protocol === "https";
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    maxAgeSeconds: number;
    secure: boolean;
    expires?: Date;
  }
): string {
  const cookie = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${options.maxAgeSeconds}`,
  ];

  if (options.expires) {
    cookie.push(`Expires=${options.expires.toUTCString()}`);
  }

  if (options.secure) {
    cookie.push("Secure");
  }

  return cookie.join("; ");
}

function setResponseCookie(
  response: Pick<Response, "setHeader">,
  cookieValue: string
): void {
  response.setHeader("Set-Cookie", cookieValue);
}

export function commitPlayerSession(
  req: Request,
  res: Pick<Response, "setHeader">,
  player: PlayerIdentity
): Promise<void> {
  return (async () => {
    const previousToken = getSessionCookieValue(req);
    if (previousToken) {
      await deleteStoredPlayerSession(previousToken);
    }

    const sessionToken = await createStoredPlayerSession(player);

    setResponseCookie(
      res,
      serializeCookie(SESSION_COOKIE_NAME, sessionToken, {
        maxAgeSeconds: SESSION_TTL_SECONDS,
        secure: isSecureRequest(req),
      })
    );
  })();
}

export function refreshPlayerSession(
  req: Request,
  res: Pick<Response, "setHeader">,
  player: PlayerIdentity
): Promise<void> {
  return (async () => {
    const sessionToken = getSessionCookieValue(req);
    if (!sessionToken) {
      await commitPlayerSession(req, res, player);
      return;
    }

    const replaced = await replaceStoredPlayerSession(sessionToken, player);
    if (!replaced) {
      await commitPlayerSession(req, res, player);
      return;
    }

    setResponseCookie(
      res,
      serializeCookie(SESSION_COOKIE_NAME, sessionToken, {
        maxAgeSeconds: SESSION_TTL_SECONDS,
        secure: isSecureRequest(req),
      })
    );
  })();
}

export function clearPlayerSession(
  req: Request,
  res: Pick<Response, "setHeader">
): Promise<void> {
  return (async () => {
    const sessionToken = getSessionCookieValue(req);
    if (sessionToken) {
      await deleteStoredPlayerSession(sessionToken);
    }

    setResponseCookie(
      res,
      serializeCookie(SESSION_COOKIE_NAME, "", {
        maxAgeSeconds: 0,
        expires: new Date(0),
        secure: isSecureRequest(req),
      })
    );
  })();
}

export async function getPlayerFromRequest(
  req: Request
): Promise<PlayerIdentity | null> {
  const sessionToken = getSessionCookieValue(req);
  if (!sessionToken) {
    return null;
  }

  const session = await readStoredPlayerSession(sessionToken);
  return session?.player ?? null;
}

export async function getPlayerFromUpgradeRequest(
  request: IncomingMessage
): Promise<PlayerIdentity | null> {
  const sessionToken = getSessionCookieValue(request);
  if (!sessionToken) {
    return null;
  }

  const session = await readStoredPlayerSession(sessionToken);
  return session?.player ?? null;
}

export function deriveDisplayNameFromEmail(email: string): string {
  const [localPart] = email.split("@");
  return sanitizeDisplayName(localPart || "Player");
}
