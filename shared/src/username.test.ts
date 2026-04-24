import { describe, expect, it } from "vitest";
import { isValidUsername } from "./protocol";

describe("isValidUsername", () => {
  it("accepts valid usernames", () => {
    expect(isValidUsername("rico")).toBe(true);
    expect(isValidUsername("player-1")).toBe(true);
    expect(isValidUsername("cool_name")).toBe(true);
    expect(isValidUsername("abc")).toBe(true);
    expect(isValidUsername("a".repeat(32))).toBe(true);
    expect(isValidUsername("1player")).toBe(true);
  });

  it("rejects usernames with spaces", () => {
    expect(isValidUsername("andreas edmeier")).toBe(false);
    expect(isValidUsername("john doe")).toBe(false);
  });

  it("rejects usernames with uppercase", () => {
    expect(isValidUsername("Andreas")).toBe(false);
    expect(isValidUsername("RICO")).toBe(false);
  });

  it("rejects usernames that are too short", () => {
    expect(isValidUsername("ab")).toBe(false);
    expect(isValidUsername("a")).toBe(false);
    expect(isValidUsername("")).toBe(false);
  });

  it("rejects usernames that are too long", () => {
    expect(isValidUsername("a".repeat(33))).toBe(false);
  });

  it("rejects usernames starting with special characters", () => {
    expect(isValidUsername("-player")).toBe(false);
    expect(isValidUsername("_player")).toBe(false);
  });

  it("rejects usernames with special characters", () => {
    expect(isValidUsername("user@name")).toBe(false);
    expect(isValidUsername("user.name")).toBe(false);
    expect(isValidUsername("user name")).toBe(false);
    expect(isValidUsername("user!name")).toBe(false);
  });
});
