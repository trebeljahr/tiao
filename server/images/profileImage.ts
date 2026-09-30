import { Worker } from "node:worker_threads";

export const MAX_IMAGE_DIMENSION = 2048;
export const MAX_IMAGE_PIXELS = 4_000_000;
const MAX_BYTES = 512 * 1024;
const MAX_WORKERS = 2;
let activeWorkers = 0;

export class ProfileImageError extends Error {
  constructor(
    message: string,
    public readonly status = 415,
  ) {
    super(message);
  }
}

export function checkDimensions(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new ProfileImageError("Image exceeds the 2048-pixel side or 4-megapixel limit.");
  }
}

/** Structural inspection only: never inflates or decodes compressed image data. */
export function inspectProfileImage(b: Buffer): { mime: string; width: number; height: number } {
  const invalid = () => {
    throw new ProfileImageError(
      "Use a valid, single-frame JPEG, non-interlaced PNG, or GIF image.",
    );
  };
  const need = (offset: number, count: number) => {
    if (offset < 0 || offset + count > b.length) invalid();
  };
  if (!b.length || b.length > MAX_BYTES) invalid();
  const result = (mime: string, width: number, height: number) => {
    checkDimensions(width, height);
    return { mime, width, height };
  };
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    let offset = 8;
    let width = 0,
      height = 0,
      headers = 0;
    let hasData = false;
    while (offset < b.length) {
      need(offset, 12);
      const size = b.readUInt32BE(offset);
      const type = b.toString("ascii", offset + 4, offset + 8);
      need(offset, size + 12);
      if (!headers && type !== "IHDR") invalid();
      if (type === "IHDR") {
        if (++headers !== 1 || size !== 13) invalid();
        width = b.readUInt32BE(offset + 8);
        height = b.readUInt32BE(offset + 12);
        checkDimensions(width, height);
        // pngjs uses unbounded zlib.inflateSync for interlaced input.
        if (b[offset + 20] !== 0) invalid();
      }
      if (["acTL", "fcTL", "fdAT"].includes(type)) invalid();
      if (type === "IDAT") hasData = true;
      offset += size + 12;
      if (type === "IEND") {
        if (size !== 0 || !hasData || offset !== b.length) invalid();
        return result("image/png", width, height);
      }
    }
    return invalid();
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let offset = 2,
      frames = 0,
      scans = 0,
      width = 0,
      height = 0;
    while (offset < b.length) {
      if (b[offset++] !== 0xff) invalid();
      while (b[offset] === 0xff) offset++;
      need(offset, 1);
      const marker = b[offset++];
      if (marker === 0xd9) {
        if (frames !== 1 || !scans || offset !== b.length) invalid();
        return result("image/jpeg", width, height);
      }
      need(offset, 2);
      const size = b.readUInt16BE(offset);
      if (size < 2) invalid();
      need(offset, size);
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (++frames !== 1 || size < 8) invalid();
        height = b.readUInt16BE(offset + 3);
        width = b.readUInt16BE(offset + 5);
        checkDimensions(width, height);
      } else if (
        (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) ||
        marker === 0xdc
      ) {
        invalid();
      }
      offset += size;
      if (marker === 0xda) {
        if (!frames || ++scans > 32) invalid();
        // Skip entropy-coded bytes without decoding. Escaped FF and restart
        // markers belong to the scan; all other markers return to the parser.
        while (offset < b.length) {
          if (b[offset] !== 0xff) {
            offset++;
            continue;
          }
          const next = b[offset + 1];
          if (next === 0 || (next >= 0xd0 && next <= 0xd7)) {
            offset += 2;
            continue;
          }
          break;
        }
      }
    }
    return invalid();
  }
  if (["GIF87a", "GIF89a"].includes(b.toString("ascii", 0, 6))) {
    need(0, 13);
    const width = b.readUInt16LE(6),
      height = b.readUInt16LE(8);
    checkDimensions(width, height);
    let offset = 13 + (b[10] & 0x80 ? 3 * (1 << ((b[10] & 7) + 1)) : 0);
    let frames = 0;
    const skipBlocks = () => {
      while (true) {
        need(offset, 1);
        const size = b[offset++];
        if (!size) return;
        need(offset, size);
        offset += size;
      }
    };
    while (offset < b.length) {
      const tag = b[offset++];
      if (tag === 0x3b) {
        if (frames !== 1 || offset !== b.length) invalid();
        return result("image/gif", width, height);
      }
      if (tag === 0x21) {
        need(offset++, 1);
        skipBlocks();
        continue;
      }
      if (tag !== 0x2c || ++frames !== 1) invalid();
      need(offset, 9);
      const left = b.readUInt16LE(offset),
        top = b.readUInt16LE(offset + 2);
      const w = b.readUInt16LE(offset + 4),
        h = b.readUInt16LE(offset + 6);
      checkDimensions(w, h);
      if (left + w > width || top + h > height) invalid();
      const packed = b[offset + 8];
      offset += 9 + (packed & 0x80 ? 3 * (1 << ((packed & 7) + 1)) : 0);
      need(offset++, 1); // LZW code size; decoder validates it.
      skipBlocks();
    }
  }
  return invalid();
}

// A fixed program, not input-derived code. Only a bounded buffer and the
// resolved library path are passed. Environment and runtime hooks are cleared.
const DECODE_WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const { Jimp } = require(workerData.jimp);
  const image = await Jimp.read(Buffer.from(workerData.bytes), {
    'image/jpeg': { maxResolutionInMP: 4, maxMemoryUsageInMB: 64 }
  });
  if (image.bitmap.width > 2048 || image.bitmap.height > 2048 || image.bitmap.width * image.bitmap.height > 4000000) throw new Error('dimensions');
  image.scaleToFit({ w: 320, h: 320 });
  parentPort.postMessage(await image.getBuffer('image/jpeg'));
})().catch(() => { process.exitCode = 1; });
`;

export async function processProfileImage(bytes: Buffer): Promise<Buffer> {
  inspectProfileImage(bytes);
  if (activeWorkers >= MAX_WORKERS)
    throw new ProfileImageError("Image processing is busy. Try again shortly.", 503);
  activeWorkers++;
  let worker: Worker | undefined;
  try {
    worker = new Worker(DECODE_WORKER, {
      eval: true,
      env: {},
      execArgv: [],
      workerData: { bytes, jimp: require.resolve("jimp") },
      resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    const current = worker;
    return await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new ProfileImageError("Image processing timed out.")),
        5000,
      );
      const fail = () => {
        clearTimeout(timer);
        reject(new ProfileImageError("Unable to decode this image."));
      };
      current.once("error", fail);
      current.once("exit", fail);
      current.once("message", (output: unknown) => {
        clearTimeout(timer);
        if (!(output instanceof Uint8Array) || output.length > MAX_BYTES) return fail();
        resolve(Buffer.from(output));
      });
    });
  } finally {
    if (worker) await worker.terminate();
    activeWorkers--;
  }
}
