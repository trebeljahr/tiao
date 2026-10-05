import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
const browserOpen = vi.fn();
const browserClose = vi.fn();

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: store.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      store.set(key, value);
    },
    remove: async ({ key }: { key: string }) => {
      store.delete(key);
    },
  },
}));
vi.mock("@capacitor/browser", () => ({
  Browser: { open: browserOpen, close: browserClose },
}));
vi.mock("@capacitor/app", () => ({ App: {} }));

import { getCachedElectronToken, setElectronTokenCache } from "./api";
import {
  buildStartUrl,
  codeChallengeFor,
  completeMobileOAuth,
  isNativeMobileApp,
  loadPersistedMobileToken,
  logoutMobile,
  parseAuthDeepLink,
  startMobileOAuth,
} from "./mobileAuth";

function setNative(platform: "ios" | "android" | null) {
  if (platform === null) {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    return;
  }
  (window as unknown as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => platform,
  };
}

function pendingFromStart(): { state: string; verifier: string; challenge: string } {
  const url = new URL(browserOpen.mock.calls.at(-1)?.[0].url);
  const pending = JSON.parse(store.get("tiao.mobileAuth.pending") ?? "{}");
  return {
    state: url.searchParams.get("state") ?? "",
    verifier: pending.verifier,
    challenge: url.searchParams.get("code_challenge") ?? "",
  };
}

beforeEach(() => {
  store.clear();
  browserOpen.mockReset();
  browserClose.mockReset();
  setElectronTokenCache(null);
  setNative("ios");
});

afterEach(() => {
  setNative(null);
  vi.unstubAllGlobals();
});

describe("parseAuthDeepLink", () => {
  it("parses complete and error callbacks", () => {
    expect(parseAuthDeepLink("tiao://auth/complete?state=s&code=c")).toEqual({
      kind: "complete",
      state: "s",
      code: "c",
    });
    expect(parseAuthDeepLink("tiao://auth/error?state=s&reason=no_session")).toEqual({
      kind: "error",
      state: "s",
      reason: "no_session",
    });
  });

  it("ignores other schemes and paths", () => {
    expect(parseAuthDeepLink("https://playtiao.com/auth/complete?state=s")).toBeNull();
    expect(parseAuthDeepLink("tiao://game/abc")).toBeNull();
    expect(parseAuthDeepLink("tiao://user:pw@auth/complete")).toBeNull();
    expect(parseAuthDeepLink("not a url")).toBeNull();
  });
});

describe("PKCE", () => {
  it("computes BASE64URL(SHA-256(verifier)) like the server does", async () => {
    const verifier = "a-verifier_with.unreserved~chars-0123456789";
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(await codeChallengeFor(verifier)).toBe(expected);
    expect(expected).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("builds the start URL with an S256 challenge", () => {
    const url = new URL(buildStartUrl("https://api.example.com", "google", "st", "ch"));
    expect(url.pathname).toBe("/api/auth/desktop/start");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      provider: "google",
      state: "st",
      code_challenge: "ch",
      code_challenge_method: "S256",
    });
  });
});

describe("mobile OAuth flow", () => {
  it("is inactive outside the native shell", async () => {
    setNative(null);
    expect(isNativeMobileApp()).toBe(false);
    expect(await loadPersistedMobileToken()).toBeNull();
  });

  it("opens the system browser with a challenge that matches the stored verifier", async () => {
    await startMobileOAuth("apple");
    expect(browserOpen).toHaveBeenCalledOnce();
    const { state, verifier, challenge } = pendingFromStart();
    expect(state).not.toBe("");
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await codeChallengeFor(verifier)).toBe(challenge);
    // The verifier itself never goes to the browser.
    expect(browserOpen.mock.calls[0][0].url).not.toContain(verifier);
  });

  it("exchanges the code with the verifier and persists the token", async () => {
    await startMobileOAuth("google");
    const { state, verifier } = pendingFromStart();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sessionToken: "tok-1", userId: "u1", expiresAt: 123 }),
    });

    const result = await completeMobileOAuth(
      `tiao://auth/complete?state=${state}&code=abc`,
      fetchImpl as unknown as typeof fetch,
    );

    expect(result).toEqual({ ok: true, sessionToken: "tok-1", userId: "u1", expiresAt: 123 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/\/api\/auth\/desktop\/exchange$/);
    expect(JSON.parse(init.body)).toEqual({ state, code: "abc", code_verifier: verifier });
    expect(init.credentials).toBe("omit");
    expect(getCachedElectronToken()).toBe("tok-1");
    expect(store.get("tiao.mobileAuth.sessionToken")).toBe("tok-1");
    expect(store.has("tiao.mobileAuth.pending")).toBe(false);
    expect(browserClose).toHaveBeenCalled();

    setElectronTokenCache(null);
    expect(await loadPersistedMobileToken()).toBe("tok-1");
    expect(getCachedElectronToken()).toBe("tok-1");
  });

  it("rejects a callback whose state the app did not start", async () => {
    await startMobileOAuth("google");
    const fetchImpl = vi.fn();
    const result = await completeMobileOAuth(
      "tiao://auth/complete?state=forged&code=abc",
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toEqual({ ok: false, reason: "state_mismatch" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("cannot replay a completed state", async () => {
    await startMobileOAuth("google");
    const { state } = pendingFromStart();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sessionToken: "tok", userId: "u", expiresAt: 1 }),
    });
    const link = `tiao://auth/complete?state=${state}&code=abc`;
    await completeMobileOAuth(link, fetchImpl as unknown as typeof fetch);
    expect(await completeMobileOAuth(link, fetchImpl as unknown as typeof fetch)).toEqual({
      ok: false,
      reason: "state_mismatch",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("surfaces server-side errors and failed exchanges", async () => {
    await startMobileOAuth("discord");
    let { state } = pendingFromStart();
    expect(await completeMobileOAuth(`tiao://auth/error?state=${state}&reason=no_session`)).toEqual(
      { ok: false, reason: "no_session" },
    );

    await startMobileOAuth("discord");
    ({ state } = pendingFromStart());
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(
      await completeMobileOAuth(
        `tiao://auth/complete?state=${state}&code=abc`,
        fetchImpl as unknown as typeof fetch,
      ),
    ).toEqual({ ok: false, reason: "exchange_failed" });
    expect(getCachedElectronToken()).toBeNull();
  });

  it("passes unrelated deep links through", async () => {
    expect(await completeMobileOAuth("tiao://game/abc")).toBeNull();
  });

  it("revokes the session on logout before forgetting the token", async () => {
    store.set("tiao.mobileAuth.sessionToken", "tok-out");
    setElectronTokenCache("tok-out");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await logoutMobile();

    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/auth\/desktop\/logout$/);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ sessionToken: "tok-out" });
    expect(store.has("tiao.mobileAuth.sessionToken")).toBe(false);
    expect(getCachedElectronToken()).toBeNull();
  });

  it("keeps the token when the server cannot revoke it", async () => {
    store.set("tiao.mobileAuth.sessionToken", "tok-keep");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(logoutMobile()).rejects.toThrow();
    expect(store.get("tiao.mobileAuth.sessionToken")).toBe("tok-keep");
  });
});
