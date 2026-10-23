import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finishSteamWebAccount, getPendingSteamWebAccount } from "./steamWebAuth";

const originalFetch = globalThis.fetch;
const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = fetchMock;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Steam browser setup", () => {
  it("loads a pending Steam proof using HttpOnly browser cookies", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        status: "needs_setup",
        profile: { displayName: "Maia", suggestedUsername: "maia" },
      }),
    );
    const result = await getPendingSteamWebAccount();
    expect(result.status).toBe("needs_setup");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/steam/pending"),
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });
  it("does not block ordinary browsing when the server has no Steam proof or is unavailable", async () => {
    fetchMock.mockRejectedValue(new Error("Offline"));
    expect(await getPendingSteamWebAccount()).toEqual({ status: "none" });
  });
  it("links the authenticated web account without sending a user ID or Steam ID", async () => {
    fetchMock.mockResolvedValue(Response.json({ status: "signed_in" }));
    await finishSteamWebAccount("link");
    const options = fetchMock.mock.calls[0][1];
    expect(options.credentials).toBe("include");
    expect(JSON.parse(options.body)).toEqual({ action: "link" });
  });
  it("keeps username conflicts visible so the player can edit the suggestion", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ message: "That username is already taken." }, { status: 409 }),
    );
    await expect(finishSteamWebAccount("create", "maia")).rejects.toThrow("already taken");
  });
});
