import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { stageLinuxRuntime } from "./linux-steam-runtime.mjs";

function put(root, path, text = "fixture") {
  const dest = join(root, path);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, text);
  return dest;
}
function appdir(root, resources = true) {
  for (const file of ["AppRun", "usr/bin/Tiao"]) chmodSync(put(root, file), 0o755);
  for (const file of [
    "libwebkit2gtk-4.1.so.0",
    "libjavascriptcoregtk-4.1.so.0",
    "libsoup-3.0.so.0",
    "libgstmpg123.so",
  ])
    put(root, `usr/lib/${file}`);
  if (resources)
    for (const file of ["audio/song.mp3", "models/game.glb"])
      put(root, `usr/lib/game/${file}`, "bundled");
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "linux runtime-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const imageDir = join(root, "bundle with spaces");
  mkdirSync(imageDir);
  put(imageDir, "Game.AppImage");
  const kept = join(imageDir, "Game.AppDir");
  const audioDir = join(root, "staged audio");
  const modelsDir = join(root, "models");
  put(audioDir, "song.mp3", "staged");
  put(modelsDir, "game.glb", "staged");
  let extractions = 0;
  const run = (prepareDependencies = () => {}) =>
    stageLinuxRuntime({
      imageDir,
      outputDir: join(root, "portable"),
      audioDir,
      modelsDir,
      prepareDependencies,
      extract: (_image, work) => {
        extractions++;
        appdir(join(work, "squashfs-root"));
      },
    });
  return { root, imageDir, kept, run, extractions: () => extractions };
}
test("complete retained AppDir avoids extraction", (t) => {
  const f = fixture(t);
  appdir(f.kept);
  const out = f.run();
  assert.equal(f.extractions(), 0);
  assert.equal(readFileSync(join(out, "usr/bin/Tiao"), "utf8"), "fixture");
});
test("internal absolute links become relative before relocation", (t) => {
  const f = fixture(t);
  appdir(f.kept);
  const icon = put(f.kept, "usr/share/game.png");
  symlinkSync(icon, join(f.kept, ".DirIcon"));
  const out = f.run();
  assert.equal(readlinkSync(join(out, ".DirIcon")), "usr/share/game.png");
  assert.equal(readFileSync(join(out, ".DirIcon"), "utf8"), "fixture");
});
for (const failure of ["missing", "incomplete", "external-link"]) {
  test(`${failure} retained runtime uses extraction and the same portable runtime`, (t) => {
    const f = fixture(t);
    if (failure !== "missing") appdir(f.kept);
    if (failure === "incomplete") rmSync(join(f.kept, "usr/lib/libgstmpg123.so"));
    if (failure === "external-link") symlinkSync("/usr/lib", join(f.kept, "external"));
    const out = f.run();
    assert.equal(f.extractions(), 1);
    assert.ok(existsSync(join(out, "usr/bin/Tiao")));
  });
}
test("embedded frontend needs no external model or audio folders", (t) => {
  const f = fixture(t);
  appdir(f.kept, false);
  const out = f.run();
  assert.equal(readFileSync(join(out, "usr/bin/Tiao"), "utf8"), "fixture");
});
test("ambiguous retained AppDirs fail", (t) => {
  const f = fixture(t);
  appdir(f.kept);
  appdir(join(f.imageDir, "Other.AppDir"));
  assert.throws(f.run, /at most one/);
});

for (const retained of [true, false]) {
  test(`dependency repair runs after resource staging (${retained ? "retained" : "extracted"}) and failures stop packaging`, (t) => {
    const f = fixture(t);
    if (retained) appdir(f.kept);
    assert.throws(
      () =>
        f.run((root) => {
          assert.ok(existsSync(join(root, "usr/bin/Tiao")));
          assert.ok(existsSync(join(root, "usr/bin/Tiao")));
          throw new Error("broken ELF dependency");
        }),
      /broken ELF dependency/,
    );
  });
}

test("extracted AppDir absolute internal links are relocated too", (t) => {
  const f = fixture(t);
  const out = stageLinuxRuntime({
    imageDir: f.imageDir,
    outputDir: join(f.root, "portable"),
    audioDir: join(f.root, "staged audio"),
    modelsDir: join(f.root, "models"),
    prepareDependencies: () => {},
    extract: (_image, work) => {
      const extracted = join(work, "squashfs-root");
      appdir(extracted);
      const icon = put(extracted, "usr/share/game.png");
      symlinkSync(icon, join(extracted, ".DirIcon"));
    },
  });
  assert.equal(readlinkSync(join(out, ".DirIcon")), "usr/share/game.png");
  assert.equal(readFileSync(join(out, ".DirIcon"), "utf8"), "fixture");
});
