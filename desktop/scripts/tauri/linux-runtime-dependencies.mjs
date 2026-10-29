// Harden the extracted Steam AppDir, after linuxdeploy's desktop-oriented
// exclusion list has run. Only the platform ABI and driver stack stay external.
import { execFileSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const FONT_LIBRARIES = ["libharfbuzz.so.0", "libfreetype.so.6", "libfontconfig.so.1"];

// These libraries must match the runtime's loader, injected GPU drivers and
// audio services. Do not follow their dependency trees into our bundle.
export function hostLibrary(name) {
  return (
    /^(?:ld-linux[^/]*|lib(?:c|m|mvec|dl|pthread|rt|resolv|util|anl|BrokenLocale|thread_db|nss_[\w-]+))\.so(?:\.[\d.]+)*$/.test(
      name,
    ) ||
    /^lib(?:stdc\+\+|gcc_s)\.so\./.test(name) ||
    /^lib(?:wayland-[\w-]+|xcb(?:-[\w-]+)?|X[A-Za-z0-9_-]*|ICE|SM|xkbcommon(?:-x11)?|gbm|drm(?:_[\w-]+)?|EGL(?:_[\w-]+)?|GL(?:X(?:_[\w-]+)?|dispatch|ESv[12])?|OpenGL|glapi|vulkan|nvidia-[\w-]+)\.so(?:\.|$)/.test(
      name,
    ) ||
    /^lib(?:asound|pulse(?:-simple|common-[\d.]+)?|pipewire-[\d.]+|jack(?:net|server)?|udev)\.so(?:\.|$)/.test(
      name,
    ) ||
    /_dri\.so$/.test(name)
  );
}

function walk(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
function inside(root, file) {
  const path = relative(root, file);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}
function elf(file) {
  if (!lstatSync(file).isFile()) return false;
  const fd = openSync(file, "r");
  try {
    const bytes = Buffer.alloc(4);
    return readSync(fd, bytes, 0, 4, 0) === 4 && bytes.equals(Buffer.from([127, 69, 76, 70]));
  } finally {
    closeSync(fd);
  }
}

export function parseDynamic(text) {
  return {
    needed: [...text.matchAll(/\(NEEDED\).*?\[([^\]]+)\]/g)].map((match) => match[1]),
    rpath: [...text.matchAll(/\((?:RUNPATH|RPATH)\).*?\[([^\]]*)\]/g)].flatMap((match) =>
      match[1].split(":"),
    ),
  };
}
export function parseLdd(text) {
  return new Map([
    ...[...text.matchAll(/^\s*(\S+) => (.+?) \(0x[0-9a-f]+\)/gm)].map((match) => [
      match[1],
      match[2],
    ]),
    // The dynamic loader can itself be DT_NEEDED, but ldd prints it without =>.
    ...[...text.matchAll(/^\s*(\/[^\n]+?) \(0x[0-9a-f]+\)/gm)].map((match) => [
      basename(match[1]),
      match[1],
    ]),
  ]);
}
function command(name, args, env = process.env) {
  return execFileSync(name, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...env, LC_ALL: "C" },
    maxBuffer: 8 * 1024 * 1024,
  });
}
function retainCopyright(source, root) {
  // The build is Ubuntu. Dereference /lib aliases for dpkg's /usr ownership
  // lookup, but also try the original path on pre-usrmerge package databases.
  let owner;
  for (const file of new Set([realpathSync(source), source])) {
    try {
      owner = command("dpkg-query", ["-S", file]).split(": ")[0];
      break;
    } catch {
      /* Try the other spelling before failing the build. */
    }
  }
  if (!owner) throw new Error(`Cannot identify license owner for ${source}`);
  const pkg = owner.split(":")[0];
  const destination = join(root, "usr/share/doc/steam-runtime-dependencies", pkg);
  mkdirSync(destination, { recursive: true });
  copyFileSync(`/usr/share/doc/${pkg}/copyright`, join(destination, "copyright"));
}

export function prepareLinuxDependencies(
  appDir,
  { run = command, retainLicense = retainCopyright } = {},
) {
  const root = realpathSync(appDir);
  const libDir = join(root, "usr/lib");
  mkdirSync(libDir, { recursive: true });
  const removed = [];
  for (const file of walk(root)) {
    if (!hostLibrary(basename(file))) continue;
    removed.push(relative(root, file));
    rmSync(file);
  }
  // No inherited loader overrides: CI must verify the shipped search paths.
  const env = { ...process.env };
  for (const key of ["LD_LIBRARY_PATH", "LD_PRELOAD", "LD_AUDIT"]) delete env[key];
  const queue = walk(root).filter(elf);
  const visited = new Set();
  const copied = [];
  const dynamic = new Map();
  for (let index = 0; index < queue.length; index++) {
    const file = realpathSync(queue[index]);
    if (visited.has(file)) continue;
    visited.add(file);
    const info = parseDynamic(run("readelf", ["-dW", file]));
    if (!info.needed.length) continue; // Static AppRun or other static helper.
    dynamic.set(file, info.needed);
    const search = [
      "$ORIGIN",
      `$ORIGIN/${relative(dirname(file), libDir) || "."}`,
      ...info.rpath.filter(
        (path) =>
          path.startsWith("$ORIGIN/") && inside(root, resolve(dirname(file), path.slice(8))),
      ),
    ];
    run("patchelf", ["--set-rpath", [...new Set(search)].join(":"), file]);
    const output = run("ldd", [file], env);
    const resolved = parseLdd(output);
    for (const name of info.needed) {
      if (hostLibrary(name)) continue;
      if (basename(name) !== name) throw new Error(`Non-relocatable dependency ${name} in ${file}`);
      const source = resolved.get(name);
      if (!source || !isAbsolute(source) || !existsSync(source))
        throw new Error(`Unresolved dependency ${name} in ${file}\n${output}`);
      if (inside(root, realpathSync(source))) continue;
      const destination = join(libDir, name);
      if (existsSync(destination))
        throw new Error(`Bundled ${name} is shadowed by ${source} in ${file}`);
      // Copy the resolved bytes under the SONAME; never retain a system symlink.
      copyFileSync(realpathSync(source), destination);
      retainLicense(source, root);
      copied.push(name);
      queue.push(destination);
    }
  }
  for (const name of FONT_LIBRARIES) {
    if (!existsSync(join(libDir, name)) || !elf(realpathSync(join(libDir, name))))
      throw new Error(`Required font library is missing: ${name}`);
  }
  if (!["Tiao", "Tiao Demo"].some((name) => dynamic.has(join(root, "usr/bin", name))))
    throw new Error("Missing dynamically linked Linux game executable");
  const files = [];
  for (const [file, needed] of dynamic) {
    // Check relocations too for the game and its complete linked dependency
    // tree. Plugins can intentionally import symbols from their loading process.
    const args = basename(file) === "Tiao" ? ["-r", file] : [file];
    const output = run("ldd", args, env);
    if (/not found|undefined symbol:|symbol lookup error:/.test(output))
      throw new Error(`Linux runtime link check failed for ${file}\n${output}`);
    const resolved = parseLdd(output);
    const dependencies = needed.map((name) => {
      const target = resolved.get(name);
      if (!target || !isAbsolute(target) || !existsSync(target))
        throw new Error(`Unresolved dependency ${name} in ${file}`);
      const bundled = inside(root, realpathSync(target));
      if (bundled === hostLibrary(name))
        throw new Error(`Wrong dependency origin for ${name} in ${file}: ${target}`);
      return { name, source: bundled ? relative(root, target) : "host" };
    });
    files.push({ path: relative(root, file), dependencies });
  }
  const report = { copied, removed, files };
  writeFileSync(
    join(root, "steam-runtime-dependencies.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}
