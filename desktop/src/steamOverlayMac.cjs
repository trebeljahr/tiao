// @ts-check
const path = require("node:path");
/** Supply the native Metal drawable Chromium's CALayers do not present. */
/** @param {Electron.BrowserWindow} win @returns {boolean} */
function attachMacSteamOverlay(win) {
  try {
    const binding = /** @type {{ attach(windowHandle: Buffer): unknown; detach(handle: unknown): void }} */ (
      require(path.join(__dirname, "steamOverlayMac.node"))
    );
    const handle = binding.attach(win.getNativeWindowHandle());
    win.once("closed", () => {
      try {
        binding.detach(handle);
      } catch (error) {
        console.warn("[steam] Metal overlay cleanup failed:", error);
      }
    });
    console.info("[steam] overlay enabled (native Metal view)");
    return true;
  } catch (error) {
    console.warn("[steam] Metal overlay unavailable:", error);
    return false;
  }
}

module.exports = { attachMacSteamOverlay };
