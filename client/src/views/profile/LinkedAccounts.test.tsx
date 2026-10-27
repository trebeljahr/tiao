import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LinkedAccounts } from "./LinkedAccounts";

const mocks = vi.hoisted(() => ({
  desktop: null as {
    linkOAuth: ReturnType<typeof vi.fn>;
    onAuthComplete?: (cb: () => void) => () => void;
  } | null,
  steamBuild: false,
  webSteam: vi.fn().mockResolvedValue(undefined),
  finishSteam: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ finishSteamSetup: mocks.finishSteam }) }));
vi.mock("@/lib/authProviders", async (original) => ({
  ...(await original<typeof import("@/lib/authProviders")>()),
  useAppleSignInEnabled: () => true,
}));
vi.mock("@/lib/desktopAuth", () => ({
  desktopAuthBridge: () => mocks.desktop,
  signInWithSteam: vi.fn(),
}));
vi.mock("@/lib/SteamBridge", () => ({ isSteamBuild: () => mocks.steamBuild }));
vi.mock("@/lib/steamWebAuth", () => ({ startSteamWebSignIn: mocks.webSteam }));
vi.mock("@/lib/mobileAuth", () => ({ isNativeMobileApp: () => false }));

const props = {
  providers: ["credential"],
  currentEmail: "test@example.com",
  currentDisplayName: "tester",
  onProvidersChange: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.desktop = null;
  mocks.steamBuild = false;
});

describe("account linking choices", () => {
  it("places Steam beside Apple and the other link options on web", async () => {
    render(<LinkedAccounts {...props} />);
    const steam = screen.getByRole("button", { name: "Steam" });
    expect(steam.parentElement).toBe(screen.getByRole("button", { name: "Apple" }).parentElement);
    fireEvent.click(steam);
    await waitFor(() => expect(mocks.webSteam).toHaveBeenCalledWith("link"));
  });
  it("links Apple and Steam through the standalone desktop bridge", async () => {
    const linkOAuth = vi.fn().mockResolvedValue({ ok: true });
    mocks.desktop = { linkOAuth };
    render(<LinkedAccounts {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Apple" }));
    await waitFor(() => expect(linkOAuth).toHaveBeenCalledWith("apple"));
    fireEvent.click(screen.getByRole("button", { name: "Steam" }));
    await waitFor(() => expect(linkOAuth).toHaveBeenCalledWith("steam"));
    expect(mocks.webSteam).not.toHaveBeenCalled();
  });
  it("keeps native Steam ticket linking in Steam-distributed builds", async () => {
    mocks.steamBuild = true;
    render(<LinkedAccounts {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Steam" }));
    await waitFor(() => expect(mocks.finishSteam).toHaveBeenCalledWith("link"));
  });
  it("does not offer a second Steam link for a connected account", () => {
    render(<LinkedAccounts {...props} providers={["credential", "steam"]} />);
    expect(screen.queryByRole("button", { name: "Steam" })).not.toBeInTheDocument();
  });
});
