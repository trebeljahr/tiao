// docs/marketing/manifest.json: one section per generator, each a list of
// files with purpose, pixel size, bytes, SHA-256, how it was made and when.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const manifestPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../docs/marketing/manifest.json",
);

export function updateManifest(section, entries) {
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8"))
    : {
        description:
          "Tiao marketing assets: real screenshots and GitHub social preview cards. See README.md in this folder.",
      };
  manifest[section] = entries;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
