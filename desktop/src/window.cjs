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
const CONTENT_SECURITY_POLICY = [
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

let cspApplied = false;

/**
 * Install a Content-Security-Policy response header on every request
 * served through the given session.  Idempotent — calling more than
 * once is a no-op so repeated `createMainWindow` calls (e.g. macOS
 * dock activate after window-all-closed) don't double-register.
 *
 * @param {Electron.Session} targetSession
 */
function applyCspHeader(targetSession) {
  if (cspApplied) return;
  cspApplied = true;
  targetSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [CONTENT_SECURITY_POLICY],
      },
    });
  });
}

/**
 * @param {{ startUrl: string; devTools: boolean }} options
 */
function createMainWindow({ startUrl, devTools }) {
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
    },
  });

  // Install the Content-Security-Policy header on this window's
  // session BEFORE the first navigation so the initial `app://tiao/en/`
  // load already runs under the policy.
  applyCspHeader(win.webContents.session);

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
