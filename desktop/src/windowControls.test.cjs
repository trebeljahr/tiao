// @ts-check
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");
const { EventEmitter } = require("node:events");
const { registerTrustedContents } = require("./trust.cjs");

function setup() {
  const handlers = new Map();
  const sent = /** @type {any[][]} */ ([]);
  let fullScreen = true;
  let quit = false;
  const wc = Object.assign(new EventEmitter(), {
    mainFrame: { url: "app://tiao/en/" },
    isDestroyed: () => false,
    send: (/** @type {any[]} */ ...args) => sent.push(args),
  });
  const win = Object.assign(new EventEmitter(), {
    webContents: wc,
    isFullScreen: () => fullScreen,
    setFullScreen: (/** @type {boolean} */ enabled) => {
      fullScreen = enabled;
    },
  });
  const mod = { exports: /** @type {any} */ ({}) };
  runInNewContext(readFileSync(require.resolve("./windowControls.cjs"), "utf8"), {
    module: mod,
    require: (/** @type {string} */ id) =>
      id === "electron"
        ? {
            app: {
              quit: () => {
                quit = true;
              },
            },
            BrowserWindow: {
              fromWebContents: (/** @type {unknown} */ contents) => (contents === wc ? win : null),
            },
          }
        : require(id),
  });
  mod.exports.registerWindowControlsIpc({
    handle: (/** @type {string} */ channel, /** @type {Function} */ fn) =>
      handlers.set(channel, fn),
  });
  mod.exports.installFullScreenEvents(win);
  registerTrustedContents(/** @type {any} */ (wc), (url) => url.startsWith("app://tiao/"));
  const event = { sender: wc, senderFrame: wc.mainFrame };
  return { handlers, event, win, wc, sent, didQuit: () => quit };
}

test("fullscreen IPC controls its sender's window, validates input, and broadcasts native changes", () => {
  const { handlers, event, win, sent } = setup();
  assert.equal(handlers.get("window:isFullScreen")(event), true);
  assert.throws(() => handlers.get("window:setFullScreen")(event, "false"));
  handlers.get("window:setFullScreen")(event, false);
  win.emit("leave-full-screen");
  assert.equal(handlers.get("window:isFullScreen")(event), false);
  handlers.get("window:setFullScreen")(event, true);
  win.emit("enter-full-screen");
  assert.deepEqual(sent, [
    ["window:fullScreenChanged", false],
    ["window:fullScreenChanged", true],
  ]);
});

test("quit uses the normal app shutdown path", () => {
  const { handlers, event, didQuit } = setup();
  handlers.get("window:quit")(event);
  assert.equal(didQuit(), true);
});

test("all window controls reject untrusted frames before changing the app", () => {
  const { handlers, event, wc, didQuit } = setup();
  wc.mainFrame.url = "https://example.com/";
  for (const handler of handlers.values()) assert.throws(() => handler(event, false), /Untrusted/);
  assert.equal(didQuit(), false);
});
