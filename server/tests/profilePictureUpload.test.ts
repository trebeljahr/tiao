import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";

process.env.TOKEN_SECRET ??= "test-token-secret";
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/tiao-test";
process.env.S3_BUCKET_NAME ??= "tiao-test-assets";
process.env.S3_PUBLIC_URL ??= "https://assets.test.local";

import express from "express";
import { profilePictureUpload, MAX_FILE_SIZE } from "../middleware/multerUploadMiddleware";

function buildApp() {
  const app = express();
  app.post("/upload", profilePictureUpload("profilePicture"), (_req, res) => {
    res.status(200).json({ message: "ok" });
  });
  return app;
}

function buildMultipartBody(
  fieldName: string,
  fileName: string,
  contentType: string,
  content: Buffer,
): { body: Buffer; boundary: string } {
  const boundary = "----TestBoundary" + Date.now();
  const parts = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\n`,
    `Content-Type: ${contentType}\r\n\r\n`,
  ];
  const header = Buffer.from(parts.join(""));
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    body: Buffer.concat([header, content, footer]),
    boundary,
  };
}

async function sendUpload(
  port: number,
  fieldName: string,
  fileName: string,
  contentType: string,
  content: Buffer,
): Promise<{ status: number; body: { message: string } }> {
  const { body, boundary } = buildMultipartBody(fieldName, fileName, contentType, content);

  const response = await fetch(`http://127.0.0.1:${port}/upload`, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  const json = (await response.json()) as { message: string };
  return { status: response.status, body: json };
}

describe("profilePictureUpload middleware", () => {
  test("accepts a small JPEG image", async () => {
    const app = buildApp();
    const server = createServer(app);
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;

    try {
      const smallImage = Buffer.alloc(1024, 0xff);
      const result = await sendUpload(
        port,
        "profilePicture",
        "avatar.jpg",
        "image/jpeg",
        smallImage,
      );
      assert.equal(result.status, 200);
      assert.equal(result.body.message, "ok");
    } finally {
      server.close();
    }
  });

  test("accepts PNG images", async () => {
    const app = buildApp();
    const server = createServer(app);
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;

    try {
      const smallImage = Buffer.alloc(1024, 0xff);
      const result = await sendUpload(
        port,
        "profilePicture",
        "avatar.png",
        "image/png",
        smallImage,
      );
      assert.equal(result.status, 200);
    } finally {
      server.close();
    }
  });

  test("rejects files exceeding size limit with 413", async () => {
    const app = buildApp();
    const server = createServer(app);
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;

    try {
      const oversizedImage = Buffer.alloc(MAX_FILE_SIZE + 1, 0xff);
      const result = await sendUpload(
        port,
        "profilePicture",
        "huge.jpg",
        "image/jpeg",
        oversizedImage,
      );
      assert.equal(result.status, 413);
      assert.match(result.body.message, /too large/i);
      assert.match(result.body.message, /512KB/);
    } finally {
      server.close();
    }
  });

  test("rejects SVG files with 415", async () => {
    const app = buildApp();
    const server = createServer(app);
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;

    try {
      const svgContent = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      );
      const result = await sendUpload(
        port,
        "profilePicture",
        "evil.svg",
        "image/svg+xml",
        svgContent,
      );
      assert.equal(result.status, 415);
      assert.match(result.body.message, /unsupported file type/i);
    } finally {
      server.close();
    }
  });

  test("rejects non-image files with 415", async () => {
    const app = buildApp();
    const server = createServer(app);
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;

    try {
      const textContent = Buffer.from("not an image");
      const result = await sendUpload(
        port,
        "profilePicture",
        "readme.txt",
        "text/plain",
        textContent,
      );
      assert.equal(result.status, 415);
      assert.match(result.body.message, /unsupported file type/i);
      assert.match(result.body.message, /JPEG.*PNG.*WebP.*GIF/i);
    } finally {
      server.close();
    }
  });

  test("rejects application/pdf with 415", async () => {
    const app = buildApp();
    const server = createServer(app);
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;

    try {
      const pdfContent = Buffer.from("%PDF-1.4 fake pdf content");
      const result = await sendUpload(
        port,
        "profilePicture",
        "doc.pdf",
        "application/pdf",
        pdfContent,
      );
      assert.equal(result.status, 415);
    } finally {
      server.close();
    }
  });
});
