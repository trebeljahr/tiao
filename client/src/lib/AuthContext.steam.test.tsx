import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";

const mocks = vi.hoisted(() => ({
  token: null as string | null,
  check: vi.fn(),
  identity: vi.fn(),
  anonymous: vi.fn(),
  session: vi.fn(),
  startOAuth: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({
  getAuthClient: async () => ({
    getSession: mocks.session,
    signIn: { anonymous: mocks.anonymous },
  }),
}));
vi.mock("@/lib/api", () => ({
  getPlayerIdentity: mocks.identity,
  login: vi.fn(),
  refreshElectronTokenFromBridge: async () => mocks.token,
  setElectronTokenCache: (token: string | null) => {
    mocks.token = token;
  },
  getCachedElectronToken: () => mocks.token,
  onAuthTokenIssued: vi.fn(),
}));
vi.mock("@/lib/desktopAuth", () => ({
  signInWithSteam: mocks.check,
  desktopAuthBridge: () => ({ startOAuth: mocks.startOAuth }),
}));
vi.mock("@/lib/glitchtip", () => ({ setUser: vi.fn() }));
vi.mock("@/lib/useActiveBadge", () => ({ resetActiveBadges: vi.fn() }));
vi.mock("@/lib/useBoardTheme", () => ({ resetBoardTheme: vi.fn() }));
const original = Object.getOwnPropertyDescriptor(window, "electron");
function Identity() {
  const { auth, authBootstrapped, steamSetupRequired } = useAuth();
  return (
    <output>
      {authBootstrapped
        ? steamSetupRequired
          ? "setup"
          : (auth?.player.displayName ?? "local")
        : "checking"}
    </output>
  );
}
function SteamLogin() {
  const { finishSteamSetup } = useAuth();
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        onClick={() => void finishSteamSetup!("check").catch((err) => setError(err.message))}
      >
        Steam login
      </button>
      {error && <output>{error}</output>}
    </>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.token = null;
  mocks.startOAuth.mockResolvedValue({ ok: true });
  Object.defineProperty(window, "electron", {
    configurable: true,
    value: { isElectron: true, config: { isSteamBuild: true } },
  });
  mocks.identity.mockResolvedValue({
    player: { kind: "account", displayName: "active-steam-player", playerId: "active" },
  });
});
afterEach(() => {
  if (original) Object.defineProperty(window, "electron", original);
  else Reflect.deleteProperty(window, "electron");
});

it("returning Steam players use the verified desktop session instead of a browser cookie", async () => {
  mocks.check.mockImplementation(async () => {
    mocks.token = "verified-steam-token";
    return { status: "signed_in" };
  });
  render(
    <AuthProvider>
      <Identity />
    </AuthProvider>,
  );
  await screen.findByText("active-steam-player");
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.anonymous).not.toHaveBeenCalled();
});
it("an unlinked Steam player sees setup before any guest or permanent account is created", async () => {
  mocks.check.mockResolvedValue({ status: "needs_setup" });
  render(
    <AuthProvider>
      <Identity />
    </AuthProvider>,
  );
  await screen.findByText("setup");
  expect(mocks.anonymous).not.toHaveBeenCalled();
  expect(mocks.identity).not.toHaveBeenCalled();
});
it("offline Steam never inherits another player's cached identity or saved bearer token", async () => {
  localStorage.setItem(
    "tiao:auth-cache",
    JSON.stringify({ player: { kind: "account", displayName: "previous-player" } }),
  );
  mocks.token = "previous-player-token";
  mocks.check.mockRejectedValue(new Error("Offline"));
  render(
    <AuthProvider>
      <Identity />
    </AuthProvider>,
  );
  await screen.findByText("local");
  await waitFor(() => expect(mocks.token).toBeNull());
  expect(mocks.identity).not.toHaveBeenCalled();
  expect(mocks.anonymous).not.toHaveBeenCalled();
  expect(localStorage.getItem("tiao:auth-cache")).toBeNull();
  expect(mocks.startOAuth).not.toHaveBeenCalled();
});

it("explicit Steam login opens browser authentication when native Steam is unavailable", async () => {
  mocks.check.mockResolvedValue({ status: "unavailable" });
  render(
    <AuthProvider>
      <Identity />
      <SteamLogin />
    </AuthProvider>,
  );
  await screen.findByText("local");
  expect(mocks.startOAuth).not.toHaveBeenCalled();
  localStorage.setItem("tiao:steam-signed-out", "1");
  fireEvent.click(screen.getByRole("button", { name: "Steam login" }));
  await waitFor(() => expect(mocks.startOAuth).toHaveBeenCalledWith("steam"));
  expect(mocks.identity).not.toHaveBeenCalled();
  expect(localStorage.getItem("tiao:steam-signed-out")).toBeNull();
});

it("reports browser launch failure without adopting a cached identity", async () => {
  mocks.check.mockResolvedValue({ status: "unavailable" });
  mocks.startOAuth.mockResolvedValue({ ok: false });
  render(
    <AuthProvider>
      <Identity />
      <SteamLogin />
    </AuthProvider>,
  );
  await screen.findByText("local");
  fireEvent.click(screen.getByRole("button", { name: "Steam login" }));
  await screen.findByText("Could not start Steam sign-in. Please try again.");
  expect(mocks.identity).not.toHaveBeenCalled();
});

it("keeps native verification errors visible instead of switching login methods", async () => {
  mocks.check.mockResolvedValueOnce({ status: "unavailable" });
  render(
    <AuthProvider>
      <Identity />
      <SteamLogin />
    </AuthProvider>,
  );
  await screen.findByText("local");
  mocks.check.mockRejectedValueOnce(new Error("Steam ticket rejected."));
  fireEvent.click(screen.getByRole("button", { name: "Steam login" }));
  await screen.findByText("Steam ticket rejected.");
  expect(mocks.startOAuth).not.toHaveBeenCalled();
});
