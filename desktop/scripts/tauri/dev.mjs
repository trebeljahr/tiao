import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (
  process.argv.includes("--fresh") ||
  !existsSync(resolve(desktop, "client-bundle/en/index.html"))
) {
  const build = spawnSync(process.execPath, ["scripts/tauri/stage.mjs"], {
    cwd: desktop,
    stdio: "inherit",
  });
  if (build.status) process.exit(build.status);
}
const result = spawnSync("pnpm", ["exec", "tauri", "dev", "--no-watch"], {
  cwd: desktop,
  stdio: "inherit",
  env: {
    ...process.env,
    CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || resolve(desktop, "src-tauri/target"),
    TIAO_DISTRIBUTION_CHANNEL: process.env.TIAO_DISTRIBUTION_CHANNEL || "direct",
  },
});
process.exit(result.status ?? 1);
