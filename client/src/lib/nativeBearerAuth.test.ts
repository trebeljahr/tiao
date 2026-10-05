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

import {
  authFetchCredentials,
  captureIssuedAuthToken,
  getCachedElectronToken,
  setElectronTokenCache,
} from "./api";
import { nativeBearerFetchOptions } from "./auth-client";
import { completeMobileOAuth, parseAuthDeepLink, startMobileLinkSocial } from "./mobileAuth";

function setNative(native: boolean) {
  if (!native) {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    return;
  }
  (window as unknown as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => "ios",
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  store.clear();
  browserOpen.mockReset();
  browserClose.mockReset();
  setElectronTokenCache(null);
  setNative(true);
});

afterEach(() => {
  setNative(false);
  vi.unstubAllGlobals();
});

describe("issued session tokens", () => {
  it("adopts and persists set-auth-token on native", async () => {
    captureIssuedAuthToken(new Headers({ "set-auth-token": "guest.sig" }));
    expect(getCachedElectronToken()).toBe("guest.sig");
    await flush();
    expect(store.get("tiao.mobileAuth.sessionToken")).toBe("guest.sig");
  });

  it("ignores the header on the web", async () => {
    setNative(false);
    captureIssuedAuthToken(new Headers({ "set-auth-token": "web.sig" }));
    expect(getCachedElectronToken()).toBeNull();
    await flush();
    expect(store.size).toBe(0);
  });

  it("omits cookies on native and keeps them on the web", () => {
    expect(authFetchCredentials()).toBe("omit");
    setNative(false);
    expect(authFetchCredentials()).toBe("include");
  });

  it("the better-auth client sends the bearer token and captures new ones", async () => {
    const options = nativeBearerFetchOptions();
    expect(options.credentials).toBe("omit");
    expect(options.auth.token()).toBeUndefined();
    setElectronTokenCache("current.sig");
    expect(options.auth.token()).toBe("current.sig");

    options.onSuccess({
      response: new Response("{}", { headers: { "set-auth-token": "next.sig" } }),
    });
    expect(getCachedElectronToken()).toBe("next.sig");
  });
});

describe("native account linking", () => {
  it("parses the linked deep link", () => {
    expect(parseAuthDeepLink("tiao://auth/linked?state=s")).toEqual({ kind: "linked", state: "s" });
  });

  it("refuses to start without a session", async () => {
    const fetchImpl = vi.fn();
    await expect(
      startMobileLinkSocial("google", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("starts with the bearer token and opens the ticket URL in the system browser", async () => {
    setElectronTokenCache("account.sig");
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ path: "/api/auth/mobile/link/begin?state=s&ticket=t" }),
    });
    await startMobileLinkSocial("github", fetchImpl as unknown as typeof fetch);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/\/api\/auth\/mobile\/link\/start$/);
    expect(init.headers.Authorization).toBe("Bearer account.sig");
    expect(init.credentials).toBe("omit");
    const body = JSON.parse(init.body);
    expect(body.provider).toBe("github");

    const opened = browserOpen.mock.calls[0][0].url as string;
    expect(opened).toMatch(/\/api\/auth\/mobile\/link\/begin\?state=s&ticket=t$/);
    expect(opened).not.toContain("account.sig");

    const pending = JSON.parse(store.get("tiao.mobileAuth.pending") ?? "{}");
    expect(pending.purpose).toBe("link");
    expect(pending.state).toBe(body.state);

    expect(await completeMobileOAuth(`tiao://auth/linked?state=${body.state}`)).toEqual({
      ok: true,
      purpose: "link",
      provider: "github",
    });
    // One shot.
    expect(await completeMobileOAuth(`tiao://auth/linked?state=${body.state}`)).toMatchObject({
      ok: false,
      reason: "state_mismatch",
    });
  });

  it("surfaces the server's refusal", async () => {
    setElectronTokenCache("account.sig");
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ code: "SOCIAL_ACCOUNT_ALREADY_LINKED", message: "Already linked." }),
    });
    await expect(
      startMobileLinkSocial("google", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow("Already linked.");
    expect(browserOpen).not.toHaveBeenCalled();
  });

  it("reports link errors and never exchanges a code for a link flow", async () => {
    setElectronTokenCache("account.sig");
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ path: "/api/auth/mobile/link/begin?state=s&ticket=t" }),
    });
    await startMobileLinkSocial("discord", fetchImpl as unknown as typeof fetch);
    const { state } = JSON.parse(fetchImpl.mock.calls[0][1].body);
    const exchange = vi.fn();
    expect(
      await completeMobileOAuth(
        `tiao://auth/complete?state=${state}&code=c`,
        exchange as unknown as typeof fetch,
      ),
    ).toEqual({ ok: false, purpose: "link", reason: "malformed_callback" });
    expect(exchange).not.toHaveBeenCalled();

    await startMobileLinkSocial("discord", fetchImpl as unknown as typeof fetch);
    const second = JSON.parse(fetchImpl.mock.calls[1][1].body).state;
    expect(
      await completeMobileOAuth(
        `tiao://auth/error?state=${second}&reason=account_already_linked_to_different_user`,
      ),
    ).toEqual({
      ok: false,
      purpose: "link",
      reason: "account_already_linked_to_different_user",
    });
  });
});
