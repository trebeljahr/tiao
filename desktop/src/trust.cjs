// @ts-check
/** Only explicitly registered app windows can use privileged IPC. */
const trustedContents = new WeakMap();

/** @param {string} value */
function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** @param {string} startUrl @param {boolean} isPackaged */
function createUrlPolicy(startUrl, isPackaged) {
  const start = parseUrl(startUrl);
  if (!start || start.username || start.password) throw new Error("Invalid renderer URL");
  const bundled = start.protocol === "app:" && start.host === "tiao";
  const dev = !isPackaged && ["http:", "https:"].includes(start.protocol);
  if (!bundled && !dev) throw new Error("Untrusted renderer URL");
  return /** @param {string} value */ (value) => {
    const url = parseUrl(value);
    if (!url || url.username || url.password) return false;
    // URL.origin is 'null' for custom schemes; compare the scheme and authority.
    return bundled ? url.protocol === "app:" && url.host === "tiao" : url.origin === start.origin;
  };
}

/** @param {string} value */
function isSafeExternalUrl(value) {
  const url = parseUrl(value);
  return (
    !!url && !url.username && !url.password && ["https:", "http:", "mailto:"].includes(url.protocol)
  );
}

/** @param {Electron.WebContents} contents @param {(url: string) => boolean} policy */
function registerTrustedContents(contents, policy) {
  trustedContents.set(contents, policy);
  contents.once("destroyed", () => trustedContents.delete(contents));
}

/** @param {Electron.WebContents} contents */
function isTrustedContents(contents) {
  const policy = trustedContents.get(contents);
  return !!policy && !contents.isDestroyed() && policy(contents.mainFrame.url);
}

/** @param {Electron.IpcMainInvokeEvent} event */
function assertTrustedSender(event) {
  if (
    !isTrustedContents(event.sender) ||
    !event.senderFrame ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    throw new Error("Untrusted IPC sender");
  }
}

/** @param {Electron.IpcMain} ipcMain @param {string} channel
 * @param {(event: Electron.IpcMainInvokeEvent, ...args: any[]) => any} handler */
function handleTrustedIpc(ipcMain, channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event);
    return handler(event, ...args);
  });
}

/** @param {Electron.BrowserWindow} win
 * @param {{startUrl: string, isPackaged: boolean, openExternal: (url: string) => Promise<unknown>}} options */
function installWindowTrust(win, { startUrl, isPackaged, openExternal }) {
  const trusted = createUrlPolicy(startUrl, isPackaged);
  const wc = win.webContents;
  registerTrustedContents(wc, trusted);
  wc.on("will-navigate", (event) => {
    if (!trusted(event.url)) event.preventDefault();
  });
  wc.on("will-frame-navigate", (event) => {
    if (!event.isMainFrame || !trusted(event.url)) event.preventDefault();
  });
  wc.on("will-redirect", (event) => {
    if (!event.isMainFrame || !trusted(event.url)) event.preventDefault();
  });
  wc.on("will-attach-webview", (event) => event.preventDefault());
  wc.setWindowOpenHandler(({ url }) => {
    if (isTrustedContents(wc)) {
      if (trusted(url)) void win.loadURL(url).catch(() => {});
      else if (isSafeExternalUrl(url)) void openExternal(url).catch(() => {});
    }
    return { action: "deny" };
  });
}

module.exports = {
  createUrlPolicy,
  isSafeExternalUrl,
  registerTrustedContents,
  isTrustedContents,
  assertTrustedSender,
  handleTrustedIpc,
  installWindowTrust,
};
