// The shared frontend retains this API name during the Electron-to-Tauri migration.
// Tauri injects runtime configuration before any frontend scripts execute.
(() => {
  const config = __TIAO_CONFIG__;
  const listeners = new Map();
  const pending = new Map();
  const invoke = (channel, ...args) =>
    window.__TAURI__.core.invoke("desktop_call", { channel, args });
  const deliver = ({ channel, payload }) => {
    const callbacks = [...(listeners.get(channel) || [])];
    if (!callbacks.length) {
      pending.set(channel, payload);
      return;
    }
    for (const callback of callbacks) callback(payload);
  };
  const subscribe = (channel) => (callback) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel).add(callback);
    if (pending.has(channel)) {
      const payload = pending.get(channel);
      pending.delete(channel);
      Promise.resolve().then(() => {
        if (listeners.get(channel)?.has(callback)) callback(payload);
      });
    }
    return () => listeners.get(channel)?.delete(callback);
  };
  const methods = (namespace, names) =>
    Object.fromEntries(
      names.map((name) => [name, (...args) => invoke(`${namespace}:${name}`, ...args)]),
    );
  const bridge = Object.freeze({
    isElectron: true,
    isTauri: true,
    platform: config.platform,
    version: config.version,
    config: Object.freeze(config),
    checkout: { onReturn: subscribe("checkout:return") },
    auth: {
      ...methods("auth", [
        "steam",
        "login",
        "startOAuth",
        "linkOAuth",
        "getToken",
        "logout",
        "getPersistenceStatus",
        "cancelOAuth",
        "confirmSteamLink",
      ]),
      onAuthComplete: subscribe("auth:complete"),
      onAuthError: subscribe("auth:error"),
      onSteamLinkReady: subscribe("auth:steamLinkReady"),
    },
    windowControls: {
      ...methods("window", ["isFullScreen", "setFullScreen", "quit"]),
      onFullScreenChanged: subscribe("window:fullScreenChanged"),
    },
    steam: {
      ...methods("steam", [
        "setInviteGame",
        "openInviteDialog",
        "getPendingJoin",
        "acknowledgeJoin",
        "isActive",
        "getUser",
        "unlockAchievement",
        "indicateAchievementProgress",
        "getAchievementStates",
        "setStats",
        "openOverlay",
        "openOverlayUrl",
        "getWebApiTicket",
      ]),
      onJoinRequested: subscribe("steam:joinRequested"),
      onMicroTxnAuthorization: subscribe("steam:microTxnAuthorization"),
    },
    iap: {
      isMasBuild: config.distributionChannel === "mas",
      ...methods("iap", [
        "isAvailable",
        "getProducts",
        "purchase",
        "restore",
        "getPendingTransactions",
        "finishTransaction",
      ]),
      onTransactions: subscribe("iap:transactions"),
    },
    msstore: methods("msstore", ["isAvailable", "getAddOns", "purchase", "getCollectionsId"]),
    updater: methods("updater", ["check", "download", "install"]),
  });
  Object.defineProperty(window, "electron", { value: bridge, writable: false });
  window.__TAURI__.event
    .listen("desktop:event", (event) => deliver(event.payload))
    .then(() => invoke("runtime:ready"))
    .then((events) => events.forEach(deliver))
    .catch(console.error);
  document.addEventListener("click", (event) => {
    const link = event.target.closest?.("a[href]");
    if (!link || !/^(https?:|mailto:)/.test(link.href)) return;
    if (new URL(link.href).origin === location.origin) return;
    event.preventDefault();
    invoke("runtime:openExternal", link.href).catch(console.error);
  });
})();
