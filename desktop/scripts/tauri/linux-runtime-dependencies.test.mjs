import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import {
  FONT_LIBRARIES,
  hostLibrary,
  parseDynamic,
  parseLdd,
  prepareLinuxDependencies,
} from "./linux-runtime-dependencies.mjs";

function put(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}
function fixture(t) {
  const work = mkdtempSync(join(tmpdir(), "steam dependencies "));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const root = join(work, "Game.AppDir");
  const system = join(work, "system");
  const lib = join(root, "usr/lib");
  const main = join(root, "usr/bin/Tiao");
  const graph = {
    Tiao: ["libwebkit2gtk-4.1.so.0", "libc.so.6"],
    "libwebkit2gtk-4.1.so.0": [...FONT_LIBRARIES, "libwayland-client.so.0", "libgbm.so.1"],
    "libharfbuzz.so.0": ["libfreetype.so.6"],
    "libfreetype.so.6": ["libharfbuzz.so.0", "libz.so.1"],
    "libfontconfig.so.1": ["libexpat.so.1"],
    "libexpat.so.1": ["libz.so.1"],
    "libz.so.1": ["libc.so.6"],
    "libc.so.6": [],
    // A driver-owned dependency must not get sucked into our closure.
    "libgbm.so.1": ["libdriver-private.so.1"],
    "libwayland-client.so.0": [],
  };
  for (const [name, needed] of Object.entries(graph))
    put(join(system, name), `\x7fELF${JSON.stringify(needed)}`);
  for (const name of ["libwebkit2gtk-4.1.so.0", "libwayland-client.so.0", "libxcb-dri3.so.0"])
    put(join(lib, name), `\x7fELF${JSON.stringify(graph[name] ?? [])}`);
  symlinkSync("libwayland-client.so.0", join(lib, "libwayland-client.so"));
  copyFileSync(join(system, "Tiao"), put(main, ""));
  put(join(root, "AppRun"), "#!/bin/sh\nexit 0\n");
  const patches = [];
  const licenses = [];
  const run = (command, args, env) => {
    const file = args.at(-1);
    const needed = () => JSON.parse(readFileSync(file, "utf8").slice(4));
    if (command === "readelf")
      return (
        needed()
          .map((name) => `(NEEDED) Library: [${name}]`)
          .join("\n") + "\n(RUNPATH) Path: [/build/machine/lib:$ORIGIN/../../outside]"
      );
    if (command === "patchelf") {
      patches.push(args);
      return "";
    }
    assert.equal(command, "ldd");
    assert.equal(env.LD_LIBRARY_PATH, undefined);
    assert.equal(env.LD_PRELOAD, undefined);
    return needed()
      .map((name) => {
        const bundled = join(dirname(dirname(main)), "lib", name);
        const source = existsSync(bundled) ? bundled : join(system, name);
        return `${name} => ${source} (0x123abc)`;
      })
      .join("\n");
  };
  return {
    root,
    lib,
    main,
    system,
    run,
    patches,
    licenses,
    options: { run, retainLicense: (source) => licenses.push(basename(source)) },
  };
}

test("demo executables reject unresolved relocation symbols", (t) => {
  const f = fixture(t);
  renameSync(f.main, join(dirname(f.main), "Tiao Demo"));
  assert.throws(
    () =>
      prepareLinuxDependencies(f.root, {
        ...f.options,
        run: (command, args, env) =>
          command === "ldd" && args.includes("-r") && basename(args.at(-1)) === "Tiao Demo"
            ? "undefined symbol: missing_demo_dependency"
            : f.run(command, args, env),
      }),
    /Linux runtime link check failed/,
  );
});

test("repairs the font closure, prunes drivers and preserves only platform dependencies", (t) => {
  const f = fixture(t);
  const report = prepareLinuxDependencies(f.root, f.options);
  assert.deepEqual(
    new Set(report.copied),
    new Set([...FONT_LIBRARIES, "libexpat.so.1", "libz.so.1"]),
  );
  assert.deepEqual(new Set(f.licenses), new Set(report.copied));
  for (const name of [
    "libwayland-client.so.0",
    "libwayland-client.so",
    "libxcb-dri3.so.0",
    "libgbm.so.1",
    "libdriver-private.so.1",
  ])
    assert.equal(existsSync(join(f.lib, name)), false, name);
  assert.equal(report.files.length, 7);
  assert.ok(report.files.flatMap((file) => file.dependencies).some((dep) => dep.source === "host"));
  assert.ok(f.patches.every((args) => !args[1].includes("/build/machine")));
  assert.ok(f.patches.some((args) => args[1].includes("$ORIGIN/../lib")));
  assert.deepEqual(
    JSON.parse(readFileSync(join(f.root, "steam-runtime-dependencies.json"))),
    report,
  );
  assert.deepEqual(prepareLinuxDependencies(f.root, f.options).copied, []);
});

test("unresolved dependencies and missing font families stop packaging", (t) => {
  const f = fixture(t);
  rmSync(join(f.system, "libharfbuzz.so.0"));
  assert.throws(
    () => prepareLinuxDependencies(f.root, f.options),
    /Unresolved dependency libharfbuzz/,
  );
  assert.equal(existsSync(join(f.root, "steam-runtime-dependencies.json")), false);
});

test("symbol errors fail even when ldd exits successfully and all SONAMEs exist", (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      prepareLinuxDependencies(f.root, {
        ...f.options,
        run: (command, args, env) =>
          f.run(command, args, env) +
          (command === "ldd" && args[0] === "-r"
            ? "\nundefined symbol: FT_Get_Color_Glyph_Paint"
            : ""),
      }),
    /link check failed.*Tiao/s,
  );
});

test("dependency parsers handle spaces and versioned libraries", () => {
  assert.equal(
    parseLdd(" /lib64/ld-linux-x86-64.so.2 (0xabc)\n").get("ld-linux-x86-64.so.2"),
    "/lib64/ld-linux-x86-64.so.2",
  );
  assert.deepEqual(
    parseDynamic(
      "0x1 (NEEDED) Shared library: [libfreetype.so.6]\n0x1d (RUNPATH) Library runpath: [$ORIGIN:/tmp/with spaces]",
    ),
    { needed: ["libfreetype.so.6"], rpath: ["$ORIGIN", "/tmp/with spaces"] },
  );
  assert.equal(
    parseLdd(
      " libfreetype.so.6 => /tmp/with spaces/libfreetype.so.6 (0xabc)\n libmissing.so => not found",
    ).get("libfreetype.so.6"),
    "/tmp/with spaces/libfreetype.so.6",
  );
  for (const name of [
    "libwayland-server.so.0",
    "libwayland-egl.so.1",
    "libwayland-cursor.so.0",
    "libxcb.so.1",
    "libxcb-dri3.so.0",
    "libdrm_amdgpu.so.1",
    "libEGL.so.1",
    "libGLX_mesa.so.0",
    "libGLESv2.so.2",
    "libX11.so.6",
    "ld-linux-x86-64.so.2",
    "libstdc++.so.6",
  ])
    assert.ok(hostLibrary(name), name);
  for (const name of [
    ...FONT_LIBRARIES,
    "libharfbuzz-icu.so.0",
    "libpango-1.0.so.0",
    "libexpat.so.1",
    "libgcrypt.so.20",
  ])
    assert.equal(hostLibrary(name), false, name);
});

test("launcher sets the renderer fallback, preserves overrides, arguments and exit status", (t) => {
  const work = mkdtempSync(join(tmpdir(), "steam launcher "));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const launcher = join(work, "Tiao");
  copyFileSync(new URL("./linux-launcher.sh", import.meta.url), launcher);
  chmodSync(launcher, 0o755);
  const app = put(
    join(work, "appdir/AppRun"),
    '#!/bin/sh\nprintf "%s\\n" "$WEBKIT_DISABLE_DMABUF_RENDERER" "$@"\nexit 17\n',
  );
  chmodSync(app, 0o755);
  for (const value of [undefined, "", "0", "1"]) {
    const env = { ...process.env };
    delete env.WEBKIT_DISABLE_DMABUF_RENDERER;
    if (value !== undefined) env.WEBKIT_DISABLE_DMABUF_RENDERER = value;
    const result = spawnSync(launcher, ["?silent=1", "argument with spaces"], {
      env,
      encoding: "utf8",
      cwd: "/",
    });
    assert.equal(result.status, 17);
    assert.equal(result.stdout, `${value || "1"}\n?silent=1\nargument with spaces\n`);
  }
  rmSync(app);
  const missing = spawnSync(launcher, { encoding: "utf8" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Verify the game files/);
});

// Small real ELF integration, executed by the Linux build workflow. No GUI/game
// launch: exercise patchelf + ld.so across relocation.
test("real ELF closure still resolves after moving the AppDir", {
  skip: process.env.TIAO_LINUX_LINK_TEST !== "1",
}, (t) => {
  const work = mkdtempSync(join(tmpdir(), "steam elf "));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const source = join(work, "build-host");
  const root = join(work, "game.AppDir");
  mkdirSync(join(root, "usr/bin"), { recursive: true });
  mkdirSync(source);
  const c = put(join(work, "font.c"), "int font(void) { return 0; }\n");
  for (const name of FONT_LIBRARIES)
    execFileSync("cc", ["-shared", "-fPIC", c, `-Wl,-soname,${name}`, "-o", join(source, name)]);
  const main = put(join(work, "main.c"), "int main(void) { return 0; }\n");
  execFileSync("cc", [
    main,
    "-Wl,--no-as-needed",
    ...FONT_LIBRARIES.map((name) => join(source, name)),
    `-Wl,-rpath,${source}`,
    "-o",
    join(root, "usr/bin/Tiao"),
  ]);
  // Model the build machine's library cache while keeping its absolute build
  // path out of the repaired executable's RPATH.
  const run = (command, args, env = process.env) =>
    execFileSync(command, args, {
      encoding: "utf8",
      env: command === "ldd" ? { ...env, LD_LIBRARY_PATH: source } : env,
    });
  // Use an RPATH (not RUNPATH) for the fixture's host resolver so a repaired
  // bundled dependency takes precedence over the simulated host search path.
  const fixtureRun = (command, args, env) =>
    run(command, command === "patchelf" ? ["--force-rpath", ...args] : args, env);
  prepareLinuxDependencies(root, { run: fixtureRun, retainLicense: () => {} });
  rmSync(source, { recursive: true });
  const moved = join(work, "installed game");
  renameSync(root, moved);
  assert.equal(spawnSync(join(moved, "usr/bin/Tiao")).status, 0);
  prepareLinuxDependencies(moved, { retainLicense: () => {} });
});

test("real WebKit/font closure resolves both reported symbols without bundled drivers", {
  skip: process.env.TIAO_LINUX_LINK_TEST !== "1",
}, (t) => {
  const work = mkdtempSync(join(tmpdir(), "steam webkit "));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const root = join(work, "game.AppDir");
  const binary = join(root, "usr/bin/Tiao");
  mkdirSync(dirname(binary), { recursive: true });
  const source = put(
    join(work, "main.c"),
    `
extern unsigned webkit_get_major_version(void);
extern void hb_ot_metrics_get_position(void);
extern void FT_Get_Color_Glyph_Paint(void);
void (*volatile required_symbols[])(void) = { hb_ot_metrics_get_position, FT_Get_Color_Glyph_Paint };
int main(void) { return webkit_get_major_version() == 0; }
`,
  );
  execFileSync("cc", [
    source,
    "-Wl,--no-as-needed",
    "-l:libwebkit2gtk-4.1.so.0",
    ...FONT_LIBRARIES.map((name) => `-l:${name}`),
    "-o",
    binary,
  ]);
  const original = parseLdd(execFileSync("ldd", [binary], { encoding: "utf8" }));
  // Recreate the defective bundle: WebKit present, fonts absent, a bundled
  // Wayland library that must be removed. Do not launch WebKit or create a UI.
  for (const name of ["libwebkit2gtk-4.1.so.0", "libwayland-client.so.0"])
    copyFileSync(original.get(name), put(join(root, "usr/lib", name), ""));
  const report = prepareLinuxDependencies(root);
  for (const name of FONT_LIBRARIES) assert.ok(report.copied.includes(name), name);
  assert.ok(report.removed.includes("usr/lib/libwayland-client.so.0"));
  assert.ok(report.files.length > FONT_LIBRARIES.length);
  const moved = join(work, "installed game");
  renameSync(root, moved);
  const output = execFileSync("ldd", ["-r", join(moved, "usr/bin/Tiao")], {
    encoding: "utf8",
  });
  assert.doesNotMatch(output, /not found|undefined symbol:/);
  for (const name of FONT_LIBRARIES) assert.ok(parseLdd(output).get(name).startsWith(moved), name);
});
