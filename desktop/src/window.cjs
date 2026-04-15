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
 */

const { BrowserWindow } = require("electron");
const path = require("node:path");

/**
 * Content Security Policy for the bundled renderer.
 *
 * The renderer is a Next.js static export served via the `app://tiao/`
 * privileged protocol.  It needs to:
 *   - Load JS / CSS / fonts / images from itself (`'self'` and `app:`)
 *   - Emit Next.js inline hydration scripts (forces 'unsafe-inline'
 *     under script-src — there is no nonce mechanism in a static
 *     export)
 *   - XHR / fetch / WebSocket to any HTTPS / WSS endpoint (Tiao API,
 *     OpenPanel ingest)
 *   - Render images from arbitrary HTTPS origins (avatar URLs)
 *
 * The CSP cannot fully lock down the renderer because of the inline
 * script requirement.  Its real value is a) blocking script loads
 * from non-`app://` origins (CDN supply-chain attacks), b) enforcing
 * HTTPS / WSS for all network connections, and c) blocking `<object>`,
 * `<embed>`, and `<iframe>` outright.  The contextIsolation + sandbox
 * + nodeIntegration:false combination in `webPreferences` below is
 * the actual XSS-to-RCE barrier; CSP is defense in depth on top.
 *
 * Tighten by removing `'unsafe-inline'` from script-src when Next.js
 * gains stable nonce support for static exports.  Add `'unsafe-eval'`
 * here if the app ever pulls in a library that uses it (none today).
 */
const PROD_CONTENT_SECURITY_POLICY = [
  "default-src 'self' app:",
  "script-src 'self' app: 'unsafe-inline'",
  "style-src 'self' app: 'unsafe-inline'",
  "img-src 'self' app: data: blob: https:",
  "font-src 'self' app: data:",
  "connect-src 'self' app: https: wss:",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'self' app: blob:",
  "base-uri 'self'",
  "form-action 'self' app:",
].join("; ");

/**
 * Relaxed CSP for HMR dev mode.
 *
 * When the window loads from a `next dev` server (http://localhost:*),
 * Next.js opens an HMR websocket on ws://localhost:*, pulls hot-reload
 * modules via http://, and the React DevTools can make cross-origin
 * fetches.  The production CSP's `connect-src https: wss:` blocks all
 * of that.
 *
 * The dev CSP additionally permits `http:` and `ws:` schemes.  Scripts
 * and styles also need `'unsafe-eval'` because React refresh and
 * Next.js's webpack runtime use eval in dev mode (they don't in the
 * static export).  Not a security concern — HMR mode is opt-in and
 * localhost-only.
 */
const DEV_CONTENT_SECURITY_POLICY = [
  "default-src 'self' app: http: https:",
  "script-src 'self' app: 'unsafe-inline' 'unsafe-eval' http: https:",
  "style-src 'self' app: 'unsafe-inline' http: https:",
  "img-src 'self' app: data: blob: http: https:",
  "font-src 'self' app: data: http: https:",
  "connect-src 'self' app: http: https: ws: wss:",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'self' app: blob:",
  "base-uri 'self'",
  "form-action 'self' app: http: https:",
].join("; ");

let cspApplied = false;

/**
 * Install a Content-Security-Policy response header on every request
 * served through the given session.  Idempotent — calling more than
 * once is a no-op so repeated `createMainWindow` calls (e.g. macOS
 * dock activate after window-all-closed) don't double-register.
 *
 * @param {Electron.Session} targetSession
 * @param {string} startUrl — used to pick prod vs dev policy
 */
function applyCspHeader(targetSession, startUrl) {
  if (cspApplied) return;
  cspApplied = true;
  // HMR dev mode = the renderer loads from http:// (localhost).
  // The production path uses app:// and gets the strict policy.
  const isHmr = /^https?:\/\//i.test(startUrl);
  const policy = isHmr ? DEV_CONTENT_SECURITY_POLICY : PROD_CONTENT_SECURITY_POLICY;
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
  // load already runs under the policy.  The startUrl determines
  // whether we use the strict prod CSP (for app://) or the relaxed
  // dev CSP (for http://localhost HMR).
  applyCspHeader(win.webContents.session, startUrl);

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

module.exports = { createMainWindow };
