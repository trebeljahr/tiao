// @ts-check
const { app, BrowserWindow } = require("electron");
const { handleTrustedIpc } = require("./trust.cjs");

/** @param {Electron.IpcMain} ipcMain */
function registerWindowControlsIpc(ipcMain) {
  handleTrustedIpc(ipcMain, "window:isFullScreen", (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false;
  });
  handleTrustedIpc(ipcMain, "window:setFullScreen", (event, enabled) => {
    if (typeof enabled !== "boolean") throw new Error("Expected a fullscreen boolean");
    BrowserWindow.fromWebContents(event.sender)?.setFullScreen(enabled);
  });
  handleTrustedIpc(ipcMain, "window:quit", () => {
    app.quit();
  });
}

/** @param {Electron.BrowserWindow} win */
function installFullScreenEvents(win) {
  const notify = () => {
    if (!win.webContents.isDestroyed()) {
      win.webContents.send("window:fullScreenChanged", win.isFullScreen());
    }
  };
  win.on("enter-full-screen", notify);
  win.on("leave-full-screen", notify);
}

module.exports = { registerWindowControlsIpc, installFullScreenEvents };
