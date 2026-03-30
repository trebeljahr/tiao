import assert from "node:assert/strict";
import { describe, test, before, beforeEach, mock } from "node:test";
import type { Request, Response } from "express";
import type { IncomingMessage } from "http";

// ---------------------------------------------------------------------------
// Environment variables required before importing any server modules
// ---------------------------------------------------------------------------
process.env.TOKEN_SECRET ??= "test-token-secret";
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/tiao-test";
process.env.S3_BUCKET_NAME ??= "tiao-test-assets";
process.env.S3_PUBLIC_URL ??= "https://assets.test.local";

// ---------------------------------------------------------------------------
// Stubs that we control from each test.
//
// We cannot use mock.module() in CommonJS, so instead we import the
// dependency modules and monkey-patch their exports before loading
// sessionHelper.  This mirrors the approach used in testAuthHelper.ts.
// ---------------------------------------------------------------------------
type AsyncFn = (...args: unknown[]) => Promise<unknown>;
const stubGetSession = mock.fn<AsyncFn>(() => Promise.resolve(null));
const stubFindById = mock.fn<AsyncFn>(() => Promise.resolve(null));

// ---------------------------------------------------------------------------
// Patch auth and GameAccount BEFORE sessionHelper is loaded so it picks
// up the stubs via its own require() calls.
// ---------------------------------------------------------------------------
import * as authModule from "../auth/auth";
import GameAccount from "../models/GameAccount";

// Patch auth.api.getSession
(authModule as Record<string, unknown>).auth = {
  api: {
    getSession: (...args: unknown[]) => stubGetSession(...args),
  },
};

// Patch GameAccount.findById
(GameAccount as unknown as Record<string, unknown>).findById = (...args: unknown[]) =>
  stubFindById(...args);

// ---------------------------------------------------------------------------
// Now import the module under test — it will see our patched exports.
// ---------------------------------------------------------------------------
import {
  getPlayerFromRequest,
  getPlayerFromUpgradeRequest,
  requireAccount,
  requireAdmin,
} from "../auth/sessionHelper";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeRequest(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function fakeResponse() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res as unknown as Response & {
    statusCode: number;
    body: Record<string, unknown>;
  };
}

function makeSession(user: {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  isAnonymous?: boolean | null;
  displayName?: string | null;
}) {
  return { user };
}

function makeGameAccount(overrides: Record<string, unknown> = {}) {
  return {
    _id: "user-1",
    displayName: "validuser",
    profilePicture: "https://example.com/pic.png",
    hasSeenTutorial: true,
    badges: ["early-adopter"],
    activeBadges: ["early-adopter"],
    isAdmin: false,
    rating: { overall: { elo: 1600, gamesPlayed: 10 } },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reset stubs between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  stubGetSession.mock.resetCalls();
  stubFindById.mock.resetCalls();
  stubGetSession.mock.mockImplementation(() => Promise.resolve(null));
  stubFindById.mock.mockImplementation(() => Promise.resolve(null));
});

// ---- getPlayerFromRequest ------------------------------------------------

describe("getPlayerFromRequest", () => {
  test("returns null when there is no session", async () => {
    stubGetSession.mock.mockImplementation(() => Promise.resolve(null));

    const result = await getPlayerFromRequest(fakeRequest());
    assert.equal(result, null);
  });

  test("returns a guest identity for anonymous users", async () => {
    stubGetSession.mock.mockImplementation(() =>
      Promise.resolve(
        makeSession({
          id: "anon-1",
          name: "FunkyPanda",
          email: "",
          isAnonymous: true,
        }),
      ),
    );

    const result = await getPlayerFromRequest(fakeRequest());

    assert.ok(result);
    assert.equal(result.kind, "guest");
    assert.equal(result.playerId, "anon-1");
    assert.equal(result.displayName, "FunkyPanda");
    assert.equal(result.email, undefined);
    assert.equal(result.badges, undefined);
  });

  test("returns a full account identity with badges and rating", async () => {
    stubGetSession.mock.mockImplementation(() =>
      Promise.resolve(
        makeSession({
          id: "user-1",
          name: "validuser",
          email: "user@example.com",
          image: "https://example.com/avatar.png",
        }),
      ),
    );
    stubFindById.mock.mockImplementation(() => Promise.resolve(makeGameAccount()));

    const result = await getPlayerFromRequest(fakeRequest());

    assert.ok(result);
    assert.equal(result.kind, "account");
    assert.equal(result.playerId, "user-1");
    assert.equal(result.displayName, "validuser");
    assert.equal(result.email, "user@example.com");
    assert.equal(result.profilePicture, "https://example.com/pic.png");
    assert.equal(result.hasSeenTutorial, true);
    assert.deepEqual(result.badges, ["early-adopter"]);
    assert.deepEqual(result.activeBadges, ["early-adopter"]);
    assert.equal(result.rating, 1600);
    // isAdmin false should not be spread into the identity
    assert.equal(result.isAdmin, undefined);
  });
});

// ---- getPlayerFromUpgradeRequest -----------------------------------------

describe("getPlayerFromUpgradeRequest", () => {
  test("returns null when there is no session", async () => {
    stubGetSession.mock.mockImplementation(() => Promise.resolve(null));

    const result = await getPlayerFromUpgradeRequest({ headers: {} } as IncomingMessage);
    assert.equal(result, null);
  });

  test("returns identity from an upgrade request", async () => {
    stubGetSession.mock.mockImplementation(() =>
      Promise.resolve(
        makeSession({
          id: "anon-2",
          name: "UpgradeGuest",
          email: "",
          isAnonymous: true,
        }),
      ),
    );

    const result = await getPlayerFromUpgradeRequest({ headers: {} } as IncomingMessage);

    assert.ok(result);
    assert.equal(result.kind, "guest");
    assert.equal(result.playerId, "anon-2");
  });
});

// ---- toPlayerIdentity edge cases (tested via getPlayerFromRequest) -------

describe("toPlayerIdentity edge cases", () => {
  test("falls back to user.displayName when GameAccount is not found", async () => {
    stubGetSession.mock.mockImplementation(() =>
      Promise.resolve(
        makeSession({
          id: "user-no-ga",
          name: "sso-user",
          email: "sso@example.com",
          displayName: "My Display Name",
        }),
      ),
    );
    stubFindById.mock.mockImplementation(() => Promise.resolve(null));

    const result = await getPlayerFromRequest(fakeRequest());

    assert.ok(result);
    assert.equal(result.displayName, "My Display Name");
    assert.equal(result.kind, "account");
  });

  test("falls back to user.name when both GameAccount and displayName are missing", async () => {
    stubGetSession.mock.mockImplementation(() =>
      Promise.resolve(
        makeSession({
          id: "user-fallback",
          name: "fallback-name",
          email: "fb@example.com",
          displayName: null,
        }),
      ),
    );
    stubFindById.mock.mockImplementation(() => Promise.resolve(null));

    const result = await getPlayerFromRequest(fakeRequest());

    assert.ok(result);
    assert.equal(result.displayName, "fallback-name");
  });

  test("sets needsUsername when displayName is not a valid username", async () => {
    stubGetSession.mock.mockImplementation(() =>
      Promise.resolve(
        makeSession({
          id: "user-sso",
          name: "John Doe", // spaces -> invalid username
          email: "john@example.com",
        }),
      ),
    );
    stubFindById.mock.mockImplementation(() => Promise.resolve(null));

    const result = await getPlayerFromRequest(fakeRequest());

    assert.ok(result);
    assert.equal(result.needsUsername, true);
  });

  test("does not set needsUsername when displayName is a valid username", async () => {
    stubGetSession.mock.mockImplementation(() =>
      Promise.resolve(
        makeSession({
          id: "user-valid",
          name: "validuser",
          email: "valid@example.com",
        }),
      ),
    );
    stubFindById.mock.mockImplementation(() =>
      Promise.resolve(makeGameAccount({ displayName: "validuser" })),
    );

    const result = await getPlayerFromRequest(fakeRequest());

    assert.ok(result);
    assert.equal(result.needsUsername, undefined);
  });

  test("falls back to user.image when GameAccount has no profilePicture", async () => {
    stubGetSession.mock.mockImplementation(() =>
      Promise.resolve(
        makeSession({
          id: "user-img",
          name: "validuser",
          email: "img@example.com",
          image: "https://example.com/oauth-avatar.png",
        }),
      ),
    );
    stubFindById.mock.mockImplementation(() =>
      Promise.resolve(makeGameAccount({ profilePicture: undefined })),
    );

    const result = await getPlayerFromRequest(fakeRequest());

    assert.ok(result);
    assert.equal(result.profilePicture, "https://example.com/oauth-avatar.png");
  });

  test("profilePicture is undefined when neither GameAccount nor user.image exist", async () => {
    stubGetSession.mock.mockImplementation(() =>
      Promise.resolve(
        makeSession({
          id: "user-nopic",
          name: "validuser",
          email: "nopic@example.com",
          image: null,
        }),
      ),
    );
    stubFindById.mock.mockImplementation(() =>
      Promise.resolve(makeGameAccount({ profilePicture: undefined })),
    );

    const result = await getPlayerFromRequest(fakeRequest());

    assert.ok(result);
    assert.equal(result.profilePicture, undefined);
  });

  test("isAdmin is set when GameAccount has isAdmin true", async () => {
    stubGetSession.mock.mockImplementation(() =>
      Promise.resolve(
        makeSession({
          id: "user-admin",
          name: "adminuser",
          email: "admin@example.com",
        }),
      ),
    );
    stubFindById.mock.mockImplementation(() =>
      Promise.resolve(makeGameAccount({ displayName: "adminuser", isAdmin: true })),
    );

    const result = await getPlayerFromRequest(fakeRequest());

    assert.ok(result);
    assert.equal(result.isAdmin, true);
  });

  test("defaults hasSeenTutorial to false and badges to empty when GameAccount is null", async () => {
    stubGetSession.mock.mockImplementation(() =>
      Promise.resolve(
        makeSession({
          id: "user-defaults",
          name: "validuser",
          email: "def@example.com",
        }),
      ),
    );
    stubFindById.mock.mockImplementation(() => Promise.resolve(null));

    const result = await getPlayerFromRequest(fakeRequest());

    assert.ok(result);
    assert.equal(result.hasSeenTutorial, false);
    assert.deepEqual(result.badges, []);
    assert.deepEqual(result.activeBadges, []);
    assert.equal(result.rating, undefined);
  });
});

// ---- requireAccount ------------------------------------------------------

describe("requireAccount", () => {
  test("returns 401 when no session exists", async () => {
    stubGetSession.mock.mockImplementation(() => Promise.resolve(null));

    const res = fakeResponse();
    const result = await requireAccount(fakeRequest(), res);

    assert.equal(result, null);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, "NOT_AUTHENTICATED");
  });

  test("returns 403 for guest users", async () => {
    stubGetSession.mock.mockImplementation(() =>
      Promise.resolve(
        makeSession({
          id: "guest-1",
          name: "GuestUser",
          email: "",
          isAnonymous: true,
        }),
      ),
    );

    const res = fakeResponse();
    const result = await requireAccount(fakeRequest(), res);

    assert.equal(result, null);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, "ACCOUNT_REQUIRED");
  });

  test("returns 404 when GameAccount is not found in the database", async () => {
    stubGetSession.mock.mockImplementation(() =>
      Promise.resolve(
        makeSession({
          id: "user-missing",
          name: "validuser",
          email: "missing@example.com",
        }),
      ),
    );
    // Both calls from toPlayerIdentity and requireAccount return null
    stubFindById.mock.mockImplementation(() => Promise.resolve(null));

    const res = fakeResponse();
    const result = await requireAccount(fakeRequest(), res);

    assert.equal(result, null);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, "ACCOUNT_NOT_FOUND");
  });

  test("returns the GameAccount for a valid account user", async () => {
    const account = makeGameAccount();
    stubGetSession.mock.mockImplementation(() =>
      Promise.resolve(
        makeSession({
          id: "user-1",
          name: "validuser",
          email: "user@example.com",
        }),
      ),
    );
    stubFindById.mock.mockImplementation(() => Promise.resolve(account));

    const res = fakeResponse();
    const result = await requireAccount(fakeRequest(), res);

    assert.ok(result);
    assert.equal(result.displayName, "validuser");
    assert.equal(res.statusCode, 0); // status() was never called
  });
});

// ---- requireAdmin --------------------------------------------------------

describe("requireAdmin", () => {
  test("returns 403 when account is not an admin", async () => {
    const account = makeGameAccount({ isAdmin: false });
    stubGetSession.mock.mockImplementation(() =>
      Promise.resolve(
        makeSession({
          id: "user-1",
          name: "validuser",
          email: "user@example.com",
        }),
      ),
    );
    stubFindById.mock.mockImplementation(() => Promise.resolve(account));

    const res = fakeResponse();
    const result = await requireAdmin(fakeRequest(), res);

    assert.equal(result, null);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, "ADMIN_REQUIRED");
  });

  test("returns 401 when no session exists (delegates to requireAccount)", async () => {
    stubGetSession.mock.mockImplementation(() => Promise.resolve(null));

    const res = fakeResponse();
    const result = await requireAdmin(fakeRequest(), res);

    assert.equal(result, null);
    assert.equal(res.statusCode, 401);
  });

  test("returns the account when user is an admin", async () => {
    const account = makeGameAccount({ isAdmin: true, displayName: "adminuser" });
    stubGetSession.mock.mockImplementation(() =>
      Promise.resolve(
        makeSession({
          id: "user-1",
          name: "adminuser",
          email: "admin@example.com",
        }),
      ),
    );
    stubFindById.mock.mockImplementation(() => Promise.resolve(account));

    const res = fakeResponse();
    const result = await requireAdmin(fakeRequest(), res);

    assert.ok(result);
    assert.equal(result.isAdmin, true);
    assert.equal(result.displayName, "adminuser");
    assert.equal(res.statusCode, 0);
  });
});
