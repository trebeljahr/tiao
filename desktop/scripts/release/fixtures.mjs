// Test helper: a minimal app.asar in Electron's pickle format.
import { writeFileSync } from "node:fs";

export function writeAsar(path, files, unpacked = []) {
  const header = { files: {} };
  const chunks = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    insert(header, name, { size: data.length, offset: String(offset) });
    chunks.push(data);
    offset += data.length;
  }
  for (const name of unpacked) insert(header, name, { size: 0, unpacked: true });
  const json = Buffer.from(JSON.stringify(header));
  const padded = Math.ceil(json.length / 4) * 4;
  const headerPickle = Buffer.alloc(8 + padded);
  headerPickle.writeUInt32LE(4 + padded, 0);
  headerPickle.writeUInt32LE(json.length, 4);
  json.copy(headerPickle, 8);
  const sizePickle = Buffer.alloc(8);
  sizePickle.writeUInt32LE(4, 0);
  sizePickle.writeUInt32LE(headerPickle.length, 4);
  writeFileSync(path, Buffer.concat([sizePickle, headerPickle, ...chunks]));
}

function insert(header, name, entry) {
  const parts = name.split("/");
  let node = header;
  for (const part of parts.slice(0, -1)) {
    node.files[part] ??= { files: {} };
    node = node.files[part];
  }
  node.files[parts.at(-1)] = entry;
}
