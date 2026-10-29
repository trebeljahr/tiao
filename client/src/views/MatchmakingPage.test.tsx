import type { AuthResponse } from "@shared";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MatchmakingPage } from "./MatchmakingPage";

const mocks = vi.hoisted(() => ({
  auth: null as AuthResponse | null,
  openAuth: vi.fn(),
  push: vi.fn(),
  enter: vi.fn(),
  cancel: vi.fn(),
  reconnect: vi.fn(),
  state: {} as Record<string, unknown>,
}));
vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ auth: mocks.auth, authLoading: false, onOpenAuth: mocks.openAuth }),
}));
vi.mock("@/lib/hooks/useMatchmakingData", () => ({
  useMatchmakingData: () => ({
    ...mocks.state,
    handleEnterMatchmaking: mocks.enter,
    handleCancelMatchmaking: mocks.cancel,
    reconnect: mocks.reconnect,
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/Navbar", () => ({ Navbar: () => null }));
vi.mock("next-intl", async (importOriginal) => {
  const intl = await importOriginal<typeof import("next-intl")>();
  const { default: messages } = await import("../../messages/en.json");
  const t = intl.createTranslator({ locale: "en", messages, namespace: "matchmaking" });
  return { ...intl, useTranslations: () => t };
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem("tiao:knowsHowToPlay", "1");
  mocks.auth = null;
  mocks.enter.mockResolvedValue(undefined);
  mocks.cancel.mockResolvedValue(undefined);
  mocks.state = {
    matchmaking: { status: "idle" },
    matchmakingBusy: false,
    connectionStatus: "connecting",
  };
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

it("replaces the endless spinner with sign-in when Steam has no verified session", () => {
  render(<MatchmakingPage />);
  expect(screen.getByText("Sign in to find an opponent online.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(mocks.openAuth).toHaveBeenCalledWith("login");
  expect(mocks.enter).not.toHaveBeenCalled();
  expect(screen.queryByText("Connecting to matchmaking…")).not.toBeInTheDocument();
});

it("allows cancellation before the server acknowledges the search", async () => {
  mocks.auth = { player: { playerId: "steam-player", displayName: "Player", kind: "account" } };
  mocks.state.matchmakingBusy = true;
  render(<MatchmakingPage />);
  expect(screen.getByRole("status")).toHaveTextContent("Connecting to matchmaking…");
  const cancel = screen.getByRole("button", { name: "Cancel Search" });
  expect(cancel).toBeEnabled();
  await act(async () => fireEvent.click(cancel));
  expect(mocks.cancel).toHaveBeenCalled();
  expect(mocks.push).toHaveBeenCalledWith("/play");
});

it("shows queue counts and elapsed wait without promising an arrival time", () => {
  vi.useFakeTimers();
  mocks.auth = { player: { playerId: "steam-player", displayName: "Player", kind: "account" } };
  mocks.state = {
    matchmaking: { status: "searching", queuedAt: new Date(Date.now() - 65_000).toISOString() },
    connectionStatus: "open",
    queue: { otherPlayers: 0, sameTimeControl: 0 },
  };
  render(<MatchmakingPage />);
  expect(screen.getByText("No other players searching")).toBeVisible();
  expect(screen.getByText("Waiting for another player to join. Wait time unknown.")).toBeVisible();
  expect(screen.getByText("Waiting 1:05")).toBeVisible();
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByText("Waiting 1:06")).toBeVisible();
});

it("retries a stalled connection and keeps cancellation available", async () => {
  mocks.auth = { player: { playerId: "steam-player", displayName: "Player", kind: "account" } };
  mocks.state.matchmakingBusy = true;
  mocks.state.responseTimedOut = true;
  render(<MatchmakingPage />);
  expect(screen.getByRole("alert")).toHaveTextContent("Could not connect to matchmaking.");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
  expect(mocks.reconnect).toHaveBeenCalledOnce();
  expect(mocks.enter).toHaveBeenCalledWith(null);
  expect(screen.getByRole("button", { name: "Cancel Search" })).toBeEnabled();
});
