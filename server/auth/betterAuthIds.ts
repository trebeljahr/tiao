import { ObjectId } from "mongodb";

const OBJECT_ID_HEX = /^[a-f0-9]{24}$/i;

export type BetterAuthUserLike = {
  id: unknown;
  name?: unknown;
  email?: unknown;
  image?: unknown;
  isAnonymous?: unknown;
  displayName?: unknown;
};

export type NormalizedAuthUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  isAnonymous?: boolean | null;
  displayName?: string | null;
};

function bytesToHex(value: unknown): string | null {
  const bytes =
    value instanceof Uint8Array
      ? Array.from(value)
      : Array.isArray(value)
        ? value
        : null;

  if (!bytes || bytes.length !== 12) return null;
  if (!bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) return null;

  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeAuthId(value: unknown): string | null {
  if (typeof value === "string") return value || null;

  const directBytes = bytesToHex(value);
  if (directBytes) return directBytes;

  if (!value || typeof value !== "object") return null;

  const toHexString = (value as { toHexString?: unknown }).toHexString;
  if (typeof toHexString === "function") {
    try {
      const hex = toHexString.call(value);
      if (typeof hex === "string") return hex;
    } catch {
      return null;
    }
  }

  const bufferBytes = bytesToHex((value as { buffer?: unknown }).buffer);
  if (bufferBytes) return bufferBytes;

  const idBytes = bytesToHex((value as { id?: unknown }).id);
  if (idBytes) return idBytes;

  const toString = (value as { toString?: unknown }).toString;
  if (typeof toString === "function" && toString !== Object.prototype.toString) {
    const text = toString.call(value);
    if (typeof text === "string" && OBJECT_ID_HEX.test(text)) return text;
  }

  return null;
}

export function betterAuthIdFilter(value: unknown): string | { $in: [string, ObjectId] } | null {
  const id = normalizeAuthId(value);
  if (!id) return null;
  return OBJECT_ID_HEX.test(id) ? { $in: [id, new ObjectId(id)] } : id;
}

export function normalizeAuthUser(user: BetterAuthUserLike): NormalizedAuthUser | null {
  const id = normalizeAuthId(user.id);
  if (!id) return null;

  return {
    id,
    name: typeof user.name === "string" ? user.name : "",
    email: typeof user.email === "string" ? user.email : "",
    image: typeof user.image === "string" ? user.image : null,
    isAnonymous: user.isAnonymous === true ? true : null,
    displayName: typeof user.displayName === "string" ? user.displayName : null,
  };
}
