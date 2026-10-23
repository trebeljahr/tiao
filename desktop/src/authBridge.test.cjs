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
      encryptString: () => Buffer.from("fake-encrypted"),
      decryptString: () => "fake-token",
    },
    BrowserWindow: { getAllWindows: () => [{ webContents: wc }] },
  };
  const fakeFs = {
    existsSync: () => stored,
    readFileSync: () => Buffer.from("fake-encrypted"),
    writeFileSync: () => {
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
    require: /** @param {string} name */ (name) => {
      if (name === "electron") return electron;
      if (name === "node:fs") return fakeFs;
      if (name === "./trust.cjs") return trust;
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
    call: /** @param {string} name @param {unknown[]} args */ (name, ...args) =>
      handlers.get(name)?.(event, ...args),
    untrusted: /** @param {string} name */ (name) =>
      handlers.get(name)?.({ ...event, senderFrame: {} }),
    state: () => ({ stored, revoked, credentialCalls }),
    failLogout: () => {
      failLogout = true;
    },
  };
}

test("auth IPC blocks other frames before touching mocked credentials", () => {
  const h = harness();
  for (const name of [
    "auth:steam",
    "auth:login",
    "auth:getToken",
    "auth:logout",
    "auth:startOAuth",
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

test("Steam sign-in gets the ticket and demo AppID from main and persists only verified sessions", async () => {
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
});

test("an unlinked Steam player clears another player's saved desktop identity", async () => {
  const h = harness({
    steam: true,
    fetcher: async () => ({ ok: true, json: async () => ({ status: "needs_setup" }) }),
  });
  h.bridge.loadPersistedToken();
  assert.equal(await h.call("auth:getToken"), "fake-token");
  assert.equal((await h.call("auth:steam", { action: "check" })).status, "needs_setup");
  assert.equal(await h.call("auth:getToken"), null);
});

test("Steam link conflicts preserve the existing account and standalone builds do not fetch tickets", async () => {
  const h = harness({
    steam: true,
    fetcher: async () => ({ ok: false, json: async () => ({ message: "Already linked" }) }),
  });
  h.bridge.loadPersistedToken();
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
