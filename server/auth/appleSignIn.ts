import { createPrivateKey, type KeyObject, sign } from "node:crypto";

/**
 * Sign in with Apple configuration.
 *
 * Apple does not issue a static OAuth client secret. The secret is an
 * ES256 JWT signed with a `.p8` key from the Apple Developer portal,
 * valid for at most six months. We mint it at boot from the key and
 * re-mint it lazily before it ages out, so a long-running server never
 * presents an expired secret.
 *
 * Env:
 *   APPLE_CLIENT_ID        Services ID (e.g. com.ricoslabs.tiao.signin) — the
 *                          OAuth client_id for the web flow
 *   APPLE_TEAM_ID          10-char Apple Developer Team ID
 *   APPLE_KEY_ID           Key ID of the Sign in with Apple .p8 key
 *   APPLE_PRIVATE_KEY      Contents of the .p8 file (PEM). Literal "\n"
 *                          sequences are accepted for single-line env files.
 *   APPLE_APP_BUNDLE_ID    Optional. Native app bundle ID accepted as an ID
 *                          token audience. Default com.ricoslabs.tiao.
 */

/** Apple rejects client secrets that live longer than 6 months. */
export const APPLE_MAX_SECRET_TTL_SEC = 15_777_000;
/** Lifetime we mint with — well inside Apple's limit. */
export const APPLE_SECRET_TTL_SEC = 60 * 60 * 24 * 90;
/** Re-mint once the current secret is this old. */
export const APPLE_SECRET_REFRESH_AFTER_SEC = 60 * 60 * 24 * 30;

export const DEFAULT_APPLE_BUNDLE_ID = "com.ricoslabs.tiao";
export const APPLE_ORIGIN = "https://appleid.apple.com";

export type AppleConfig = {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: KeyObject;
  appBundleIdentifier: string;
};

type Env = Record<string, string | undefined>;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Parse Apple settings from the environment. Returns null — Apple sign-in
 * disabled — when any required value is missing or the key does not parse.
 */
export function readAppleConfig(env: Env = process.env): AppleConfig | null {
  const clientId = env.APPLE_CLIENT_ID?.trim();
  const teamId = env.APPLE_TEAM_ID?.trim();
  const keyId = env.APPLE_KEY_ID?.trim();
  const rawKey = env.APPLE_PRIVATE_KEY;
  if (!clientId || !teamId || !keyId || !rawKey) return null;

  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(rawKey.replace(/\\n/g, "\n"));
  } catch (err) {
    console.error(
      "[auth] APPLE_PRIVATE_KEY is not a valid PEM key; Sign in with Apple is off.",
      err,
    );
    return null;
  }
  if (privateKey.asymmetricKeyType !== "ec") {
    console.error("[auth] APPLE_PRIVATE_KEY must be the EC (.p8) key; Sign in with Apple is off.");
    return null;
  }

  return {
    clientId,
    teamId,
    keyId,
    privateKey,
    appBundleIdentifier: env.APPLE_APP_BUNDLE_ID?.trim() || DEFAULT_APPLE_BUNDLE_ID,
  };
}

/**
 * Mint the client-secret JWT Apple's token endpoint expects.
 * https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret
 */
export function createAppleClientSecret(
  config: Pick<AppleConfig, "clientId" | "teamId" | "keyId" | "privateKey">,
  nowSec: number = Math.floor(Date.now() / 1000),
  ttlSec: number = APPLE_SECRET_TTL_SEC,
): string {
  const header = { alg: "ES256", kid: config.keyId, typ: "JWT" };
  const payload = {
    iss: config.teamId,
    iat: nowSec,
    exp: nowSec + Math.min(ttlSec, APPLE_MAX_SECRET_TTL_SEC),
    aud: APPLE_ORIGIN,
    sub: config.clientId,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  // JWS ES256 wants the raw r||s signature, not DER.
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: config.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${base64url(signature)}`;
}

/**
 * Returns a function that hands out a valid client secret, re-minting it
 * once the cached one is older than APPLE_SECRET_REFRESH_AFTER_SEC.
 */
export function createAppleClientSecretSource(
  config: AppleConfig,
  now: () => number = () => Math.floor(Date.now() / 1000),
): () => string {
  let mintedAt = now();
  let secret = createAppleClientSecret(config, mintedAt);
  return () => {
    const current = now();
    if (current - mintedAt >= APPLE_SECRET_REFRESH_AFTER_SEC) {
      mintedAt = current;
      secret = createAppleClientSecret(config, mintedAt);
    }
    return secret;
  };
}

/**
 * Better Auth `socialProviders.apple` options. `clientSecret` is a getter:
 * Better Auth reads `options.clientSecret` on every authorize / token call,
 * so each read gets a fresh-enough JWT without restarting the server.
 */
export function buildAppleProviderOptions(config: AppleConfig | null) {
  if (!config) {
    return { clientId: "", clientSecret: "", enabled: false };
  }
  const getSecret = createAppleClientSecretSource(config);
  return {
    clientId: config.clientId,
    get clientSecret() {
      return getSecret();
    },
    enabled: true,
    appBundleIdentifier: config.appBundleIdentifier,
    // Accept ID tokens minted for the web Services ID and the native app.
    audience: [config.clientId, config.appBundleIdentifier],
  };
}
