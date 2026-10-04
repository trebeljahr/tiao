import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { describe, test } from "node:test";
import {
  APPLE_MAX_SECRET_TTL_SEC,
  APPLE_ORIGIN,
  APPLE_SECRET_REFRESH_AFTER_SEC,
  buildAppleProviderOptions,
  createAppleClientSecret,
  createAppleClientSecretSource,
  DEFAULT_APPLE_BUNDLE_ID,
  readAppleConfig,
} from "../auth/appleSignIn";
import { getEnabledSocialProviders } from "../auth/socialProviders";

// Throwaway P-256 key, generated per run. Never a real Apple key.
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const env = {
  APPLE_CLIENT_ID: "com.example.tiao.web",
  APPLE_TEAM_ID: "TEAM123456",
  APPLE_KEY_ID: "KEY1234567",
  APPLE_PRIVATE_KEY: pem,
};

function decode(jwt: string) {
  const [h, p, s] = jwt.split(".");
  return {
    header: JSON.parse(Buffer.from(h, "base64url").toString()),
    payload: JSON.parse(Buffer.from(p, "base64url").toString()),
    signingInput: `${h}.${p}`,
    signature: Buffer.from(s, "base64url"),
  };
}

describe("readAppleConfig", () => {
  test("is null when any required variable is missing", () => {
    assert.equal(readAppleConfig({}), null);
    for (const key of Object.keys(env)) {
      assert.equal(readAppleConfig({ ...env, [key]: "" }), null, key);
    }
  });

  test("is null for a key that does not parse", () => {
    const quiet = console.error;
    console.error = () => {};
    try {
      assert.equal(readAppleConfig({ ...env, APPLE_PRIVATE_KEY: "not a key" }), null);
    } finally {
      console.error = quiet;
    }
  });

  test("accepts a single-line key with escaped newlines", () => {
    const config = readAppleConfig({ ...env, APPLE_PRIVATE_KEY: pem.replace(/\n/g, "\\n") });
    assert.ok(config);
    assert.equal(config.appBundleIdentifier, DEFAULT_APPLE_BUNDLE_ID);
  });

  test("honours APPLE_APP_BUNDLE_ID", () => {
    const config = readAppleConfig({ ...env, APPLE_APP_BUNDLE_ID: "com.example.app" });
    assert.equal(config?.appBundleIdentifier, "com.example.app");
  });
});

describe("createAppleClientSecret", () => {
  test("mints an ES256 JWT with Apple's required claims", () => {
    const config = readAppleConfig(env);
    assert.ok(config);
    const jwt = createAppleClientSecret(config, 1_000_000);
    const { header, payload, signingInput, signature } = decode(jwt);

    assert.deepEqual(header, { alg: "ES256", kid: "KEY1234567", typ: "JWT" });
    assert.equal(payload.iss, "TEAM123456");
    assert.equal(payload.sub, "com.example.tiao.web");
    assert.equal(payload.aud, APPLE_ORIGIN);
    assert.equal(payload.iat, 1_000_000);
    assert.ok(payload.exp > payload.iat);
    assert.ok(payload.exp - payload.iat <= APPLE_MAX_SECRET_TTL_SEC);

    assert.equal(signature.length, 64, "raw r||s signature");
    assert.ok(
      verify(
        "sha256",
        Buffer.from(signingInput),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        signature,
      ),
    );
  });

  test("never exceeds Apple's six-month limit", () => {
    const config = readAppleConfig(env);
    assert.ok(config);
    const { payload } = decode(createAppleClientSecret(config, 0, 10 * APPLE_MAX_SECRET_TTL_SEC));
    assert.equal(payload.exp, APPLE_MAX_SECRET_TTL_SEC);
  });
});

describe("createAppleClientSecretSource", () => {
  test("reuses the secret until it is due for refresh, then re-mints", () => {
    const config = readAppleConfig(env);
    assert.ok(config);
    let now = 5_000;
    const get = createAppleClientSecretSource(config, () => now);
    const first = get();
    now += APPLE_SECRET_REFRESH_AFTER_SEC - 1;
    assert.equal(get(), first);
    now += 1;
    const second = get();
    assert.notEqual(second, first);
    assert.equal(decode(second).payload.iat, now);
  });
});

describe("buildAppleProviderOptions", () => {
  test("is disabled without config", () => {
    assert.equal(buildAppleProviderOptions(null).enabled, false);
  });

  test("exposes a live clientSecret getter and both audiences", () => {
    const options = buildAppleProviderOptions(readAppleConfig(env));
    assert.equal(options.enabled, true);
    assert.equal(decode(options.clientSecret).payload.sub, "com.example.tiao.web");
    assert.deepEqual((options as { audience?: string[] }).audience, [
      "com.example.tiao.web",
      DEFAULT_APPLE_BUNDLE_ID,
    ]);
  });
});

describe("getEnabledSocialProviders", () => {
  test("lists only configured providers, Apple first", () => {
    assert.deepEqual(getEnabledSocialProviders({}), []);
    assert.deepEqual(
      getEnabledSocialProviders({ ...env, GOOGLE_CLIENT_ID: "g", DISCORD_CLIENT_ID: "d" }),
      ["apple", "google", "discord"],
    );
  });
});
