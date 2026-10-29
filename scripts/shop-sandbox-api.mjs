// Run the real API entry point; constrain its listener to loopback for local QA.
import net from "node:net";

const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  if (typeof args[0] === "string" && /^\d+$/.test(args[0])) args[0] = Number(args[0]);
  if (typeof args[0] !== "number" || args[0] < 49152 || args[0] > 65535)
    throw Error("Sandbox API must listen on a high TCP port");
  if (typeof args[1] === "string") args[1] = "127.0.0.1";
  else args.splice(1, 0, "127.0.0.1");
  return listen.apply(this, args);
};
// Refuse live Steam MicroTxn calls even if application routing regresses.
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname === "partner.steam-api.com" && url.pathname.startsWith("/ISteamMicroTxn/"))
    throw Error("Live Steam Microtransactions are forbidden in sandbox QA");
  return originalFetch(input, init);
};
await import("../server/index.ts");
