#!/usr/bin/env node
import { X509Certificate } from "node:crypto";
import { lookup } from "node:dns/promises";
// Optional HTTPS sidecar for packaged clients whose CSP permits HTTPS only.
// Reuses an existing trusted certificate; never issues certificates or changes trust.
import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import os from "node:os";
import { createApiProxy } from "../client/runtime-proxy.mjs";
import { freeHighPort } from "./shop-sandbox.mjs";

const args = process.argv.slice(2);
const allowed = ["--api-port", "--host", "--cert", "--key", "--bind-address"];
if (
  ![8, 10].includes(args.length) ||
  args.some((value, index) => index % 2 === 0 && !allowed.includes(value))
)
  throw Error(
    "Usage: shop-sandbox-tls.mjs --api-port <high port> --host <loopback DNS name> --cert <existing PEM> --key <existing PEM>",
  );
const values = Object.fromEntries(
  args.flatMap((value, index) => (index % 2 === 0 ? [[value, args[index + 1]]] : [])),
);
const apiPort = Number(values["--api-port"]);
if (!Number.isInteger(apiPort) || apiPort < 49152 || apiPort > 65535)
  throw Error("Expected a high API port");
const host = values["--host"];
const bindAddress = values["--bind-address"] || "127.0.0.1";
const local = Object.values(os.networkInterfaces())
  .flat()
  .some((entry) => entry.address === bindAddress);
const parts = bindAddress.split(".").map(Number);
const tailscale = parts.length === 4 && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
if (!local || (bindAddress !== "127.0.0.1" && !tailscale))
  throw Error("Bind address must be local loopback or this machine's Tailscale interface");
const addresses = await lookup(host, { all: true });
if (!addresses.length || addresses.some(({ address }) => address !== bindAddress))
  throw Error("TLS hostname must resolve only to the chosen local interface");
const cert = await readFile(values["--cert"]);
const parsed = new X509Certificate(cert);
if (!parsed.checkHost(host) || Date.parse(parsed.validTo) <= Date.now())
  throw Error("Certificate does not cover host or has expired");
const config = await (await fetch(`http://127.0.0.1:${apiPort}/api/shop/iap/config`)).json();
if (!config.steam?.enabled || config.steam.sandbox !== true)
  throw Error("Steam sandbox backend required");
const proxy = createApiProxy(`http://127.0.0.1:${apiPort}`);
const server = createServer({ cert, key: await readFile(values["--key"]) }, (req, res) =>
  proxy.http(req, res),
);
server.on("upgrade", (req, socket, head) => proxy.upgrade(req, socket, head));
const port = await freeHighPort();
server.listen(port, bindAddress, () => console.log(`Native QA API: https://${host}:${port}`));
async function stop() {
  server.closeAllConnections();
  await proxy.close();
  server.close(() => process.exit(0));
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
