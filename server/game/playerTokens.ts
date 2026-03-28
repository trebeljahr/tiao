import { randomUUID } from "crypto";
import { IncomingMessage } from "http";
import { Request, Response } from "express";
import { AuthResponse, PlayerIdentity } from "../../shared/src";
import {
  createStoredPlayerSession,
  deleteStoredPlayerSession,
  readStoredPlayerSession,
  replaceStoredPlayerSession,
  SESSION_TTL_DAYS,
} from "../auth/playerSessionStore";

const SESSION_COOKIE_BASE = "tiao.session";
const SESSION_COOKIE_NAME =
  process.env.NODE_ENV === "development" && process.env.PORT
    ? `${SESSION_COOKIE_BASE}.${process.env.PORT}`
    : SESSION_COOKIE_BASE;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * SESSION_TTL_DAYS;

// ─── Fun Anonymous Name Generator ───────────────────────────────────

const ADJECTIVES = [
  "brave", "clever", "swift", "gentle", "bold", "calm", "bright", "kind",
  "wise", "lucky", "happy", "keen", "cool", "free", "warm", "wild",
  "quiet", "proud", "fair", "crisp", "merry", "witty", "noble", "plucky",
  "daring", "vivid", "jolly", "nimble", "hardy", "sleek", "eager", "loyal",
  "zesty", "chill", "spry", "peppy", "sunny", "cozy", "snappy", "fluffy",
  "mighty", "tiny", "fancy", "funky", "dizzy", "perky", "sassy", "cosmic",
  "stellar", "wistful",
];

const COLORS = [
  "pink", "golden", "azure", "coral", "amber", "jade", "ruby", "ivory",
  "silver", "teal", "crimson", "violet", "copper", "scarlet", "indigo",
  "peach", "olive", "bronze", "cobalt", "lilac", "onyx", "sage", "honey",
  "rust", "plum", "mint", "slate", "mauve", "opal", "pearl", "khaki",
  "denim", "lemon", "tangerine", "cyan", "magenta", "charcoal", "cream",
  "saffron", "turquoise",
];

const ANIMALS = [
  "fox", "owl", "bear", "wolf", "hawk", "deer", "lion", "dove", "seal",
  "crow", "hare", "frog", "swan", "lynx", "wren", "eagle", "otter",
  "panda", "tiger", "koala", "raven", "whale", "bison", "crane", "finch",
  "gecko", "heron", "ibis", "jaguar", "lemur", "moose", "newt", "oriole",
  "parrot", "quail", "robin", "shark", "toucan", "viper", "walrus",
  "zebra", "badger", "cobra", "dingo", "egret", "falcon", "gopher",
  "hippo", "iguana", "jackal",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateFunAnonymousName(): string {
  return `${pick(ADJECTIVES)}-${pick(COLORS)}-${pick(ANIMALS)}`;
}

// ─── Display Name Helpers ───────────────────────────────────────────

export function sanitizeDisplayName(displayName?: string): string {
  const trimmed = displayName?.trim();
  if (!trimmed) {
    return generateFunAnonymousName();
  }

  return trimmed.slice(0, 32);
}

export function createGuestAuth(displayName?: string): AuthResponse {
  const player: PlayerIdentity = {
    playerId: `guest-${randomUUID()}`,
    displayName: displayName?.trim() ? sanitizeDisplayName(displayName) : generateFunAnonymousName(),
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
  badges?: string[];
  activeBadges?: string[];
  rating?: number;
}): AuthResponse {
  const player: PlayerIdentity = {
    playerId: account.id,
    email: account.email,
    displayName: sanitizeDisplayName(account.displayName),
    kind: "account",
    profilePicture: account.profilePicture,
    hasSeenTutorial: account.hasSeenTutorial ?? false,
    badges: account.badges ?? [],
    activeBadges: account.activeBadges ?? [],
    rating: account.rating,
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
    "SameSite=Lax",
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
