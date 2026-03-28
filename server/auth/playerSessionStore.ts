import { createHmac, randomBytes } from "crypto";
import { PlayerIdentity } from "../../shared/src";
import { TOKEN_SECRET } from "../config/envVars";
import GameSession from "../models/GameSession";

type StoredSession = {
  player: PlayerIdentity;
  expiresAt: Date;
};

export const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * SESSION_TTL_DAYS;

function digestSessionToken(token: string): string {
  return createHmac("sha256", TOKEN_SECRET).update(token).digest("hex");
}

function createSessionToken(): string {
  return randomBytes(48).toString("base64url");
}

function createExpiresAt(): Date {
  return new Date(Date.now() + SESSION_TTL_MS);
}

function toPlayerIdentity(session: {
  playerId: string;
  kind: PlayerIdentity["kind"];
  displayName: string;
  email?: string;
  profilePicture?: string;
}): PlayerIdentity {
  return {
    playerId: session.playerId,
    kind: session.kind,
    displayName: session.displayName,
    email: session.email,
    profilePicture: session.profilePicture,
  };
}

class MongoPlayerSessionStore {
  async create(player: PlayerIdentity): Promise<string> {
    const token = createSessionToken();

    await GameSession.create({
      tokenDigest: digestSessionToken(token),
      playerId: player.playerId,
      kind: player.kind,
      displayName: player.displayName,
      email: player.email,
      profilePicture: player.profilePicture,
      expiresAt: createExpiresAt(),
    });

    return token;
  }

  async read(token: string): Promise<StoredSession | null> {
    const session = await GameSession.findOne({
      tokenDigest: digestSessionToken(token),
      expiresAt: {
        $gt: new Date(),
      },
    }).exec();

    if (!session) {
      return null;
    }

    return {
      player: toPlayerIdentity(session),
      expiresAt: session.expiresAt,
    };
  }

  async replace(token: string, player: PlayerIdentity): Promise<boolean> {
    const result = await GameSession.updateOne(
      {
        tokenDigest: digestSessionToken(token),
        expiresAt: {
          $gt: new Date(),
        },
      },
      {
        $set: {
          playerId: player.playerId,
          kind: player.kind,
          displayName: player.displayName,
          email: player.email,
          profilePicture: player.profilePicture,
          expiresAt: createExpiresAt(),
        },
      },
    ).exec();

    return result.matchedCount > 0;
  }

  async delete(token: string): Promise<void> {
    await GameSession.deleteOne({
      tokenDigest: digestSessionToken(token),
    }).exec();
  }
}

class InMemoryPlayerSessionStore {
  private sessions = new Map<string, StoredSession>();

  async create(player: PlayerIdentity): Promise<string> {
    const token = createSessionToken();
    this.sessions.set(token, {
      player,
      expiresAt: createExpiresAt(),
    });
    return token;
  }

  async read(token: string): Promise<StoredSession | null> {
    const session = this.sessions.get(token);
    if (!session) {
      return null;
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      this.sessions.delete(token);
      return null;
    }

    return session;
  }

  async replace(token: string, player: PlayerIdentity): Promise<boolean> {
    const session = await this.read(token);
    if (!session) {
      return false;
    }

    this.sessions.set(token, {
      player,
      expiresAt: createExpiresAt(),
    });
    return true;
  }

  async delete(token: string): Promise<void> {
    this.sessions.delete(token);
  }

  reset(): void {
    this.sessions.clear();
  }
}

const sessionStore =
  process.env.NODE_ENV === "test"
    ? new InMemoryPlayerSessionStore()
    : new MongoPlayerSessionStore();

export async function createStoredPlayerSession(player: PlayerIdentity): Promise<string> {
  return sessionStore.create(player);
}

export async function readStoredPlayerSession(token: string): Promise<StoredSession | null> {
  return sessionStore.read(token);
}

export async function replaceStoredPlayerSession(
  token: string,
  player: PlayerIdentity,
): Promise<boolean> {
  return sessionStore.replace(token, player);
}

export async function deleteStoredPlayerSession(token: string): Promise<void> {
  await sessionStore.delete(token);
}

export function resetPlayerSessionStoreForTests(): void {
  if (sessionStore instanceof InMemoryPlayerSessionStore) {
    sessionStore.reset();
  }
}
