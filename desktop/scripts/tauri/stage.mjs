import { execFileSync } from "node:child_process";
import { cpSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = resolve(desktop, "../client/.next-desktop");
if (!process.argv.includes("--prebuilt"))
  execFileSync("pnpm", ["--dir", resolve(desktop, "../client"), "run", "build:desktop"], {
    stdio: "inherit",
  });
if (!existsSync(resolve(source, "en/index.html"))) throw Error("Missing desktop static export");
const output = resolve(desktop, "client-bundle");
rmSync(output, { recursive: true, force: true });
cpSync(source, output, { recursive: true });
writeFileSync(
  resolve(output, "index.html"),
  '<!doctype html><html><head><meta charset="utf-8"><title>Tiao</title><style>html,body{margin:0;background:#2a1d13}</style><script>const locale=location.pathname.split("/")[1];location.replace("/"+(["en","de","es"].includes(locale)?locale:"en")+"/")</script></head><body></body></html>',
);
