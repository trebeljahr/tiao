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

const { app, BrowserWindow, Menu, shell, protocol } = require("electron");
const path = require("node:path");

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

function bootstrap() {
  registerAppProtocol();
  // Warm the token cache BEFORE registering IPC handlers so
  // auth:getToken returns the previously persisted value on the
  // first call rather than null.
  loadPersistedToken();
  registerAuthIpc();

  mainWindow = createMainWindow({
    startUrl: `${DESKTOP_PROTOCOL_SCHEME}://tiao/en/`,
    devTools: !app.isPackaged,
  });

  Menu.setApplicationMenu(buildMenu());

  const win = mainWindow;

  // Open any external links (target=_blank, shared game URLs, etc.)
  // in the user's default browser instead of navigating the app
  // BrowserWindow away from its bundled client shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`${DESKTOP_PROTOCOL_SCHEME}://`)) {
      void shell.openExternal(url);
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
