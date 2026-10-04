import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppleSignInButton } from "../../app/[locale]/AuthDialog";
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

describe("AppleSignInButton", () => {
  it("renders Apple's button title and calls back on click", () => {
    const onClick = vi.fn();
    render(<AppleSignInButton onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Continue with Apple" });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
