import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";

import {
  type EmailTransportEnv,
  listmonkTxBody,
  missingListmonkVars,
  selectEmailTransport,
  sendEmailChangeVerification,
  sendModerationAlert,
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendViaListmonk,
} from "../auth/email";

const fullListmonk: EmailTransportEnv = {
  LISTMONK_URL: "https://listmonk.example.com",
  LISTMONK_API_USER: "tiao",
  LISTMONK_API_TOKEN: "token",
  LISTMONK_TX_TEMPLATE_ID: "15",
  LISTMONK_FROM: "Tiao <noreply@mail.playtiao.com>",
};

const LISTMONK_KEYS = Object.keys(fullListmonk) as (keyof EmailTransportEnv)[];

describe("selectEmailTransport", () => {
  test("logs to the console when nothing is configured", () => {
    assert.equal(selectEmailTransport({}), "console");
  });

  test("selects Listmonk once its whole set is present", () => {
    assert.equal(selectEmailTransport(fullListmonk), "listmonk");
  });

  test("falls back to the console while the Listmonk set is incomplete", () => {
    for (const missing of LISTMONK_KEYS) {
      assert.equal(
        selectEmailTransport({ ...fullListmonk, [missing]: "" }),
        "console",
        `a blank ${missing} must not select Listmonk`,
      );
      assert.equal(
        selectEmailTransport({ ...fullListmonk, [missing]: undefined }),
        "console",
        `a missing ${missing} must not select Listmonk`,
      );
    }
  });

  test("treats whitespace-only values as unset", () => {
    assert.equal(selectEmailTransport({ ...fullListmonk, LISTMONK_API_TOKEN: " " }), "console");
  });

  test("does not select Listmonk with a template id that is not a number", () => {
    // Number("tiao-tx") is NaN, which JSON turns into null: every send
    // would fail with "template not found" at delivery time.
    assert.equal(
      selectEmailTransport({ ...fullListmonk, LISTMONK_TX_TEMPLATE_ID: "tiao-tx" }),
      "console",
    );
  });
});

describe("missingListmonkVars", () => {
  test("names every missing variable", () => {
    assert.deepEqual(missingListmonkVars({}), LISTMONK_KEYS);
    assert.deepEqual(missingListmonkVars(fullListmonk), []);
    assert.deepEqual(
      missingListmonkVars({ ...fullListmonk, LISTMONK_FROM: "", LISTMONK_TX_TEMPLATE_ID: "x" }),
      ["LISTMONK_TX_TEMPLATE_ID", "LISTMONK_FROM"],
    );
  });
});

describe("listmonkTxBody", () => {
  const message = {
    to: "new-player@example.com",
    subject: "Verify your Tiao email",
    html: '<p><a href="https://playtiao.com/v?t=1&amp;u=2">Verify email</a></p>',
  };

  // Listmonk's default mode answers 400 for a recipient who is not a
  // newsletter subscriber, and no player signing up or resetting a password
  // is one. The failure would only show once the cutover happened.
  test("sends to people who are not newsletter subscribers", () => {
    const body = listmonkTxBody(message, fullListmonk);
    assert.equal(body.subscriber_mode, "external");
    assert.equal(body.subscriber_email, "new-player@example.com");
    assert.equal("subscriber_emails" in body, false);
  });

  test("always names tiao's sender, so Listmonk's shared global From is never used", () => {
    const body = listmonkTxBody(message, fullListmonk);
    assert.equal(body.from_email, "Tiao <noreply@mail.playtiao.com>");
  });

  test("passes the template id as a number and the HTML through unescaped", () => {
    const body = listmonkTxBody(message, fullListmonk);
    assert.equal(body.template_id, 15);
    assert.equal(body.content_type, "html");
    assert.deepEqual(body.data, { subject: message.subject, body: message.html });
  });

  // The whole body, written out, so an added or renamed field shows up here
  // and not as a 400 from the live Listmonk.
  test("is exactly the body Listmonk's /api/tx expects", () => {
    assert.deepEqual(listmonkTxBody(message, fullListmonk), {
      subscriber_email: "new-player@example.com",
      subscriber_mode: "external",
      template_id: 15,
      from_email: "Tiao <noreply@mail.playtiao.com>",
      data: {
        subject: "Verify your Tiao email",
        body: '<p><a href="https://playtiao.com/v?t=1&amp;u=2">Verify email</a></p>',
      },
      content_type: "html",
    });
  });
});

type FetchCall = { url: string; init: RequestInit };

function stubFetch(response: () => Response | Promise<Response>): FetchCall[] {
  const calls: FetchCall[] = [];
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return response();
  });
  return calls;
}

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("sendViaListmonk", () => {
  const message = { to: "player@example.com", subject: "Hi", html: "<p>Hi</p>" };

  afterEach(() => mock.restoreAll());

  test("posts the tx body to /api/tx with basic auth", async () => {
    const calls = stubFetch(() => okJson({ data: true }));
    await sendViaListmonk(message, { ...fullListmonk, LISTMONK_URL: "https://lm.example.com/" });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://lm.example.com/api/tx");
    assert.equal(calls[0].init.method, "POST");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, `Basic ${Buffer.from("tiao:token").toString("base64")}`);
    assert.deepEqual(
      JSON.parse(calls[0].init.body as string),
      listmonkTxBody(message, fullListmonk),
    );
  });

  test("throws with Listmonk's status and message on a refusal", async () => {
    stubFetch(() => new Response('{"message":"permission denied: tx:send"}', { status: 403 }));
    await assert.rejects(sendViaListmonk(message, fullListmonk), /answered 403: .*tx:send/);
  });

  test("throws when Listmonk cannot be reached", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    await assert.rejects(sendViaListmonk(message, fullListmonk), /unreachable: fetch failed/);
  });
});

// The account emails read the environment on every send, so these cover the
// wiring from environment variables to the Listmonk request.
describe("account emails", () => {
  const ENV_KEYS = LISTMONK_KEYS;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    mock.restoreAll();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  test("go through Listmonk once its set is complete", async () => {
    Object.assign(process.env, fullListmonk);
    const calls = stubFetch(() => okJson({ data: true }));

    await sendVerificationEmail("player@example.com", "https://playtiao.com/verify?token=abc");

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://listmonk.example.com/api/tx");
    const body = JSON.parse(calls[0].init.body as string);
    assert.equal(body.subscriber_email, "player@example.com");
    assert.equal(body.from_email, "Tiao <noreply@mail.playtiao.com>");
    assert.equal(body.data.subject, "Verify your Tiao email");
    assert.match(body.data.body, /href="https:\/\/playtiao.com\/verify\?token=abc"/);
  });

  test("all four senders go through Listmonk with tiao's From", async () => {
    Object.assign(process.env, fullListmonk);
    const calls = stubFetch(() => okJson({ data: true }));

    await sendPasswordResetEmail("player@example.com", "https://playtiao.com/reset?token=r");
    await sendVerificationEmail("player@example.com", "https://playtiao.com/verify?token=v");
    await sendEmailChangeVerification("new@example.com", "https://playtiao.com/confirm?token=c");
    await sendModerationAlert("Troublemaker", 3);

    assert.deepEqual(
      calls.map((call) => {
        const body = JSON.parse(call.init.body as string);
        return [call.url, body.subscriber_email, body.from_email, body.data.subject];
      }),
      [
        [
          "https://listmonk.example.com/api/tx",
          "player@example.com",
          "Tiao <noreply@mail.playtiao.com>",
          "Reset your Tiao password",
        ],
        [
          "https://listmonk.example.com/api/tx",
          "player@example.com",
          "Tiao <noreply@mail.playtiao.com>",
          "Verify your Tiao email",
        ],
        [
          "https://listmonk.example.com/api/tx",
          "new@example.com",
          "Tiao <noreply@mail.playtiao.com>",
          "Confirm your new Tiao email",
        ],
        [
          "https://listmonk.example.com/api/tx",
          "moderation@playtiao.com",
          "Tiao <noreply@mail.playtiao.com>",
          "[Tiao] Player flagged for review: Troublemaker",
        ],
      ],
    );
  });

  test("are logged, not sent, while the Listmonk set is incomplete", async () => {
    Object.assign(process.env, fullListmonk, { LISTMONK_API_TOKEN: "" });
    const calls = stubFetch(() => okJson({ data: true }));
    const info = mock.method(console, "info", () => {});

    await sendEmailChangeVerification("new@example.com", "https://playtiao.com/confirm");

    assert.equal(calls.length, 0);
    assert.match(
      String(info.mock.calls[0]?.arguments[0]),
      /no email provider configured.*new@example\.com/,
    );
  });

  test("skip seed accounts without calling any provider", async () => {
    Object.assign(process.env, fullListmonk);
    const calls = stubFetch(() => okJson({ data: true }));

    await sendVerificationEmail("bot-1@tiao-seed.invalid", "https://playtiao.com/verify");

    assert.equal(calls.length, 0);
  });
});

test("Reply-To preserves the sole recipient and rejects header injection", () => {
  const message = {
    to: "one@example.com",
    subject: "fixture",
    text: "fixture",
    html: "<p>fixture</p>",
  };
  const body = listmonkTxBody(message, {
    ...fullListmonk,
    LISTMONK_REPLY_TO: "Owner <hi@example.com>",
  });
  assert.deepEqual(body.headers, [{ "Reply-To": "Owner <hi@example.com>" }]);
  assert.equal(body.subscriber_email, "one@example.com");
  assert.throws(
    () =>
      listmonkTxBody(message, {
        ...fullListmonk,
        LISTMONK_REPLY_TO: "hi@example.com\r\nBcc: other@example.com",
      }),
    /Invalid LISTMONK_REPLY_TO/,
  );
});
