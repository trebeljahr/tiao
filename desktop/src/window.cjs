// @ts-check
/**
 * BrowserWindow factory with hardened webPreferences.
 *
 * Security posture notes:
 *   - `contextIsolation: true` keeps the preload script's globals
 *     separate from the renderer's global scope.  Without this, a
 *     future XSS in the bundled client could reach into our
 *     Node-privileged APIs.
 *   - `nodeIntegration: false` removes `require` from the renderer.
 *   - `sandbox: true` runs the renderer in an OS-level sandbox.
 *   - `webSecurity: true` enforces same-origin policy.
 *   - `allowRunningInsecureContent: false` blocks mixed content.
 *
 * These are all modern Electron defaults but being explicit is
 * cheap insurance — a future Electron version could flip a default,
 * and the XSS → RCE gap is the single scariest failure mode for
 * a desktop wrapper.
 *
 * CSP policies + the pure selector that chooses between them live
 * in `./csp.cjs` so they can be unit-tested without spinning up an
 * Electron main process.
 */

const { BrowserWindow, app } = require("electron");
const path = require("node:path");
const {
  PROD_CONTENT_SECURITY_POLICY,
  DEV_CONTENT_SECURITY_POLICY,
  selectCspPolicy,
} = require("./csp.cjs");

let cspApplied = false;

/**
 * Install a Content-Security-Policy response header on every request
 * served through the given session.  Idempotent — calling more than
 * once is a no-op so repeated `createMainWindow` calls (e.g. macOS
 * dock activate after window-all-closed) don't double-register.
 *
 * Both startUrl and the runtime apiUrl factor into the policy choice:
 * HMR mode (http:// start) and unpackaged dev:desktop mode (app://
 * start + http://localhost backend) both need the relaxed policy.
 * See `./csp.cjs` for the full decision tree.
 *
 * @param {Electron.Session} targetSession
 * @param {{ startUrl: string; apiUrl: string }} opts
 */
function applyCspHeader(targetSession, { startUrl, apiUrl }) {
  if (cspApplied) return;
  cspApplied = true;
  const policy = selectCspPolicy({
    startUrl,
    apiUrl,
    isPackaged: app.isPackaged,
  });
  targetSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [policy],
      },
    });
  });
}

/**
 * Serialize a runtime config object into --key=value args that the
 * preload can parse out of `process.argv`.
 *
 * Electron's `webPreferences.additionalArguments` is the sanctioned
 * way to pass data from main to a sandboxed preload (ENV vars don't
 * cross the sandbox boundary reliably).  Values become entries in
 * `process.argv` during renderer startup.  We use a flat `--tiao-*=`
 * prefix to keep the preload parser simple and to avoid collisions
 * with Chromium's own CLI flags.
 *
 * @param {{ apiUrl: string }} runtimeConfig
 * @returns {string[]}
 */
function buildAdditionalArguments(runtimeConfig) {
  return [`--tiao-api-url=${runtimeConfig.apiUrl}`];
}

/**
 * @param {{
 *   startUrl: string;
 *   devTools: boolean;
 *   runtimeConfig: { apiUrl: string };
 * }} options
 */
function createMainWindow({ startUrl, devTools, runtimeConfig }) {
  const iconPath = path.join(__dirname, "..", "assets", "icon.png");

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "Tiao",
    icon: iconPath,
    backgroundColor: "#1a0f06",
    show: false, // wait until content is ready to avoid a white flash
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools,
      // Inject runtime config into the sandboxed preload via
      // process.argv.  The preload reads these back with a plain
      // string match on `--tiao-api-url=` and exposes them on
      // `window.electron.config`.  See desktop/preload.cjs.
      additionalArguments: buildAdditionalArguments(runtimeConfig),
    },
  });

  // Install the Content-Security-Policy header on this window's
  // session BEFORE the first navigation so the initial `app://tiao/en/`
  // load already runs under the policy.
  applyCspHeader(win.webContents.session, {
    startUrl,
    apiUrl: runtimeConfig.apiUrl,
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  void win.loadURL(startUrl);

  if (devTools) {
    // Open dev tools in a detached panel so it doesn't take up half
    // the game window at small sizes.
    win.webContents.openDevTools({ mode: "detach" });
  }

  return win;
}

module.exports = {
  createMainWindow,
  // Re-exported for backwards compatibility with any caller that
  // reached into window.cjs for the constants; new code should
  // import from ./csp.cjs directly.
  PROD_CONTENT_SECURITY_POLICY,
  DEV_CONTENT_SECURITY_POLICY,
};
