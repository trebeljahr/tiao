import { createPublicKey, type KeyObject, verify } from "node:crypto";

/**
 * Discord signs every interaction request with the application's Ed25519
 * key. The public half is shown as 64 hex chars in the Developer Portal;
 * node:crypto wants it wrapped in a SubjectPublicKeyInfo DER envelope,
 * which for Ed25519 is a fixed 12-byte prefix in front of the raw key.
 */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const ED25519_KEY_BYTES = 32;

export function parseDiscordPublicKey(hex: string): KeyObject {
  const trimmed = hex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error("DISCORD_PUBLIC_KEY must be 64 hex characters");
  }
  const raw = Buffer.from(trimmed, "hex");
  if (raw.length !== ED25519_KEY_BYTES) {
    throw new Error("DISCORD_PUBLIC_KEY must decode to 32 bytes");
  }
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

/**
 * Verify `X-Signature-Ed25519` over `timestamp + rawBody`. Returns false
 * on any malformed input instead of throwing so the route can answer 401
 * uniformly.
 */
export function verifyDiscordSignature(
  publicKey: KeyObject,
  signatureHex: string | undefined,
  timestamp: string | undefined,
  rawBody: Buffer,
): boolean {
  if (!signatureHex || !timestamp) return false;
  if (!/^[0-9a-fA-F]{128}$/.test(signatureHex)) return false;
  try {
    const message = Buffer.concat([Buffer.from(timestamp, "utf8"), rawBody]);
    return verify(null, message, publicKey, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}
