import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkVersions, readVersion, versionFiles, writeVersion } from "./version.mjs";

test("the repository states one stable version", () => {
  assert.doesNotThrow(() => checkVersions(versionFiles.map((file) => readFileSync(file, "utf8"))));
});

test("writing a version touches only the top-level field and keeps formatting", () => {
  const text = '{\n  "name": "x",\n  "version": "0.1.0",\n  "dependencies": { "a": "1.0.0" }\n}\n';
  const next = writeVersion(text, "0.2.0");
  assert.equal(readVersion(next), "0.2.0");
  assert.equal(next.replace("0.2.0", "0.1.0"), text);
  assert.throws(() => writeVersion(text, "0.2"));
  assert.throws(() => writeVersion('{"name":"x"}', "0.2.0"));
});

test("drift between files is an error", () => {
  const pkg = (value) => '{\n  "version": "' + value + '"\n}\n';
  assert.throws(() => checkVersions([pkg("0.1.0"), pkg("0.2.0")]), /disagree/);
  assert.throws(() => checkVersions([pkg("0.1.0-beta")]), /stable/);
});
