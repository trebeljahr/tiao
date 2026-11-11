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
  // A file whose bytes have not changed keeps its date.
  const before = new Map((manifest[section] ?? []).map((entry) => [entry.path, entry]));
  manifest[section] = entries.map((entry) => {
    const old = before.get(entry.path);
    return old?.sha256 === entry.sha256 && old.date ? { ...entry, date: old.date } : entry;
  });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
