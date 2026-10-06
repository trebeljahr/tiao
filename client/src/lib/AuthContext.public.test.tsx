import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  anonymous: vi.fn(),
  getPlayerIdentity: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({
  getAuthClient: async () => ({
    getSession: mocks.getSession,
    signIn: { anonymous: mocks.anonymous },
  }),
}));
vi.mock("@/lib/api", () => ({
  getPlayerIdentity: mocks.getPlayerIdentity,
  login: vi.fn(),
  refreshElectronTokenFromBridge: async () => {},
  setElectronTokenCache: vi.fn(),
  getCachedElectronToken: () => null,
  onAuthTokenIssued: vi.fn(),
}));
vi.mock("@/lib/glitchtip", () => ({ setUser: vi.fn() }));
vi.mock("@/lib/useActiveBadge", () => ({ resetActiveBadges: vi.fn() }));
vi.mock("@/lib/useBoardTheme", () => ({ resetBoardTheme: vi.fn() }));

function Identity() {
  const { auth, authBootstrapped } = useAuth();
  return <output>{authBootstrapped ? (auth?.player.kind ?? "visitor") : "checking"}</output>;
}

describe("public page session bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.getSession.mockResolvedValue({ data: null });
    mocks.anonymous.mockResolvedValue({ data: { user: { id: "guest-id", name: "Guest" } } });
    mocks.getPlayerIdentity.mockResolvedValue({
      player: { kind: "guest", playerId: "guest-id", displayName: "Guest" },
    });
  });

  it("does not create a guest until the visitor enters the app", async () => {
    const view = render(
      <AuthProvider createGuestSession={false}>
        <Identity />
      </AuthProvider>,
    );
    await screen.findByText("visitor");
    expect(mocks.anonymous).not.toHaveBeenCalled();
    view.rerender(
      <AuthProvider createGuestSession>
        <Identity />
      </AuthProvider>,
    );
    await screen.findByText("guest");
    expect(mocks.anonymous).toHaveBeenCalledTimes(1);
  });

  it("detects a verified existing account without creating a guest", async () => {
    mocks.getSession.mockResolvedValue({ data: { user: { id: "account-id" } } });
    mocks.getPlayerIdentity.mockResolvedValue({
      player: { kind: "account", playerId: "account-id", displayName: "Player" },
    });
    render(
      <AuthProvider createGuestSession={false}>
        <Identity />
      </AuthProvider>,
    );
    await screen.findByText("account");
    expect(mocks.anonymous).not.toHaveBeenCalled();
  });

  it("discards an expired cached account on public pages", async () => {
    localStorage.setItem(
      "tiao:auth-cache",
      JSON.stringify({ player: { kind: "account", playerId: "expired" } }),
    );
    render(
      <AuthProvider createGuestSession={false}>
        <Identity />
      </AuthProvider>,
    );
    await screen.findByText("visitor");
    expect(localStorage.getItem("tiao:auth-cache")).toBeNull();
  });

  it("does not treat an unverifiable cached identity as signed in", async () => {
    localStorage.setItem(
      "tiao:auth-cache",
      JSON.stringify({ player: { kind: "account", playerId: "cached" } }),
    );
    mocks.getSession.mockRejectedValue(new Error("Server unavailable"));
    render(
      <AuthProvider createGuestSession={false}>
        <Identity />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("visitor"));
    expect(mocks.anonymous).not.toHaveBeenCalled();
  });
});
