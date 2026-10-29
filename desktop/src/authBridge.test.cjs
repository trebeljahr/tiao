// @ts-check
const assert = require("node:assert/strict");
const { test } = require("node:test");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const trust = require("./trust.cjs");

/** @param {{ steam?: boolean; fetcher?: (url: string, init?: any) => Promise<any> }} options */
function harness({ steam = false, fetcher } = {}) {
  const handlers = /** @type {Map<string, Function>} */ (new Map());
  const wc = /** @type {any} */ (
    Object.assign(new EventEmitter(), {
      mainFrame: { url: "app://tiao/en/" },
      isDestroyed: () => false,
      send: () => {},
    })
  );
  trust.registerTrustedContents(wc, trust.createUrlPolicy("app://tiao/en/", true));
  const event = { sender: wc, senderFrame: wc.mainFrame };
  let stored = true,
    revoked = false,
    failLogout = false;
  const opened = /** @type {string[]} */ ([]);
  let credentialCalls = 0;
  let tokenReads = 0;
  let tokenWrites = 0;
  const events = /** @type {any[]} */ ([]);
  wc.send = (/** @type {string} */ channel, /** @type {any} */ payload) =>
    events.push({ channel, payload });
  const electron = {
    app: { getPath: () => "/fake-only" },
    ipcMain: {
      handle: /** @param {string} name @param {Function} handler */ (name, handler) =>
        handlers.set(name, handler),
    },
    shell: {
      openExternal: /** @param {string} url */ async (url) => {
        opened.push(url);
      },
    },
    safeStorage: {
      isEncryptionAvailable: () => {
        credentialCalls++;
        return true;
      },
      encryptString: () => {
        credentialCalls++;
        return Buffer.from("fake-encrypted");
      },
      decryptString: () => {
        credentialCalls++;
        return "fake-token";
      },
    },
    BrowserWindow: { getAllWindows: () => [{ webContents: wc }] },
  };
  const fakeFs = {
    existsSync: () => stored,
    readFileSync: () => {
      tokenReads++;
      return Buffer.from("fake-encrypted");
    },
    writeFileSync: () => {
      tokenWrites++;
      stored = true;
    },
    unlinkSync: () => {
      stored = false;
    },
  };
  const module = { exports: /** @type {any} */ ({}) };
  const sandbox = {
    module,
    console,
    Buffer,
    URL,
    AbortSignal,
    setTimeout,
    clearTimeout,
    require: /** @param {string} name */ (name) => {
      if (name === "electron") return electron;
      if (name === "node:fs") return fakeFs;
      if (name === "./trust.cjs") return trust;
      if (name === "./distribution.cjs")
        return { DISTRIBUTION_CHANNEL: steam ? "steam" : "direct" };
      if (name === "./config.cjs") return { resolveApiUrl: () => "https://example.invalid" };
      if (name === "./glitchtip.cjs") return { captureException: () => {} };
      if (name === "node:path" || name === "node:crypto") return require(name);
      throw new Error(`Unexpected import: ${name}`);
    },
    fetch: /** @param {string} url @param {any} init */ async (url, init) => {
      if (fetcher) return fetcher(url, init);
      if (url.endsWith("/logout")) {
        revoked = !failLogout;
        return { ok: !failLogout };
      }
      if (url.endsWith("/exchange"))
        return {
          ok: true,
          json: async () => ({
            sessionToken: "fake-new-token",
            userId: "fake-user",
            expiresAt: 123,
          }),
        };
      throw new Error("Unexpected request");
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "authBridge.cjs"), "utf8"), sandbox);
  module.exports.registerAuthIpc(
    steam
      ? {
          getTicket: async () => ({ ticket: "fake-native-ticket", cancel: () => {} }),
          appId: 5491870,
        }
      : null,
  );
  return {
    bridge: module.exports,
    event,
    opened,
    events,
    call: /** @param {string} name @param {unknown[]} args */ (name, ...args) =>
      handlers.get(name)?.(event, ...args),
    untrusted: /** @param {string} name */ (name) =>
      handlers.get(name)?.({ ...event, senderFrame: {} }),
    state: () => ({ stored, revoked, credentialCalls, tokenReads, tokenWrites }),
    failLogout: () => {
      failLogout = true;
    },
  };
}

test("auth IPC blocks other frames before touching mocked credentials", () => {
  const h = harness();
  for (const name of [
    "auth:cancelOAuth",
    "auth:confirmSteamLink",
    "auth:steam",
    "auth:login",
    "auth:getToken",
    "auth:logout",
    "auth:startOAuth",
    "auth:linkOAuth",
    "auth:getPersistenceStatus",
  ]) {
    assert.throws(() => h.untrusted(name), /Untrusted/);
  }
  assert.equal(h.state().credentialCalls, 0);
});

test("logout revokes remotely before deleting local token; failure remains retryable", async () => {
  const h = harness();
  h.bridge.loadPersistedToken();
  assert.equal(await h.call("auth:getToken"), "fake-token");
  await h.call("auth:logout");
  assert.equal(h.state().revoked, true);
  assert.equal(h.state().stored, false);
  assert.equal(await h.call("auth:getToken"), null);
  const failed = harness();
  failed.bridge.loadPersistedToken();
  failed.failLogout();
  await assert.rejects(failed.call("auth:logout"), /Could not revoke/);
  assert.equal(failed.state().stored, true);
  assert.equal(await failed.call("auth:getToken"), "fake-token");
});

test("ordinary system-browser OAuth callback still exchanges with mocked network/storage", async () => {
  const h = harness();
  await h.call("auth:startOAuth", "google");
  const state = new URL(h.opened[0]).searchParams.get("state");
  await h.bridge.handleAuthDeepLink(new URL(`tiao://auth/complete?state=${state}&code=fake-code`));
  assert.equal(await h.call("auth:getToken"), "fake-new-token");
  assert.equal(h.state().stored, true);
  assert.equal((await h.call("auth:startOAuth", "unknown")).reason, "bad_provider");
});

test("Steam sign-in keeps verified sessions in memory without accessing OS credentials", async () => {
  const calls = /** @type {any[]} */ ([]);
  const h = harness({
    steam: true,
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({ status: "signed_in", sessionToken: "steam-session" }),
      };
    },
  });
  h.bridge.loadPersistedToken();
  assert.equal(await h.call("auth:getToken"), null, "ignore legacy disk token");
  assert.equal(h.bridge.isPersistenceAvailable(), false);
  assert.equal((await h.call("auth:getPersistenceStatus")).available, true);
  await h.call("auth:steam", {
    action: "create",
    username: "player",
    ticket: "forged",
    appId: 480,
  });
  assert.equal(await h.call("auth:getToken"), "steam-session");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    action: "create",
    username: "player",
    ticket: "fake-native-ticket",
    appId: 5491870,
  });
  await h.call("auth:steam", { action: "link" });
  assert.equal(calls[1].init.headers.Authorization, "Bearer steam-session");
  assert.equal(h.state().credentialCalls, 0);
  assert.equal(h.state().tokenReads, 0);
  assert.equal(h.state().tokenWrites, 0);
  await h.call("auth:logout");
  assert.equal(await h.call("auth:getToken"), null);
  assert.equal(h.state().credentialCalls, 0);
  const relaunched = harness({ steam: true });
  relaunched.bridge.loadPersistedToken();
  assert.equal(await relaunched.call("auth:getToken"), null);
  assert.equal(relaunched.state().credentialCalls, 0);
});

test("an unlinked Steam player clears another player's current desktop identity", async () => {
  const h = harness({
    steam: true,
    fetcher: async (url) => ({
      ok: true,
      json: async () =>
        url.endsWith("/exchange") ? { sessionToken: "fake-token" } : { status: "needs_setup" },
    }),
  });
  await h.call("auth:startOAuth", "google");
  const state = new URL(h.opened[0]).searchParams.get("state");
  await h.bridge.handleAuthDeepLink(new URL(`tiao://auth/complete?state=${state}&code=fake-code`));
  assert.equal(await h.call("auth:getToken"), "fake-token");
  assert.equal((await h.call("auth:steam", { action: "check" })).status, "needs_setup");
  assert.equal(await h.call("auth:getToken"), null);
});

test("Steam link conflicts preserve the existing account and standalone builds do not fetch tickets", async () => {
  const h = harness({
    steam: true,
    fetcher: async (url) => ({
      ok: url.endsWith("/exchange"),
      json: async () =>
        url.endsWith("/exchange") ? { sessionToken: "fake-token" } : { message: "Already linked" },
    }),
  });
  await h.call("auth:startOAuth", "google");
  const state = new URL(h.opened[0]).searchParams.get("state");
  await h.bridge.handleAuthDeepLink(new URL(`tiao://auth/complete?state=${state}&code=fake-code`));
  await assert.rejects(h.call("auth:steam", { action: "link" }), /Already linked/);
  assert.equal(await h.call("auth:getToken"), "fake-token");
  assert.equal((await harness().call("auth:steam", { action: "check" })).status, "unavailable");
});

test("desktop password login exchanges the signed session and persists the revocable token", async () => {
  const calls = /** @type {any[]} */ ([]);
  const h = harness({
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return url.endsWith("/login")
        ? { ok: true, headers: new Map([["set-auth-token", "signed-ba-token"]]) }
        : { ok: true, json: async () => ({ sessionToken: "desktop-password-token" }) };
    },
  });
  await h.call("auth:login", "web-player", "fake-password");
  assert.equal(calls[1].init.headers.Authorization, "Bearer signed-ba-token");
  assert.equal(await h.call("auth:getToken"), "desktop-password-token");
});

test("Steam onboarding proves the native player before replacing a password login", async () => {
  const calls = /** @type {any[]} */ ([]);
  const h = harness({
    steam: true,
    fetcher: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/login"))
        return { ok: true, headers: new Map([["set-auth-token", "web-proof"]]) };
      if (url.endsWith("/desktop/session"))
        return { ok: true, json: async () => ({ sessionToken: "web-token" }) };
      if (url.endsWith("/me"))
        return {
          ok: true,
          json: async () => ({ player: { kind: "account", displayName: "existing-web-player" } }),
        };
      return {
        ok: true,
        json: async () => ({ status: "signed_in", sessionToken: "joined-token" }),
      };
    },
  });
  await h.call("auth:login", "existing-web-player", "fake-password", { linkSteam: true });
  assert.equal(await h.call("auth:getToken"), null, "web identity remains pending until confirmed");
  assert.equal(h.events[0].payload.displayName, "existing-web-player");
  await h.call("auth:confirmSteamLink");
  assert.equal(calls[3].init.headers.Authorization, "Bearer web-token");
  assert.deepEqual(JSON.parse(calls[3].init.body), {
    action: "link",
    ticket: "fake-native-ticket",
    appId: 5491870,
  });
  assert.equal(await h.call("auth:getToken"), "joined-token");
  assert.equal(h.state().credentialCalls, 0);
});

test("a failed join keeps the Steam session instead of adopting an unrelated web identity", async () => {
  let failed = false;
  const h = harness({
    steam: true,
    fetcher: async (url) => {
      if (url.endsWith("/login"))
        return { ok: true, headers: new Map([["set-auth-token", "web-proof"]]) };
      if (url.endsWith("/desktop/session"))
        return { ok: true, json: async () => ({ sessionToken: "web-token" }) };
      if (url.endsWith("/me"))
        return {
          ok: true,
          json: async () => ({ player: { kind: "account", displayName: "existing-web-player" } }),
        };
      return {
        ok: !failed,
        json: async () =>
          failed
            ? { message: "Finish your current game." }
            : { status: "signed_in", sessionToken: "steam-token" },
      };
    },
  });
  await h.call("auth:steam", { action: "check" });
  failed = true;
  await h.call("auth:login", "existing", "fake-password", { linkSteam: true });
  await assert.rejects(h.call("auth:confirmSteamLink"), /Finish your current game/);
  assert.equal(await h.call("auth:getToken"), "steam-token");
});

test("browser sign-in completes through secret polling when no deep link opens", async () => {
  const calls = /** @type {any[]} */ ([]);
  const h = harness({
    steam: true,
    fetcher: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/poll"))
        return { ok: true, status: 200, json: async () => ({ code: "once" }) };
      if (url.endsWith("/exchange"))
        return { ok: true, json: async () => ({ sessionToken: "web-token" }) };
      if (url.endsWith("/me"))
        return {
          ok: true,
          json: async () => ({ player: { kind: "account", displayName: "existing-web-player" } }),
        };
      return {
        ok: true,
        json: async () => ({ status: "signed_in", sessionToken: "joined-token" }),
      };
    },
  });
  await h.call("auth:startOAuth", "google", { linkSteam: true });
  await new Promise((resolve) => setTimeout(resolve, 2700));
  assert.equal(await h.call("auth:getToken"), null);
  assert.equal(h.events[0].payload.displayName, "existing-web-player");
  await h.call("auth:confirmSteamLink");
  assert.equal(await h.call("auth:getToken"), "joined-token");
  assert.equal(calls.length, 5);
  const poll = JSON.parse(calls[0].init.body),
    exchange = JSON.parse(calls[1].init.body);
  assert.equal(poll.code_verifier, exchange.code_verifier);
  const challenge = require("node:crypto")
    .createHash("sha256")
    .update(poll.code_verifier)
    .digest("base64url");
  assert.equal(new URL(h.opened[0]).searchParams.get("code_challenge"), challenge);
  assert.equal(h.opened[0].includes(poll.code_verifier), false);
  await h.bridge.handleAuthDeepLink(new URL(`tiao://auth/complete?state=${poll.state}&code=once`));
  assert.equal(calls.length, 5, "late browser redirect cannot exchange twice");
  assert.equal(h.events.filter((e) => e.channel === "auth:complete").length, 1);
});

test("cancelling browser sign-in stops polling and rejects late callbacks", async () => {
  const h = harness();
  await h.call("auth:startOAuth", "google");
  const state = new URL(h.opened[0]).searchParams.get("state");
  await h.call("auth:cancelOAuth");
  await h.bridge.handleAuthDeepLink(new URL(`tiao://auth/complete?state=${state}&code=once`));
  assert.equal(await h.call("auth:getToken"), null);
  assert.equal(h.events.length, 0);
});

test("Steam setup returns profile defaults without creating a renderer-chosen identity", async () => {
  const h = harness({
    steam: true,
    fetcher: async () => ({
      ok: true,
      json: async () => ({
        status: "needs_setup",
        profile: {
          displayName: "Mäia Jump!",
          suggestedUsername: "maia-jump",
          avatarUrl: "https://avatars.steamstatic.com/fake.jpg",
        },
      }),
    }),
  });
  const result = await h.call("auth:steam", { action: "check" });
  assert.equal(result.profile.displayName, "Mäia Jump!");
  assert.equal(result.profile.suggestedUsername, "maia-jump");
  assert.equal(await h.call("auth:getToken"), null);
});

test("standalone desktop Steam uses the system-browser OAuth exchange", async () => {
  const h = harness();
  assert.equal((await h.call("auth:startOAuth", "steam")).ok, true);
  const target = new URL(h.opened[0]);
  assert.equal(target.searchParams.get("provider"), "steam");
  await h.bridge.handleAuthDeepLink(
    new URL(`tiao://auth/complete?state=${target.searchParams.get("state")}&code=verified`),
  );
  assert.equal(await h.call("auth:getToken"), "fake-new-token");
});

test("desktop linking carries the app session only in the authorization header", async () => {
  const calls = /** @type {any[]} */ ([]);
  const h = harness({
    fetcher: async (url, init) => {
      calls.push({ url, init });
      const body = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          path: `/api/auth/desktop/link/begin?state=${body.state}&ticket=once`,
        }),
      };
    },
  });
  assert.equal((await h.call("auth:linkOAuth", "steam")).ok, false);
  h.bridge.loadPersistedToken();
  assert.equal((await h.call("auth:linkOAuth", "steam")).ok, true);
  assert.equal(calls[0].init.headers.Authorization, "Bearer fake-token");
  assert.equal(JSON.parse(calls[0].init.body).provider, "steam");
  assert.equal(h.opened[0].includes("fake-token"), false);
});

test("desktop linking rejects external begin URLs", async () => {
  const h = harness({
    fetcher: async () => ({
      ok: true,
      json: async () => ({ path: "https://attacker.invalid/api/auth/desktop/link/begin" }),
    }),
  });
  h.bridge.loadPersistedToken();
  assert.equal((await h.call("auth:linkOAuth", "apple")).ok, false);
  assert.equal(h.opened.length, 0);
});
