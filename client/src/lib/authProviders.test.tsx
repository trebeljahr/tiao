import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OAuthButtons } from "../../app/[locale]/AuthDialog";

const mocks = vi.hoisted(() => ({
  oauth: vi.fn(),
  steam: vi.fn(),
  desktop: null as unknown,
  native: false,
  steamBuild: false,
}));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ handleOAuthSignIn: mocks.oauth }) }));
vi.mock("@/lib/desktopAuth", () => ({ desktopAuthBridge: () => mocks.desktop }));
vi.mock("@/lib/mobileAuth", () => ({ isNativeMobileApp: () => mocks.native }));
vi.mock("@/lib/SteamBridge", () => ({ isSteamBuild: () => mocks.steamBuild }));
vi.mock("@/lib/steamWebAuth", () => ({ startSteamWebSignIn: mocks.steam }));

import {
  _resetSocialProvidersCacheForTests,
  fetchEnabledSocialProviders,
  useAppleSignInEnabled,
} from "./authProviders";

function mockProviders(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  _resetSocialProvidersCacheForTests();
});

describe("fetchEnabledSocialProviders", () => {
  it("returns known providers from the server and caches them", async () => {
    const fetchMock = mockProviders({ providers: ["apple", "google", "myspace"] });
    expect(await fetchEnabledSocialProviders()).toEqual(["apple", "google"]);
    expect(await fetchEnabledSocialProviders()).toEqual(["apple", "google"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/auth-providers$/);
  });

  it("resolves null when the server errors", async () => {
    mockProviders({}, false);
    expect(await fetchEnabledSocialProviders()).toBeNull();
  });

  it("resolves null and retries later when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await fetchEnabledSocialProviders()).toBeNull();
    mockProviders({ providers: ["apple"] });
    expect(await fetchEnabledSocialProviders()).toEqual(["apple"]);
  });
});

describe("useAppleSignInEnabled", () => {
  it("is true only once the server lists apple", async () => {
    mockProviders({ providers: ["apple"] });
    const { result } = renderHook(() => useAppleSignInEnabled());
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("stays false when Apple is not configured", async () => {
    const fetchMock = mockProviders({ providers: ["google"] });
    const { result } = renderHook(() => useAppleSignInEnabled());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await Promise.resolve();
    expect(result.current).toBe(false);
  });
});

describe("sign-in provider choices", () => {
  it("shows Apple beside the other providers with matching buttons", async () => {
    mockProviders({ providers: ["apple"] });
    render(<OAuthButtons />);
    const apple = await screen.findByRole("button", { name: "Apple" });
    const github = screen.getByRole("button", { name: "GitHub" });
    expect(apple.className).toBe(github.className);
    expect(apple.parentElement).toBe(github.parentElement);
    fireEvent.click(apple);
    expect(mocks.oauth).toHaveBeenCalledWith("apple");
    fireEvent.click(screen.getByRole("button", { name: "Steam" }));
    expect(mocks.steam).toHaveBeenCalled();
  });

  it("offers Steam in standalone desktop builds and uses the native bridge", async () => {
    mockProviders({ providers: ["apple"] });
    const startOAuth = vi.fn().mockResolvedValue({ ok: true });
    mocks.desktop = { startOAuth };
    render(<OAuthButtons />);
    fireEvent.click(screen.getByRole("button", { name: "Steam" }));
    await waitFor(() => expect(startOAuth).toHaveBeenCalledWith("steam"));
    mocks.desktop = null;
  });
});
