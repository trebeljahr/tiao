import { describe, expect, it, vi } from "vitest";
import { unlinkProviderAccount } from "./unlinkProviderAccount";

describe("unlinkProviderAccount", () => {
  it("uses the authenticated account row ID rather than provider ID", async () => {
    const client = {
      listAccounts: vi.fn().mockResolvedValue({
        data: [
          { id: "credential-row", providerId: "credential", accountId: "user-id" },
          { id: "github-row", providerId: "github", accountId: "github-user-id" },
        ],
      }),
      unlinkAccount: vi.fn().mockResolvedValue({}),
    };
    await unlinkProviderAccount(client, "github");
    expect(client.unlinkAccount).toHaveBeenCalledExactlyOnceWith({ accountId: "github-row" });
  });
  it("never unlinks when lookup fails, is missing, or is ambiguous", async () => {
    for (const response of [
      { error: new Error("unavailable") },
      { data: [] },
      {
        data: [
          { id: "one", providerId: "github" },
          { id: "two", providerId: "github" },
        ],
      },
    ]) {
      const client = { listAccounts: vi.fn().mockResolvedValue(response), unlinkAccount: vi.fn() };
      await expect(unlinkProviderAccount(client, "github")).rejects.toBeDefined();
      expect(client.unlinkAccount).not.toHaveBeenCalled();
    }
  });
});
