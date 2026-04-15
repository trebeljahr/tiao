// @ts-check
/**
 * Electron main process entry point for the Tiao desktop app (Phase 3a).
 *
 * Responsibilities in this commit:
 *
 *   - Register the custom `app://tiao/` privileged protocol BEFORE
 *     `app.whenReady()` — privileged registration must happen early
 *     or Chromium locks in the protocol table without our scheme.
 *   - Spawn the main BrowserWindow pointing at `app://tiao/en/` with
 *     hardened webPreferences (contextIsolation, sandbox, webSecurity).
 *   - Show a native error page when `did-fail-load` fires (rare, means
 *     the bundled client-bundle/ directory is corrupted — offline is
 *     NOT an error here, because the bundle lives on disk).
 *   - Apply the native application menu (Edit / View / Window / Help).
 *
 * Deep-link handling, auth bridge, safeStorage persistence, and
 * electron-updater all land in commits 9+.
 */

const { app, BrowserWindow, Menu, shell, protocol, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const { registerAppProtocol, DESKTOP_PROTOCOL_SCHEME } = require("./src/protocol.cjs");
const { createMainWindow } = require("./src/window.cjs");
const { buildMenu } = require("./src/menu.cjs");
const {
  registerAuthIpc,
  loadPersistedToken,
  handleAuthDeepLink,
} = require("./src/authBridge.cjs");
const {
  installDeepLinkHandler,
  flushPendingDeepLinks,
  DEEP_LINK_SCHEME,
} = require("./src/deepLink.cjs");
const { initAnalytics, track, setEnabled: setAnalyticsEnabled } = require("./src/analytics.cjs");
const { maybeInitUpdater } = require("./src/updater.cjs");

// Dev preflight: refuse to start if the static client bundle is missing.
// In a packaged build the bundle is staged under app.asar/resources by
// electron-builder and is always present — if it isn't, the user has
// a corrupted install and `did-fail-load` surfaces a real error page.
// In dev the bundle is staged on demand by `npm run dev:build-client`,
// and forgetting that step otherwise yields a confusing "Tiao couldn't
// load its app files" message with no hint about the actual fix.
if (!app.isPackaged) {
  const bundlePath = path.join(__dirname, "client-bundle");
  if (!fs.existsSync(bundlePath)) {
    console.error("");
    console.error("[main] desktop/client-bundle/ is missing.");
    console.error("[main] The renderer is loaded from a Next.js static export that lives there.");
    console.error("[main] Run `npm run dev:build-client` first, then `npm run dev`.");
    console.error("");
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }
}

// Privileged scheme registration MUST run before app.whenReady() —
// at startup Chromium builds its protocol table from whatever has
// been registered synchronously, and a scheme registered after
// that point won't get cookies/fetch/localStorage privileges.
protocol.registerSchemesAsPrivileged([
  {
    scheme: DESKTOP_PROTOCOL_SCHEME,
    privileges: {
      standard: true, // treat like http/https for URL parsing
      secure: true, // allow service workers, secure contexts
      supportFetchAPI: true, // fetch() works against app://
      corsEnabled: true, // respects Access-Control-Allow-Origin
      stream: true, // supports media range requests
    },
  },
]);

// Register the custom URL scheme with the OS so `tiao://auth/complete`
// deep links route back to this app.  On packaged builds this writes
// to the system protocol table; on dev builds (app.isPackaged = false)
// we need to pass the current executable + script path so the OS
// launches us with the right argv.
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
}

// Single-instance lock: if a user triggers a second launch via a
// tiao:// deep link, Electron forwards its argv to the primary
// instance instead of spawning a second one.  Without this, each
// deep link click on Windows/Linux would spawn a fresh Electron
// process with no shared state.
//
// On bail we call BOTH app.quit() and process.exit(0):
//   - app.quit() is the canonical Electron shutdown path, but it's
//     async and doesn't immediately interrupt the rest of this file.
//     Without an early process.exit, the module would continue
//     loading, register handlers, call whenReady, and only THEN
//     honor the queued quit.  process.exit short-circuits that.
//   - The eslint-disable is intentional: the no-process-exit rule is
//     a sane default but the bail path is the canonical exception.
//   - There is one mild trade-off: any async shutdown hook the OS or
//     Electron registers internally would be skipped.  In this slot
//     of the lifecycle (before any window or IPC handler exists)
//     there's nothing to clean up, so it's safe.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  // eslint-disable-next-line no-process-exit
  process.exit(0);
}

// Install deep-link handlers BEFORE whenReady so any `open-url` event
// that fires during startup gets queued correctly.  See deepLink.cjs
// for the full lifecycle story.
installDeepLinkHandler({ onAuth: handleAuthDeepLink });

/** @type {BrowserWindow | null} */
let mainWindow = null;

/**
 * Check the on-disk locations the protocol handler will look at for
 * the bundled static export.  Returns the first existing path, or
 * null if none found.  In dev this is `desktop/client-bundle/`; in
 * packaged builds it's `process.resourcesPath/client-bundle`.
 */
function findClientBundleRoot() {
  const devPath = path.join(__dirname, "client-bundle");
  if (fs.existsSync(path.join(devPath, "en", "index.html"))) return devPath;
  if (process.resourcesPath) {
    const resourcesPath = path.join(process.resourcesPath, "client-bundle");
    if (fs.existsSync(path.join(resourcesPath, "en", "index.html"))) return resourcesPath;
  }
  return null;
}

/**
 * Show a self-contained native error page explaining how to recover
 * from a missing client-bundle.  Loads a data: URL so it works even
 * when no protocol handler is functional.
 *
 * @param {BrowserWindow} win
 */
function showMissingBundleError(win) {
  const html = `
    <html><head><meta charset="utf-8"><title>Tiao — missing bundle</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; padding: 3rem 2rem; max-width: 640px; margin: 0 auto; color: #2a1d13; }
      h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
      code { background: #f3ebe0; padding: 0.15em 0.4em; border-radius: 3px; font-size: 0.92em; }
      pre { background: #f3ebe0; padding: 1rem; border-radius: 4px; overflow-x: auto; }
      .muted { color: #887060; }
    </style></head><body>
    <h1>Tiao can't find its bundled app files.</h1>
    <p>The Electron shell booted, but the <code>client-bundle/</code>
    directory the <code>app://tiao/</code> protocol handler reads from
    doesn't exist yet.</p>
    <p class="muted">This is expected the first time you clone or pull
    the repo — the bundle is git-ignored and needs to be built from
    the client package:</p>
    <pre>cd desktop
npm run dev:build-client   # builds client/.next-desktop and copies it in
npm run dev                # launches Electron again</pre>
    <p class="muted">Packaged builds ship the bundle inside
    <code>Contents/Resources/client-bundle/</code>; a missing bundle
    there means the installer is corrupt and you should reinstall.</p>
    </body></html>`;
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function bootstrap() {
  registerAppProtocol();
  // Warm the token cache BEFORE registering IPC handlers so
  // auth:getToken returns the previously persisted value on the
  // first call rather than null.
  loadPersistedToken();
  registerAuthIpc();
  initAnalytics();
  registerAnalyticsIpc();
  track("desktop:app_start", { packaged: app.isPackaged });

  // Check whether the bundled static export is reachable BEFORE we
  // create the window — if it's missing we'll spawn the window
  // pointing at the protocol URL but then immediately replace the
  // content with a helpful error page (see showMissingBundleError
  // below). Going straight to an error page would render "Not found"
  // otherwise, which is a frustrating silent failure.
  const bundleRoot = findClientBundleRoot();

  mainWindow = createMainWindow({
    startUrl: `${DESKTOP_PROTOCOL_SCHEME}://tiao/en/`,
    devTools: !app.isPackaged,
  });
  track("desktop:window_created");

  Menu.setApplicationMenu(buildMenu());

  if (!bundleRoot) {
    console.error(
      "[main] client-bundle missing. Run `npm run dev:build-client` or reinstall.",
    );
    showMissingBundleError(mainWindow);
  }

  const win = mainWindow;

  // Open any external links (target=_blank, shared game URLs, etc.)
  // in the user's default browser instead of navigating the app
  // BrowserWindow away from its bundled client shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`${DESKTOP_PROTOCOL_SCHEME}://`)) {
      void shell.openExternal(url);
      // Record the host only — not the full URL — to avoid leaking
      // game IDs or usernames into analytics.
      let host = "unknown";
      try {
        host = new URL(url).host;
      } catch {
        /* keep fallback */
      }
      track("desktop:external_link_opened", { host });
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  // A `did-fail-load` with a bundled client shell indicates a
  // corrupted install (missing index.html, wrong protocol handler
  // path, etc.).  Offline is not a failure here — the bundle lives
  // on disk, so network has no bearing on the initial load.
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, url) => {
    if (errorCode === -3) return; // aborted (Chromium internal)
    console.error(`[main] did-fail-load ${errorCode} ${errorDescription} for ${url}`);
    const html = `
      <html><body style="font-family:system-ui;padding:2rem;text-align:center;">
        <h1>Tiao couldn't load its app files.</h1>
        <p>Please reinstall the app.</p>
        <p style="color:#888;font-size:0.9em;">(${errorDescription})</p>
      </body></html>`;
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });

  // Once the renderer has loaded its JS bundle, flush any deep
  // links we received before the auth listener was wired up.  On
  // cold-start via a tiao:// URL on Windows/Linux this is the
  // difference between the user signing in successfully and seeing
  // the lobby stuck as a guest.
  win.webContents.once("did-finish-load", () => {
    flushPendingDeepLinks();
  });

  // Auto-updater is installed but gated behind TIAO_ENABLE_UPDATER=1
  // until the first signed macOS build — see src/updater.cjs.
  maybeInitUpdater();
}

/**
 * Minimal analytics IPC surface. The renderer calls
 * `window.electron.analytics.setEnabled(bool)` when the OpenPanel
 * consent banner state changes — main process persists the flag so
 * the next cold start honors it.
 */
function registerAnalyticsIpc() {
  ipcMain.handle("analytics:setEnabled", async (_event, enabled) => {
    setAnalyticsEnabled(!!enabled);
    return { ok: true };
  });
}

app.whenReady().then(bootstrap);

app.on("window-all-closed", () => {
  // On macOS, apps stay running in the dock with no windows until
  // the user explicitly quits via Cmd+Q.  Everywhere else, no
  // windows means quit.
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) bootstrap();
});
