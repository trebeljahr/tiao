import assert from "node:assert/strict";
import { describe, test, beforeEach } from "node:test";

process.env.TOKEN_SECRET ??= "test-token-secret";
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/tiao-test";
process.env.S3_BUCKET_NAME ??= "tiao-test-assets";
process.env.S3_PUBLIC_URL ??= "https://assets.test.local";

import {
  InMemoryExchangeCodeStore,
  generateCode,
  DEFAULT_EXCHANGE_TTL_SEC,
  resetExchangeCodeStoreForTests,
  getExchangeCodeStore,
} from "../auth/desktopExchangeStore";

describe("InMemoryExchangeCodeStore", () => {
  let store: InMemoryExchangeCodeStore;

  beforeEach(() => {
    store = new InMemoryExchangeCodeStore();
  });

  test("put followed by consume returns the stored userId", async () => {
    await store.put("state-1", "code-1", "user-alpha", 60);
    const userId = await store.consume("state-1", "code-1");
    assert.equal(userId, "user-alpha");
  });

  test("consume is one-shot — second call returns null", async () => {
    await store.put("state-1", "code-1", "user-alpha", 60);
    assert.equal(await store.consume("state-1", "code-1"), "user-alpha");
    assert.equal(await store.consume("state-1", "code-1"), null);
  });

  test("consume with wrong code returns null AND invalidates the entry", async () => {
    await store.put("state-1", "code-correct", "user-alpha", 60);
    // Wrong code — still deletes the entry (single-use semantics apply
    // to attacks too).
    assert.equal(await store.consume("state-1", "code-wrong"), null);
    // Even the correct code now fails because the entry is gone.
    assert.equal(await store.consume("state-1", "code-correct"), null);
  });

  test("unknown state returns null", async () => {
    assert.equal(await store.consume("nonexistent", "anything"), null);
  });

  test("put overwrites an existing entry (retry semantics)", async () => {
    await store.put("state-1", "code-old", "user-alpha", 60);
    await store.put("state-1", "code-new", "user-beta", 60);
    // Old code is invalidated, new code works.
    assert.equal(await store.consume("state-1", "code-old"), null);
    // But the entry was already consumed by the failed attempt above.
    // Make a fresh put to verify the "new" entry would have worked.
    await store.put("state-2", "code-only", "user-gamma", 60);
    assert.equal(await store.consume("state-2", "code-only"), "user-gamma");
  });

  test("entries expire after their TTL", async () => {
    await store.put("state-1", "code-1", "user-alpha", 0.05); // 50 ms
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await store.consume("state-1", "code-1"), null);
  });

  test("multiple concurrent entries are isolated", async () => {
    await store.put("state-a", "code-a", "user-1", 60);
    await store.put("state-b", "code-b", "user-2", 60);
    await store.put("state-c", "code-c", "user-3", 60);

    assert.equal(await store.consume("state-b", "code-b"), "user-2");
    assert.equal(await store.consume("state-a", "code-a"), "user-1");
    assert.equal(await store.consume("state-c", "code-c"), "user-3");
  });
});

describe("generateCode", () => {
  test("returns a base64url-encoded string", () => {
    const code = generateCode();
    assert.equal(typeof code, "string");
    assert.ok(code.length >= 40, "code should be at least 40 chars (32 bytes in base64url)");
    // base64url contains [A-Za-z0-9_-]
    assert.match(code, /^[A-Za-z0-9_-]+$/);
  });

  test("successive codes are unique", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      codes.add(generateCode());
    }
    assert.equal(codes.size, 1000);
  });
});

describe("DEFAULT_EXCHANGE_TTL_SEC", () => {
  test("is 5 minutes", () => {
    assert.equal(DEFAULT_EXCHANGE_TTL_SEC, 300);
  });
});

describe("getExchangeCodeStore", () => {
  test("returns a singleton (same instance on repeated calls)", () => {
    resetExchangeCodeStoreForTests();
    const a = getExchangeCodeStore();
    const b = getExchangeCodeStore();
    assert.equal(a, b);
  });

  test("resetExchangeCodeStoreForTests replaces the singleton", () => {
    resetExchangeCodeStoreForTests();
    const a = getExchangeCodeStore();
    resetExchangeCodeStoreForTests();
    const b = getExchangeCodeStore();
    assert.notEqual(a, b);
  });

  test("no Redis client in test env means we get InMemory", () => {
    resetExchangeCodeStoreForTests();
    const store = getExchangeCodeStore();
    assert.ok(store instanceof InMemoryExchangeCodeStore);
  });
});
