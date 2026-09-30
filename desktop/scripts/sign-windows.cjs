const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");

// electron-builder calls this for the app, NSIS uninstaller, and outer installers.
module.exports = async function signWindows(configuration) {
  if (process.platform !== "win32") {
    throw new Error("Azure Windows signing requires a Windows runner");
  }
  if (configuration.hash !== "sha256") {
    throw new Error("Windows signing requires SHA-256");
  }
  const { stdout, stderr } = await promisify(execFile)(
    "pwsh.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      path.join(__dirname, "sign-windows.ps1"),
      "-FilePath",
      configuration.path,
    ],
    { timeout: 600_000, windowsHide: true },
  );
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
};
