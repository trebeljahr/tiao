import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { postWebhook, resetWebhookRateLimits, type WebhookFetch } from "../discord/webhooks";

type Call = { url: string; body: string; signal: AbortSignal };

function mockFetch(status = 204) {
  const calls: Call[] = [];
  const fetchImpl: WebhookFetch = async (url, init) => {
    calls.push({ url, body: init.body, signal: init.signal });
    return { ok: status >= 200 && status < 300, status };
  };
  return { calls, fetchImpl };
}

const URL_A = "https://discord.example/api/webhooks/a";
const URL_B = "https://discord.example/api/webhooks/b";

describe("postWebhook", () => {
  beforeEach(() => resetWebhookRateLimits());

  test("posts a JSON body with the content to the webhook URL", async () => {
    const { calls, fetchImpl } = mockFetch();

    const sent = await postWebhook(URL_A, "hello", { fetchImpl });

    assert.equal(sent, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, URL_A);
    assert.deepEqual(JSON.parse(calls[0]!.body), { content: "hello" });
    assert.ok(calls[0]!.signal instanceof AbortSignal);
  });

  test("is a no-op when the URL is unset", async () => {
    const { calls, fetchImpl } = mockFetch();

    assert.equal(await postWebhook(undefined, "hello", { fetchImpl }), false);
    assert.equal(await postWebhook("", "hello", { fetchImpl }), false);
    assert.equal(calls.length, 0);
  });

  test("drops posts inside the rate-limit window and resumes after it", async () => {
    const { calls, fetchImpl } = mockFetch();
    let clock = 1_000;
    const opts = { fetchImpl, now: () => clock, minIntervalMs: 30_000 };

    assert.equal(await postWebhook(URL_A, "first", opts), true);
    clock += 10_000;
    assert.equal(await postWebhook(URL_A, "dropped", opts), false);
    clock += 19_999;
    assert.equal(await postWebhook(URL_A, "still dropped", opts), false);
    clock += 1;
    assert.equal(await postWebhook(URL_A, "second", opts), true);

    assert.deepEqual(
      calls.map((c) => JSON.parse(c.body).content),
      ["first", "second"],
    );
  });

  test("rate limit is tracked per URL", async () => {
    const { calls, fetchImpl } = mockFetch();
    const opts = { fetchImpl, now: () => 0, minIntervalMs: 30_000 };

    assert.equal(await postWebhook(URL_A, "a", opts), true);
    assert.equal(await postWebhook(URL_B, "b", opts), true);
    assert.equal(calls.length, 2);
  });

  test("no rate limit by default", async () => {
    const { calls, fetchImpl } = mockFetch();

    assert.equal(await postWebhook(URL_A, "a", { fetchImpl }), true);
    assert.equal(await postWebhook(URL_A, "b", { fetchImpl }), true);
    assert.equal(calls.length, 2);
  });

  test("swallows fetch rejections and non-2xx responses", async () => {
    const throwing: WebhookFetch = async () => {
      throw new Error("boom");
    };
    assert.equal(await postWebhook(URL_A, "x", { fetchImpl: throwing }), false);

    const { fetchImpl } = mockFetch(500);
    assert.equal(await postWebhook(URL_A, "x", { fetchImpl }), false);
  });
});
