// Reuse linuxdeploy's retained AppDir when complete and relocatable. Older
// bundlers and incomplete outputs fall back to extracting the built AppImage.
import { execFileSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { prepareLinuxDependencies } from "./linux-runtime-dependencies.mjs";

function walk(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? [path, ...walk(path)] : [path];
  });
}
function executable(path) {
  try {
    accessSync(path, constants.X_OK);
    return lstatSync(path).isFile() || lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
function complete(root) {
  if (
    !existsSync(root) ||
    !executable(join(root, "AppRun")) ||
    !["Tiao", "Tiao Demo"].some((name) => executable(join(root, "usr/bin", name)))
  )
    return false;
  const files = walk(root).filter((path) => lstatSync(path).isFile());
  return [
    /\/libwebkit2gtk-4\.1\.so/,
    /\/libjavascriptcoregtk-4\.1\.so/,
    /\/libsoup-3\.0\.so/,
    /\/libgstmpg123\.so$/,
  ].every((pattern) => files.some((path) => pattern.test(path)));
}
function relocateLinks(root) {
  const changes = [];
  for (const file of walk(root)) {
    if (!lstatSync(file).isSymbolicLink()) continue;
    const link = readlinkSync(file);
    const destination = resolve(dirname(file), link);
    const rel = relative(root, destination);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !existsSync(destination))
      return false;
    if (isAbsolute(link)) changes.push([file, relative(dirname(file), destination)]);
  }
  for (const [file, link] of changes) {
    unlinkSync(file);
    symlinkSync(link, file);
  }
  return true;
}
export function stageLinuxRuntime({
  imageDir,
  outputDir,
  prepareDependencies = prepareLinuxDependencies,
  extract = (image, work) =>
    execFileSync(image, ["--appimage-extract"], { cwd: work, stdio: "ignore" }),
}) {
  imageDir = resolve(imageDir);
  outputDir = resolve(outputDir);
  const entries = readdirSync(imageDir, { withFileTypes: true });
  const images = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".AppImage"));
  const dirs = entries.filter((entry) => entry.isDirectory() && entry.name.endsWith(".AppDir"));
  if (images.length !== 1 || dirs.length > 1)
    throw new Error("Expected exactly one AppImage and at most one retained AppDir");
  if (existsSync(outputDir)) throw new Error("Portable staging output already exists");
  mkdirSync(outputDir, { recursive: true });
  const target = join(outputDir, "appdir");
  const retained = dirs.length ? join(imageDir, dirs[0].name) : null;
  let method;
  if (retained && complete(retained) && relocateLinks(retained)) {
    renameSync(retained, target);
    method = "retained AppDir";
  } else {
    const work = mkdtempSync(join(outputDir, "extract-"));
    try {
      extract(join(imageDir, images[0].name), work);
      const extracted = join(work, "squashfs-root");
      if (!complete(extracted) || !relocateLinks(extracted))
        throw new Error("Extracted AppImage runtime is incomplete or not relocatable");
      renameSync(extracted, target);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
    method = "AppImage extraction";
  }
  if (!complete(target)) throw new Error("Staged runtime is incomplete");
  // Tiao embeds its frontend; no external model/audio resource folders.
  prepareDependencies(target);
  console.log(`Steam Linux runtime: ${method}`);
  return target;
}
