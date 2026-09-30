import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import type { Request, Response } from "express";
import { MAX_FILE_SIZE, profilePictureUpload } from "../middleware/multerUploadMiddleware";

function upload(body: Buffer, boundary = "test-boundary"): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = Readable.from([body]) as unknown as Request;
    req.headers = {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(body.length),
    };
    let status = 200;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json() {
        resolve(status);
      },
    } as unknown as Response;
    profilePictureUpload("profilePicture")(req, res, (err) =>
      err ? reject(err) : resolve(status),
    );
  });
}
function file(data: Buffer, name = "profilePicture") {
  return Buffer.concat([
    Buffer.from(
      `--test-boundary\r\nContent-Disposition: form-data; name="${name}"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    data,
    Buffer.from("\r\n--test-boundary--\r\n"),
  ]);
}
test("single bounded image upload succeeds", async () => {
  assert.equal(await upload(file(Buffer.from("image"))), 200);
});
test("oversized and unexpected files fail", async () => {
  assert.equal(await upload(file(Buffer.alloc(MAX_FILE_SIZE + 1))), 413);
  assert.equal(await upload(file(Buffer.from("image"), "other")), 415);
});
test("text fields, including large indexes and nested names, are rejected", async () => {
  for (const name of ["field", "field[999999999]", "a[b][c]", "__proto__[x]"]) {
    assert.equal(
      await upload(
        Buffer.from(
          `--test-boundary\r\nContent-Disposition: form-data; name="${name}"\r\n\r\nx\r\n--test-boundary--\r\n`,
        ),
      ),
      400,
    );
  }
});
test("malformed multipart fails without throwing", async () => {
  assert.equal(await upload(Buffer.from("--test-boundary\r\ninvalid")), 400);
});
test("multiple file parts are rejected", async () => {
  const first = file(Buffer.from("image")).toString().replace("--test-boundary--\r\n", "");
  assert.equal(await upload(Buffer.concat([Buffer.from(first), file(Buffer.from("image"))])), 400);
});
