/**
 * Discord announcements for achievement unlocks.
 *
 * The announcer is exercised through its injectable `post` dependency, and
 * the webhook client through an injectable `fetch`, so nothing here touches
 * MongoDB or the network.
 */

process.env.TOKEN_SECRET = "test-secret";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/tiao-test";
process.env.NODE_ENV = "test";

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { DISCORD_SILENT_ACHIEVEMENT_IDS, getAchievementById } from "../../shared/src/achievements";
import { postWebhook, type WebhookFetch } from "../discord/webhooks";
import { announceAchievementUnlock, formatAchievementUnlock } from "../game/achievementService";

const WEBHOOK_URL = "https://discord.com/api/webhooks/123/abc";

function mustGet(id: string) {
  const def = getAchievementById(id);
  assert.ok(def, `missing achievement fixture: ${id}`);
  return def;
}

describe("announceAchievementUnlock", () => {
  const originalEnv = process.env.DISCORD_WEBHOOK_ACHIEVEMENTS;
  let posts: { url: string; content: string }[];
  const post = async (url: string, content: string) => {
    posts.push({ url, content });
    return true;
  };

  beforeEach(() => {
    posts = [];
    process.env.DISCORD_WEBHOOK_ACHIEVEMENTS = WEBHOOK_URL;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.DISCORD_WEBHOOK_ACHIEVEMENTS;
    else process.env.DISCORD_WEBHOOK_ACHIEVEMENTS = originalEnv;
  });

  test("posts a notable unlock with the player's display name", async () => {
    const def = mustGet("centurion");
    const ok = await announceAchievementUnlock("alice", def, { post });
    assert.equal(ok, true);
    assert.deepEqual(posts, [{ url: WEBHOOK_URL, content: `🏆 alice unlocked '${def.name}'` }]);
  });

  test("posts secret achievements by name once earned", async () => {
    const def = mustGet("rage-quit");
    assert.equal(def.secret, true);
    await announceAchievementUnlock("bob", def, { post });
    assert.equal(posts.length, 1);
    assert.equal(posts[0]!.content, formatAchievementUnlock("bob", def));
  });

  test("does not post trivial achievements", async () => {
    for (const id of DISCORD_SILENT_ACHIEVEMENT_IDS) {
      const ok = await announceAchievementUnlock("alice", mustGet(id), { post });
      assert.equal(ok, false, `${id} should be silent`);
    }
    assert.equal(posts.length, 0);
  });

  test("is a no-op when DISCORD_WEBHOOK_ACHIEVEMENTS is unset", async () => {
    delete process.env.DISCORD_WEBHOOK_ACHIEVEMENTS;
    const ok = await announceAchievementUnlock("alice", mustGet("centurion"), { post });
    assert.equal(ok, false);
    assert.equal(posts.length, 0);
  });

  test("uses the env var URL by default", async () => {
    await announceAchievementUnlock("alice", mustGet("veteran"), { post });
    assert.equal(posts[0]!.url, WEBHOOK_URL);
  });

  test("silent list only names real achievements", () => {
    for (const id of DISCORD_SILENT_ACHIEVEMENT_IDS) {
      assert.ok(getAchievementById(id), `unknown id in silent list: ${id}`);
    }
  });
});

describe("postWebhook", () => {
  test("POSTs JSON content and resolves true on 2xx", async () => {
    let seen: Parameters<WebhookFetch> | undefined;
    const fetchImpl: WebhookFetch = async (url, init) => {
      seen = [url, init];
      return { ok: true, status: 204 };
    };
    const ok = await postWebhook(WEBHOOK_URL, "hello", { fetchImpl });
    assert.equal(ok, true);
    assert.ok(seen);
    assert.equal(seen[0], WEBHOOK_URL);
    assert.equal(seen[1].method, "POST");
    assert.equal(seen[1].headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(seen[1].body), { content: "hello" });
    assert.ok(seen[1].signal instanceof AbortSignal);
  });

  test("resolves false on non-2xx without throwing", async () => {
    const fetchImpl: WebhookFetch = async () => ({ ok: false, status: 429 });
    assert.equal(await postWebhook(WEBHOOK_URL, "hello", { fetchImpl }), false);
  });

  test("swallows network errors", async () => {
    const fetchImpl: WebhookFetch = async () => {
      throw new TypeError("fetch failed");
    };
    assert.equal(await postWebhook(WEBHOOK_URL, "hello", { fetchImpl }), false);
  });

  test("gives up after the timeout", async () => {
    const fetchImpl: WebhookFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason));
      });
    const started = Date.now();
    const ok = await postWebhook(WEBHOOK_URL, "hello", { fetchImpl, timeoutMs: 20 });
    assert.equal(ok, false);
    assert.ok(Date.now() - started < 2_000);
  });
});
