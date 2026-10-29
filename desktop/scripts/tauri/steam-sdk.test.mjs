import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadArchive, prepareSdk, SDK_FILES, selectTarFiles, unpackSdk } from "./steam-sdk.mjs";

function archiveEntry(path, bytes, type = "0") {
  const header = Buffer.alloc(512);
  header.write(path, 0, 100);
  header.write(`${bytes.length.toString(8).padStart(11, "0")}\0`, 124, 12);
  header.write(type, 156, 1);
  header.fill(32, 148, 156);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  const payload = Buffer.alloc(Math.ceil(bytes.length / 512) * 512);
  bytes.copy(payload);
  return Buffer.concat([header, payload]);
}

test("select only exact SDK paths; unrelated and traversal paths never become output", () => {
  const entry = SDK_FILES.windows.entry;
  const dll = Buffer.from("test dll");
  const tar = Buffer.concat([
    archiveEntry("../../malicious.dll", Buffer.from("no")),
    archiveEntry(`${entry}.unexpected`, Buffer.from("no")),
    archiveEntry(entry, dll),
    Buffer.alloc(1024),
  ]);
  assert.deepEqual([...selectTarFiles(tar, [entry])], [[entry, dll]]);
});

test("SDK symlinks, duplicate entries, missing files and empty libraries fail closed", () => {
  const entry = SDK_FILES.linux.entry;
  const bytes = Buffer.from("library");
  assert.throws(() => selectTarFiles(archiveEntry(entry, bytes, "2"), [entry]), /regular file/);
  assert.throws(
    () =>
      selectTarFiles(Buffer.concat([archiveEntry(entry, bytes), archiveEntry(entry, bytes)]), [
        entry,
      ]),
    /Duplicate/,
  );
  assert.throws(() => selectTarFiles(Buffer.alloc(1024), [entry]), /Missing/);
  assert.throws(() => selectTarFiles(archiveEntry(entry, Buffer.alloc(0)), [entry]), /Empty/);
});

test("malformed tar data fails before any file is written", () => {
  const entry = SDK_FILES.macos.entry;
  const tar = archiveEntry(entry, Buffer.from("library"));
  assert.throws(() => selectTarFiles(tar.subarray(0, 200), [entry]), /Truncated/);
  assert.throws(() => selectTarFiles(tar.subarray(0, 515), [entry]), /Truncated/);
  tar[0] ^= 1;
  assert.throws(() => selectTarFiles(tar, [entry]), /checksum/);
});

test("download checksum is verified before parsing an untrusted archive", () => {
  assert.throws(() => unpackSdk(Buffer.from("untrusted gzip"), ["windows"]), /checksum mismatch/);
});

test("unsupported platforms fail before downloading or writing anything", async () => {
  await assert.rejects(prepareSdk("android", "/unused"), /Unsupported platform/);
});

test("a cached archive with the pinned digest is used without downloading", async () => {
  const dir = await mkdtemp(join(tmpdir(), "steam-sdk-"));
  try {
    const good = Buffer.from("pinned archive");
    const expected = createHash("sha256").update(good).digest("hex");
    const cachePath = join(dir, "sdk.crate");
    let downloads = 0;
    const download = async () => {
      downloads += 1;
      return good;
    };
    assert.deepEqual(await loadArchive(cachePath, { download, expected }), good);
    assert.deepEqual(await readFile(cachePath), good);
    assert.deepEqual(await loadArchive(cachePath, { download, expected }), good);
    assert.equal(downloads, 1);

    // A corrupted cache entry is replaced, never trusted.
    await writeFile(cachePath, "tampered");
    assert.deepEqual(await loadArchive(cachePath, { download, expected }), good);
    assert.equal(downloads, 2);
    assert.deepEqual(await readFile(cachePath), good);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a download with the wrong digest fails and is not cached", async () => {
  const dir = await mkdtemp(join(tmpdir(), "steam-sdk-"));
  try {
    const cachePath = join(dir, "sdk.crate");
    await assert.rejects(
      loadArchive(cachePath, {
        download: async () => Buffer.from("other"),
        expected: "0".repeat(64),
      }),
      /checksum mismatch/,
    );
    await assert.rejects(readFile(cachePath), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
