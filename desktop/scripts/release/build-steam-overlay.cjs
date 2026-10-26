// Node-API uses a stable ABI; both Electron architectures can load this addon.
const { existsSync } = require("node:fs");
const { homedir } = require("node:os");
const { dirname, join, resolve } = require("node:path");
const { execFileSync } = require("node:child_process");

function buildSteamOverlay() {
  const candidates = [
    process.env.NODE_INCLUDE_DIR,
    resolve(dirname(process.execPath), "../include/node"),
    join(homedir(), "Library/Caches/node-gyp", process.versions.node, "include/node"),
  ].filter(Boolean);
  const headers = candidates.find((candidate) => existsSync(join(candidate, "node_api.h")));
  if (!headers) throw new Error("Node-API headers missing. Set NODE_INCLUDE_DIR to a Node include directory.");
  const root = resolve(__dirname, "../..");
  const output = join(root, "src/steamOverlayMac.node");
  execFileSync("xcrun", [
    "clang++", "-std=c++17", "-fobjc-arc", "-bundle", "-undefined", "dynamic_lookup",
    "-arch", "arm64", "-arch", "x86_64", "-mmacosx-version-min=12.0", "-DNAPI_VERSION=8",
    "-framework", "Cocoa", "-framework", "MetalKit", "-framework", "Metal",
    "-I", headers, join(root, "src/steamOverlayMac.mm"), "-o", output,
  ], { stdio: "inherit" });
  execFileSync("lipo", [output, "-verify_arch", "arm64", "x86_64"], { stdio: "inherit" });
}

module.exports = async (context) => {
  if (context.electronPlatformName === "darwin") buildSteamOverlay();
};
module.exports.buildSteamOverlay = buildSteamOverlay;
if (require.main === module && process.platform === "darwin") buildSteamOverlay();
