// @ts-check
/**
 * electron-builder afterPack hook for the Mac App Store build. It runs before
 * signing, on each arch app and again on the merged universal app.
 *
 * App Store Connect refuses a pkg with files only root can read (409
 * "includes files that are only readable by the root user"). CI stages the
 * provisioning profile under umask 077, and @electron/osx-sign copies it into
 * the app with that 0600 mode. So this hook embeds the profile itself at 0644
 * (osx-sign keeps an existing embedded.provisionprofile) and then gives every
 * file and directory a+rX, like `chmod -R a+rX`.
 */
const fs = require("node:fs");
const path = require("node:path");

/** `chmod -R a+rX` without following symlinks. @param {string} root */
function makeWorldReadable(root) {
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink()) return;
  const mode = stat.mode & 0o7777;
  const executable = stat.isDirectory() || (mode & 0o111) !== 0;
  const wanted = mode | 0o444 | (executable ? 0o111 : 0);
  if (wanted !== mode) fs.chmodSync(root, wanted);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(root)) makeWorldReadable(path.join(root, name));
  }
}

/** @param {string} appPath @param {string | null | undefined} profile */
function prepareMasApp(appPath, profile) {
  if (profile) {
    const embedded = path.join(appPath, "Contents", "embedded.provisionprofile");
    fs.copyFileSync(profile, embedded);
    fs.chmodSync(embedded, 0o644);
  }
  makeWorldReadable(appPath);
}

/** @param {import("app-builder-lib").AfterPackContext} context */
async function afterPack(context) {
  if (context.electronPlatformName !== "mas") return;
  const appPath = path.join(context.appOutDir, context.packager.appInfo.productFilename + ".app");
  prepareMasApp(appPath, context.packager.config.mas?.provisioningProfile);
}

module.exports = afterPack;
module.exports.default = afterPack;
module.exports.makeWorldReadable = makeWorldReadable;
module.exports.prepareMasApp = prepareMasApp;
