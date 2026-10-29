import type { PlayerIdentity } from "@shared";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";
import { useBoardTheme } from "./useBoardTheme";

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

function Identity() {
  const { auth, authBootstrapped } = useAuth();
  return <output>{authBootstrapped ? (auth?.player.kind ?? "visitor") : "checking"}</output>;
}

function BoardTheme() {
  return <span data-testid="board-theme">{useBoardTheme().id}</span>;
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
    localStorage.setItem("tiao:boardTheme", "night");
    localStorage.setItem(
      "tiao:auth-cache",
      JSON.stringify({
        player: { kind: "account", playerId: "expired", unlockedThemes: ["night"] },
      }),
    );
    render(
      <AuthProvider createGuestSession={false}>
        <Identity />
        <BoardTheme />
      </AuthProvider>,
    );
    await screen.findByText("visitor");
    expect(localStorage.getItem("tiao:auth-cache")).toBeNull();
    expect(screen.getByTestId("board-theme")).toHaveTextContent("classic");
  });

  it.each([
    { kind: "guest", themes: ["night"], expected: "classic" },
    { kind: "account", themes: [], expected: "classic" },
    { kind: "account", themes: ["night"], expected: "night" },
  ] as const)("resolves saved themes using the current $kind's access ($expected)", async ({
    kind,
    themes,
    expected,
  }) => {
    localStorage.setItem("tiao:boardTheme", "night");
    const player: PlayerIdentity = {
      kind,
      playerId: "current-player",
      displayName: "Player",
      unlockedThemes: [...themes],
    };
    mocks.getSession.mockResolvedValue({ data: { user: { id: player.playerId } } });
    mocks.getPlayerIdentity.mockResolvedValue({ player });
    render(
      <AuthProvider>
        <Identity />
        <BoardTheme />
      </AuthProvider>,
    );
    await screen.findByText(kind);
    expect(screen.getByTestId("board-theme")).toHaveTextContent(expected);
  });

  it("does not apply a cached owner's skin while session verification is pending", async () => {
    localStorage.setItem("tiao:boardTheme", "night");
    localStorage.setItem(
      "tiao:auth-cache",
      JSON.stringify({
        player: { kind: "account", playerId: "expired", unlockedThemes: ["night"] },
      }),
    );
    let finishSessionCheck!: (value: { data: null }) => void;
    mocks.getSession.mockReturnValue(
      new Promise((resolve) => {
        finishSessionCheck = resolve;
      }),
    );
    render(
      <AuthProvider>
        <Identity />
        <BoardTheme />
      </AuthProvider>,
    );
    await waitFor(() => expect(mocks.getSession).toHaveBeenCalled());
    expect(screen.getByTestId("board-theme")).toHaveTextContent("classic");
    await act(async () => finishSessionCheck({ data: null }));
    await screen.findByText("guest");
    expect(screen.getByTestId("board-theme")).toHaveTextContent("classic");
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
