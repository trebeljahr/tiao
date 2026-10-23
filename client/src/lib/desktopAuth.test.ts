import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signInWithSteam } from "./desktopAuth";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ refreshElectronTokenFromBridge: refresh }));
const original = Object.getOwnPropertyDescriptor(window, "electron");
const steam = vi.fn();
function bridge(isSteamBuild = true) {
  Object.defineProperty(window, "electron", {
    configurable: true,
    value: { isElectron: true, config: { isSteamBuild }, auth: { steam } },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  bridge();
});
afterEach(() => {
  if (original) Object.defineProperty(window, "electron", original);
  else Reflect.deleteProperty(window, "electron");
});

describe("native Steam login", () => {
  it("does not call Steam from a web or standalone build", async () => {
    bridge(false);
    expect((await signInWithSteam("check")).status).toBe("unavailable");
    expect(steam).not.toHaveBeenCalled();
  });
  it("refreshes cached tokens even when a new Steam player has no linked account", async () => {
    steam.mockResolvedValue({ status: "needs_setup" });
    await signInWithSteam("check");
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("does not automatically log a player back in after explicit logout or skipping", async () => {
    localStorage.setItem("tiao:steam-signed-out", "1");
    expect((await signInWithSteam("check")).status).toBe("unavailable");
    expect(steam).not.toHaveBeenCalled();
  });
  it("sends an explicit account-link action and adopts the verified session", async () => {
    steam.mockResolvedValue({ status: "signed_in" });
    await signInWithSteam("link");
    expect(steam).toHaveBeenCalledWith({ action: "link", username: undefined });
    expect(refresh).toHaveBeenCalled();
  });
});
