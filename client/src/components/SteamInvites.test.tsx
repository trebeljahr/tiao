import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetSteamActiveCacheForTests } from "@/lib/SteamBridge";
import { SteamInviteButton } from "./SteamInviteButton";
import { SteamInviteHandler } from "./SteamInviteHandler";

const { push, authState } = vi.hoisted(() => ({
  push: vi.fn(),
  authState: {
    auth: { player: { needsUsername: false } } as { player: { needsUsername: boolean } } | null,
    authBootstrapped: true,
    steamSetupRequired: false,
  },
}));
const router = { push };
vi.mock("@/i18n/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const electronWindow = window as unknown as { electron?: unknown };
function installBridge() {
  let listener: (() => void) | undefined;
  const off = vi.fn();
  const steam = {
    isActive: vi.fn().mockResolvedValue(true),
    setInviteGame: vi.fn().mockResolvedValue(undefined),
    openInviteDialog: vi.fn().mockResolvedValue(true),
    getPendingJoin: vi.fn().mockResolvedValue(null),
    acknowledgeJoin: vi.fn().mockResolvedValue(undefined),
    onJoinRequested: vi.fn((cb: () => void) => {
      listener = cb;
      return off;
    }),
  };
  electronWindow.electron = { steam };
  return { steam, off, notify: () => listener?.() };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete electronWindow.electron;
  _resetSteamActiveCacheForTests();
  authState.auth = { player: { needsUsername: false } };
  authState.authBootstrapped = true;
  authState.steamSetupRequired = false;
});
afterEach(() => {
  cleanup();
  delete electronWindow.electron;
});

describe("Steam invite button", () => {
  it("stays hidden on web and non-Steam desktop builds", () => {
    render(<SteamInviteButton gameId="ABC234" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("opens the native picker and clears its room when unmounted", async () => {
    const { steam } = installBridge();
    const { unmount } = render(<SteamInviteButton gameId="ABC234" />);
    fireEvent.click(await screen.findByRole("button", { name: "Invite Steam friends" }));
    await waitFor(() => expect(steam.openInviteDialog).toHaveBeenCalledOnce());
    expect(steam.setInviteGame).toHaveBeenCalledWith("ABC234");
    unmount();
    expect(steam.setInviteGame).toHaveBeenLastCalledWith(null);
  });

  it("shows an inline fallback when Steam refuses the picker", async () => {
    const { steam } = installBridge();
    steam.openInviteDialog.mockRejectedValue(new Error("IPC failed"));
    render(<SteamInviteButton gameId="ABC234" />);
    fireEvent.click(await screen.findByRole("button"));
    expect(await screen.findByRole("status")).toHaveTextContent("share the room link");
    expect(screen.getByRole("button")).toBeEnabled();
  });

  it("stays hidden when Steam initialization failed", async () => {
    const { steam } = installBridge();
    steam.isActive.mockResolvedValue(false);
    render(<SteamInviteButton gameId="ABC234" />);
    await act(async () => {});
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("accepted Steam invites", () => {
  it("delivers a cold-start invite once under Strict Mode and acknowledges it", async () => {
    const { steam, off } = installBridge();
    steam.getPendingJoin.mockResolvedValue({ id: 1, gameId: "ABC234" });
    const { unmount } = render(
      <StrictMode>
        <SteamInviteHandler />
      </StrictMode>,
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/game/ABC234"));
    expect(push).toHaveBeenCalledOnce();
    expect(steam.acknowledgeJoin).toHaveBeenCalledWith(1);
    unmount();
    expect(off).toHaveBeenCalled();
  });

  it("keeps the invite pending until authentication and account setup finish", async () => {
    const { steam } = installBridge();
    steam.getPendingJoin.mockResolvedValue({ id: 1, gameId: "ABC234" });
    authState.authBootstrapped = false;
    const { rerender } = render(<SteamInviteHandler />);
    expect(steam.getPendingJoin).not.toHaveBeenCalled();
    authState.authBootstrapped = true;
    authState.steamSetupRequired = true;
    rerender(<SteamInviteHandler />);
    expect(steam.getPendingJoin).not.toHaveBeenCalled();
    authState.steamSetupRequired = false;
    authState.auth = { player: { needsUsername: true } };
    rerender(<SteamInviteHandler />);
    expect(steam.getPendingJoin).not.toHaveBeenCalled();
    authState.auth.player.needsUsername = false;
    rerender(<SteamInviteHandler />);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/game/ABC234"));
  });

  it("handles invites while running and rejects malformed room metadata", async () => {
    const { steam, notify } = installBridge();
    render(<SteamInviteHandler />);
    await act(async () => {});
    steam.getPendingJoin.mockResolvedValue({ id: 1, gameId: "https://example.com" });
    await act(async () => notify());
    expect(push).not.toHaveBeenCalled();
    steam.getPendingJoin.mockResolvedValue({ id: 2, gameId: "DEF567" });
    await act(async () => notify());
    expect(push).toHaveBeenCalledWith("/game/DEF567");
  });

  it("reports expired native invites without navigating", async () => {
    const { steam } = installBridge();
    steam.getPendingJoin.mockResolvedValue({ id: 3, gameId: null });
    render(<SteamInviteHandler />);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("no longer available")),
    );
    expect(push).not.toHaveBeenCalled();
    expect(steam.acknowledgeJoin).toHaveBeenCalledWith(3);
  });
});
