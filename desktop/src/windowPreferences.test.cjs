// @ts-check
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createWindowPreferences } = require("./windowPreferences.cjs");

test("fullscreen defaults on and restores either choice across launches", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tiao-window-preferences-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const preferences = createWindowPreferences(path.join(dir, "profile"));
  assert.equal(preferences.getFullScreen(), true);
  preferences.setFullScreen(false);
  const nextLaunch = createWindowPreferences(path.join(dir, "profile"));
  assert.equal(nextLaunch.getFullScreen(), false);
  nextLaunch.setFullScreen(true);
  assert.equal(createWindowPreferences(path.join(dir, "profile")).getFullScreen(), true);
});

test("invalid or damaged preferences fall back to fullscreen", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tiao-window-preferences-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const preferences = createWindowPreferences(dir);
  for (const contents of ["{", "null", "{}", '{"fullScreen":"false"}']) {
    fs.writeFileSync(path.join(dir, "window-preferences.json"), contents);
    assert.equal(preferences.getFullScreen(), true);
  }
  preferences.setFullScreen(false);
  assert.equal(preferences.getFullScreen(), false);
});
