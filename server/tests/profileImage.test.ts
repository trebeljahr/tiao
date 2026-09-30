import assert from "node:assert/strict";
import { test } from "node:test";
import { Jimp } from "jimp";
import { checkDimensions, inspectProfileImage, processProfileImage } from "../images/profileImage";

test("dimension budgets are checked using scalar metadata only", () => {
  checkDimensions(100, 100);
  checkDimensions(2000, 2000);
  for (const [w, h] of [
    [0, 1],
    [1, 0],
    [2049, 1],
    [2048, 2048],
    [-1, 10],
  ])
    assert.throws(() => checkDimensions(w, h));
});

test("ordinary tiny JPEG/PNG/GIF images pass preflight; output fits both sides", async () => {
  const input = new Jimp({ width: 8, height: 12, color: 0xff0000ff });
  for (const mime of ["image/jpeg", "image/png", "image/gif"] as const) {
    const bytes = await input.getBuffer(mime);
    assert.deepEqual(inspectProfileImage(bytes), { mime, width: 8, height: 12 });
    if (mime === "image/png") {
      const output = await processProfileImage(bytes);
      const decoded = await Jimp.read(output);
      assert.ok(decoded.width <= 320 && decoded.height <= 320);
    }
  }
});

test("truncated or unsupported input is rejected before decode", () => {
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.from("ordinary text"),
    Buffer.from("GIF89a"),
    Buffer.from([255, 216]),
  ]) {
    assert.throws(() => inspectProfileImage(bytes));
  }
});
