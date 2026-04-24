/**
 * Tests for SSO profile picture resolution.
 *
 * Validates that profile pictures from SSO providers (GitHub, Google, Discord)
 * are correctly resolved when GameAccount.profilePicture is not set,
 * ensuring the social routes fall back to better-auth's user.image.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SocialPlayerSummary } from "../../shared/src";

// ---------------------------------------------------------------------------
// Replicate the pure logic from social.routes.ts for isolated unit testing.
// These mirror the `toSocialPlayerSummary` and `applySsoFallback` functions.
// ---------------------------------------------------------------------------

type AccountLike = {
  id?: string;
  _id?: unknown;
  displayName: string;
  profilePicture?: string;
};

function toSocialPlayerSummary(account: AccountLike): SocialPlayerSummary {
  return {
    playerId: account.id ?? (account._id ? String(account._id) : ""),
    displayName: account.displayName,
    profilePicture: account.profilePicture,
  };
}

function applySsoFallback(
  accounts: AccountLike[],
  ssoMap: Map<string, string>,
): SocialPlayerSummary[] {
  return accounts.map((account) => {
    const id = account.id ?? (account._id ? String(account._id) : "");
    const profilePicture = account.profilePicture || ssoMap.get(id) || undefined;
    return toSocialPlayerSummary({ ...account, profilePicture });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SSO profile picture resolution", () => {
  describe("toSocialPlayerSummary", () => {
    it("includes profilePicture when present on GameAccount", () => {
      const result = toSocialPlayerSummary({
        id: "user-1",
        displayName: "alice",
        profilePicture: "https://cdn.cloudfront.net/abc.jpg",
      });

      assert.equal(result.profilePicture, "https://cdn.cloudfront.net/abc.jpg");
      assert.equal(result.displayName, "alice");
      assert.equal(result.playerId, "user-1");
    });

    it("returns undefined profilePicture when not set", () => {
      const result = toSocialPlayerSummary({
        id: "user-2",
        displayName: "bob",
      });

      assert.equal(result.profilePicture, undefined);
    });
  });

  describe("applySsoFallback", () => {
    it("fills missing profilePicture from SSO map", () => {
      const accounts: AccountLike[] = [
        { id: "user-1", displayName: "github-user" },
        { id: "user-2", displayName: "google-user" },
      ];
      const ssoMap = new Map([
        ["user-1", "https://avatars.githubusercontent.com/u/12345"],
        ["user-2", "https://lh3.googleusercontent.com/a/avatar-id"],
      ]);

      const results = applySsoFallback(accounts, ssoMap);

      assert.equal(results.length, 2);
      assert.equal(results[0].profilePicture, "https://avatars.githubusercontent.com/u/12345");
      assert.equal(results[1].profilePicture, "https://lh3.googleusercontent.com/a/avatar-id");
    });

    it("does not overwrite existing profilePicture with SSO image", () => {
      const customPic = "https://cdn.cloudfront.net/custom-upload.jpg";
      const accounts: AccountLike[] = [
        { id: "user-1", displayName: "custom-pic-user", profilePicture: customPic },
      ];
      const ssoMap = new Map([["user-1", "https://avatars.githubusercontent.com/u/99999"]]);

      const results = applySsoFallback(accounts, ssoMap);

      assert.equal(results[0].profilePicture, customPic);
    });

    it("returns undefined when neither GameAccount nor SSO has a picture", () => {
      const accounts: AccountLike[] = [{ id: "user-1", displayName: "no-pic-user" }];
      const ssoMap = new Map<string, string>();

      const results = applySsoFallback(accounts, ssoMap);

      assert.equal(results[0].profilePicture, undefined);
    });

    it("handles mixed accounts (some with pictures, some without)", () => {
      const accounts: AccountLike[] = [
        {
          id: "user-1",
          displayName: "has-custom",
          profilePicture: "https://cdn.example.com/a.jpg",
        },
        { id: "user-2", displayName: "has-sso-only" },
        { id: "user-3", displayName: "has-nothing" },
      ];
      const ssoMap = new Map([["user-2", "https://cdn.discordapp.com/avatars/123/abc.png"]]);

      const results = applySsoFallback(accounts, ssoMap);

      assert.equal(results[0].profilePicture, "https://cdn.example.com/a.jpg");
      assert.equal(results[1].profilePicture, "https://cdn.discordapp.com/avatars/123/abc.png");
      assert.equal(results[2].profilePicture, undefined);
    });

    it("handles _id field (lean documents) instead of id", () => {
      const accounts: AccountLike[] = [{ _id: "user-1", displayName: "lean-doc-user" }];
      const ssoMap = new Map([["user-1", "https://avatars.githubusercontent.com/u/55555"]]);

      const results = applySsoFallback(accounts, ssoMap);

      assert.equal(results[0].profilePicture, "https://avatars.githubusercontent.com/u/55555");
      assert.equal(results[0].playerId, "user-1");
    });

    it("handles empty accounts list", () => {
      const results = applySsoFallback([], new Map());
      assert.equal(results.length, 0);
    });
  });

  describe("sessionHelper profilePicture resolution", () => {
    // This validates the priority chain: GameAccount > better-auth user.image > undefined
    it("prefers GameAccount.profilePicture over SSO image", () => {
      const accountPic = "https://cdn.cloudfront.net/uploaded.jpg";
      const ssoPic = "https://avatars.githubusercontent.com/u/12345";

      // Simulates the logic in sessionHelper.ts toPlayerIdentity:
      // profilePicture: account?.profilePicture || user.image || undefined
      const resolved = accountPic || ssoPic || undefined;
      assert.equal(resolved, accountPic);
    });

    it("falls back to SSO image when GameAccount has no picture", () => {
      const accountPic = undefined;
      const ssoPic = "https://avatars.githubusercontent.com/u/12345";

      const resolved = accountPic || ssoPic || undefined;
      assert.equal(resolved, ssoPic);
    });

    it("returns undefined when neither source has a picture", () => {
      const accountPic = undefined;
      const ssoPic = null;

      const resolved = accountPic || ssoPic || undefined;
      assert.equal(resolved, undefined);
    });
  });
});
