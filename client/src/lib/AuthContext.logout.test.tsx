import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";

const mocks = vi.hoisted(() => ({
  token: "desktop-session" as string | null,
  logout: vi.fn(),
  signOut: vi.fn(),
  anonymous: vi.fn(),
  toastError: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({
  getAuthClient: async () => ({
    getSession: async () => ({ data: { user: { id: "account" } } }),
    signOut: mocks.signOut,
    signIn: { anonymous: mocks.anonymous },
  }),
}));
vi.mock("@/lib/api", () => ({
  getPlayerIdentity: async () => ({
    player: { kind: "account", displayName: "web-account", playerId: "account" },
  }),
  login: vi.fn(),
  refreshElectronTokenFromBridge: async () => mocks.token,
  setElectronTokenCache: (token: string | null) => {
    mocks.token = token;
  },
  getCachedElectronToken: () => mocks.token,
  onAuthTokenIssued: vi.fn(),
}));
vi.mock("@/lib/steamWebAuth", () => ({
  getPendingSteamWebAccount: async () => ({ status: "none" }),
  finishSteamWebAccount: vi.fn(),
}));
vi.mock("@/lib/glitchtip", () => ({ setUser: vi.fn() }));
vi.mock("@/lib/errors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./errors")>()),
  toastError: mocks.toastError,
}));
vi.mock("@/lib/useActiveBadge", () => ({ resetActiveBadges: vi.fn() }));
vi.mock("@/lib/useBoardTheme", () => ({ resetBoardTheme: vi.fn() }));

const originalWindow = window;
let electron: { isElectron: boolean; config: { isSteamBuild: boolean }; auth: object } | undefined;

function Logout() {
  const { auth, authBootstrapped, appError, onLogout } = useAuth();
  return (
    <>
      <output>{authBootstrapped ? auth?.player.displayName : "checking"}</output>
      <output>{appError}</output>
      <button type="button" onClick={() => void onLogout()}>
        Log out
      </button>
    </>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  mocks.token = "desktop-session";
  mocks.logout.mockResolvedValue({ ok: true });
  mocks.signOut.mockResolvedValue({ data: { success: true } });
  mocks.anonymous.mockResolvedValue({ data: { user: { id: "guest" } } });
  electron = {
    isElectron: true,
    config: { isSteamBuild: true },
    auth: { logout: mocks.logout, steam: async () => ({ status: "signed_in" }) },
  };
  vi.stubGlobal(
    "window",
    new Proxy(originalWindow, {
      get(target, key) {
        if (key === "electron") return electron;
        if (key === "location") return { assign: mocks.navigate };
        return Reflect.get(target, key);
      },
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function logOut() {
  render(
    <AuthProvider>
      <Logout />
    </AuthProvider>,
  );
  await screen.findByText("web-account");
  fireEvent.click(screen.getByRole("button", { name: "Log out" }));
}

it.each([
  true,
  false,
])("finishes desktop logout without browser auth requests (Steam build: %s)", async (steam) => {
  electron!.config.isSteamBuild = steam;
  mocks.signOut.mockRejectedValue(new TypeError("Failed to fetch"));
  await logOut();
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/"));
  expect(mocks.logout).toHaveBeenCalledOnce();
  expect(mocks.token).toBeNull();
  expect(localStorage.getItem("tiao:auth-cache")).toBeNull();
  expect(localStorage.getItem("tiao:steam-signed-out")).toBe("1");
  expect(mocks.signOut).not.toHaveBeenCalled();
  expect(mocks.anonymous).not.toHaveBeenCalled();
  expect(mocks.toastError).not.toHaveBeenCalled();
});

it("keeps the desktop session available for retry when revocation fails", async () => {
  mocks.logout.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await logOut();
  await waitFor(() => expect(mocks.toastError).toHaveBeenCalledOnce());
  expect(mocks.token).toBe("desktop-session");
  expect(localStorage.getItem("tiao:auth-cache")).toContain("web-account");
  expect(localStorage.getItem("tiao:steam-signed-out")).toBeNull();
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(mocks.signOut).not.toHaveBeenCalled();
  expect(mocks.anonymous).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Log out" }));
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/"));
  expect(mocks.logout).toHaveBeenCalledTimes(2);
  expect(mocks.token).toBeNull();
});

it("does not fall back to cookie logout when the desktop logout bridge is unavailable", async () => {
  delete (electron!.auth as { logout?: unknown }).logout;
  await logOut();
  await waitFor(() => expect(mocks.toastError).toHaveBeenCalledOnce());
  expect(mocks.token).toBe("desktop-session");
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(mocks.signOut).not.toHaveBeenCalled();
});

it("still signs browser users out and creates a guest session before navigating", async () => {
  electron = undefined;
  mocks.token = null;
  await logOut();
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/"));
  expect(mocks.logout).not.toHaveBeenCalled();
  expect(mocks.signOut).toHaveBeenCalledOnce();
  expect(mocks.anonymous).toHaveBeenCalledOnce();
  expect(mocks.signOut.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.anonymous.mock.invocationCallOrder[0],
  );
  expect(localStorage.getItem("tiao:auth-cache")).toBeNull();
  expect(localStorage.getItem("tiao:steam-signed-out")).toBeNull();
});
