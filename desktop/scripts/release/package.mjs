// Build all channels of a release leg with Tauri; publishing is separate.
import { execFileSync } from "node:child_process";
import { desktopTargets } from "./lib.mjs";

const [platform, mode] = process.argv.slice(2);
const target = desktopTargets.find((t) => t.platform === platform);
if (!target || !["signed", "smoke"].includes(mode)) throw Error("Unknown release target or mode");
for (const channel of target.channels) {
  execFileSync(process.execPath, ["scripts/tauri/package.mjs", "--prebuilt"], {
    stdio: "inherit",
    env: {
      ...process.env,
      TIAO_DISTRIBUTION_CHANNEL: channel,
      TIAO_SIGNED: mode === "signed" ? "1" : "0",
    },
  });
}
