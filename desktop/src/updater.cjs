// @ts-check
/**
 * Automatic update support via `electron-updater`.
 *
 * Ships in v1 but is GATED behind the `TIAO_ENABLE_UPDATER=1`
 * environment variable so v1.0.0 doesn't attempt to poll a GitHub
 * Releases feed that doesn't exist yet.  Once macOS code signing
 * lands in a follow-up worktree and we cut a real v1.0.0 release,
 * we'll flip the default to always-on in a one-line follow-up
 * commit — no further logic changes needed.
 *
 * Why gated:
 *
 *   - electron-updater on macOS REQUIRES a signed + notarized app
 *     to apply updates.  An unsigned v1.0.0 alpha would download
 *     updates and then fail to install them, generating confusing
 *     errors for early testers.
 *   - Publishing to GitHub Releases before the first signed build
 *     would mean our first public installer would auto-update to
 *     nothing (or a broken unsigned update).
 *   - Shipping the code path compiled-in from day one means v1.0.1
 *     can enable updates with zero code changes — the maintainer
 *     just sets `TIAO_ENABLE_UPDATER=1` in the release env.
 *
 * Independently of that gate, the updater is hard-disabled on every
 * store channel (Steam, itch, Mac App Store, Microsoft Store): each
 * store owns the installed files and ships updates itself.  Only the
 * `direct` channel may self-update — see src/distribution.cjs.
 *
 * The update UX on first release is intentionally minimal:
 * `autoDownload = false` so we can surface a "Download update?"
 * UI later, `quitAndInstall()` on download complete.  Full in-app
 * update prompting can be built as a follow-up once the round-trip
 * is known-working.
 */

const { app, dialog, autoUpdater: _electronNativeUpdater } = require("electron");

const { DISTRIBUTION_CHANNEL, channelAllowsSelfUpdate } = require("./distribution.cjs");

// Lazy-load electron-updater so the dependency can be absent in dev
// without crashing — the module is only required when we know
// packaging resolved it and TIAO_ENABLE_UPDATER is actually set.
function loadAutoUpdater() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("electron-updater");
    return mod.autoUpdater;
  } catch (err) {
    console.warn("[updater] electron-updater not available:", err);
    return null;
  }
}

/**
 * Initialize the auto-updater if the gate env var is set and the
 * app is packaged.  Safe to call unconditionally — in dev or when
 * gated off, this is a no-op.
 */
function maybeInitUpdater() {
  if (!app.isPackaged) {
    console.info("[updater] skipped (dev mode)");
    return;
  }
  // Store builds must never self-update. Steam verifies installed files
  // against its depot manifest and reverts what it did not write; itch
  // patches through butler; the Mac App Store sandbox and MSIX installs
  // cannot write their own bundle at all. Valve, Apple and Microsoft all
  // require updates to ship through the store.
  //
  // This check sits ABOVE the TIAO_ENABLE_UPDATER gate deliberately: when
  // that gate flips to always-on, this is the only thing standing between
  // a store build and a self-inflicted update loop.
  if (!channelAllowsSelfUpdate(DISTRIBUTION_CHANNEL)) {
    console.info(`[updater] skipped (${DISTRIBUTION_CHANNEL} build — the store ships updates)`);
    return;
  }
  if (process.env.TIAO_ENABLE_UPDATER !== "1") {
    console.info("[updater] skipped (TIAO_ENABLE_UPDATER unset)");
    return;
  }

  const autoUpdater = loadAutoUpdater();
  if (!autoUpdater) return;

  // Log to stdout so unsigned-build round-trip tests have a trail
  // to follow.  electron-updater defaults to electron-log which we
  // don't want to pull in for v1.
  autoUpdater.logger = console;
  autoUpdater.autoDownload = false;

  autoUpdater.on("checking-for-update", () => {
    console.info("[updater] checking for update…");
  });

  autoUpdater.on("update-available", (info) => {
    console.info(`[updater] update available: ${info?.version}`);
    // Download immediately — future work could pop a dialog first.
    void autoUpdater.downloadUpdate();
  });

  autoUpdater.on("update-not-available", () => {
    console.info("[updater] no update available");
  });

  autoUpdater.on("download-progress", (progress) => {
    console.info(`[updater] download progress: ${progress?.percent?.toFixed(1)}%`);
  });

  autoUpdater.on("update-downloaded", async () => {
    console.info("[updater] update downloaded — prompting for restart");
    const result = await dialog.showMessageBox({
      type: "info",
      title: "Update ready",
      message: "A new version of Tiao is ready to install.",
      detail: "The app will restart to apply the update.",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on("error", (err) => {
    console.error("[updater] error:", err);
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.error("[updater] initial checkForUpdates failed:", err);
  });
}

module.exports = { maybeInitUpdater };
