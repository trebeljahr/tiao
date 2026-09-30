const assert = require("node:assert/strict");
const { test } = require("node:test");
const { EventEmitter } = require("node:events");
const {
  createUrlPolicy,
  isSafeExternalUrl,
  registerTrustedContents,
  assertTrustedSender,
  installWindowTrust,
} = require("./trust.cjs");

test("exact app authority and explicitly configured development origin", () => {
  const bundled = createUrlPolicy("app://tiao/en/", true);
  for (const url of ["app://tiao/en/", "app://tiao/settings?q=1"]) assert.ok(bundled(url));
  for (const url of [
    "app://other/en/",
    "app://tiao:123/en/",
    "app://name@tiao/en/",
    "https://tiao/",
    "file:///tmp/a",
    "data:text/html,test",
  ])
    assert.equal(bundled(url), false);
  const dev = createUrlPolicy("http://127.0.0.1:54321/en/", false);
  assert.ok(dev("http://127.0.0.1:54321/settings"));
  assert.equal(dev("http://127.0.0.1:54322/"), false);
  assert.equal(dev("http://localhost:54321/"), false);
  assert.throws(() => createUrlPolicy("http://127.0.0.1:54321/", true));
});

test("privileged IPC requires the registered webContents and its current main frame", () => {
  const wc = /** @type {any} */ (
    Object.assign(new EventEmitter(), {
      mainFrame: { url: "app://tiao/en/" },
      isDestroyed: () => false,
    })
  );
  const event = /** @type {any} */ ({ sender: wc, senderFrame: wc.mainFrame });
  assert.throws(() => assertTrustedSender(event));
  registerTrustedContents(wc, createUrlPolicy("app://tiao/en/", true));
  assert.doesNotThrow(() => assertTrustedSender(event));
  assert.throws(() => assertTrustedSender({ ...event, senderFrame: { url: "app://tiao/en/" } }));
  assert.throws(() => assertTrustedSender({ ...event, senderFrame: null }));
  wc.mainFrame.url = "https://example.com/";
  assert.throws(() => assertTrustedSender(event));
  wc.emit("destroyed");
  wc.mainFrame.url = "app://tiao/en/";
  assert.throws(() => assertTrustedSender(event));
});

test("navigation, redirects, child frames and popup scheme controls", () => {
  const opened = /** @type {string[]} */ ([]),
    loaded = /** @type {string[]} */ ([]);
  let popup = /** @param {{url: string}} _details */ (_details) => ({ action: "unregistered" });
  const wc = /** @type {any} */ (
    Object.assign(new EventEmitter(), {
      mainFrame: { url: "app://tiao/en/" },
      isDestroyed: () => false,
      setWindowOpenHandler: /** @param {typeof popup} fn */ (fn) => {
        popup = fn;
      },
    })
  );
  installWindowTrust(
    /** @type {any} */ ({
      webContents: wc,
      loadURL: /** @param {string} url */ async (url) => {
        loaded.push(url);
      },
    }),
    {
      startUrl: "app://tiao/en/",
      isPackaged: true,
      openExternal: async (url) => opened.push(url),
    },
  );
  for (const kind of ["will-navigate", "will-redirect", "will-frame-navigate"]) {
    let blocked = false;
    wc.emit(kind, {
      url: "https://example.com/",
      isMainFrame: true,
      preventDefault() {
        blocked = true;
      },
    });
    assert.ok(blocked);
  }
  let blocked = false;
  wc.emit("will-frame-navigate", {
    url: "app://tiao/en/",
    isMainFrame: false,
    preventDefault() {
      blocked = true;
    },
  });
  assert.ok(blocked);
  for (const url of [
    "file:///tmp/test",
    "javascript:void(0)",
    "tiao://auth/complete",
    "steam://run/1",
    "data:text/plain,a",
    "app://other/",
  ]) {
    assert.equal(isSafeExternalUrl(url), false);
    assert.equal(popup({ url }).action, "deny");
  }
  assert.deepEqual(opened, []);
  assert.equal(popup({ url: "https://example.com/" }).action, "deny");
  assert.deepEqual(opened, ["https://example.com/"]);
  assert.equal(popup({ url: "app://tiao/settings" }).action, "deny");
  assert.deepEqual(loaded, ["app://tiao/settings"]);
});
