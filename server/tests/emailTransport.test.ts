import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";

import {
  type EmailTransportEnv,
  listmonkTxBody,
  missingListmonkVars,
  selectEmailTransport,
  sendEmailChangeVerification,
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

  test("selects Resend when only RESEND_API_KEY is set", () => {
    assert.equal(selectEmailTransport({ RESEND_API_KEY: "re_123" }), "resend");
  });

  test("selects Listmonk once its whole set is present, even with Resend configured", () => {
    // This is the cutover: Resend's key is still set when the Listmonk set
    // is completed, and Listmonk has to win without removing it first.
    assert.equal(selectEmailTransport(fullListmonk), "listmonk");
    assert.equal(selectEmailTransport({ ...fullListmonk, RESEND_API_KEY: "re_123" }), "listmonk");
  });

  test("keeps live mail on Resend while the Listmonk set is incomplete", () => {
    for (const missing of LISTMONK_KEYS) {
      assert.equal(
        selectEmailTransport({ ...fullListmonk, [missing]: "", RESEND_API_KEY: "re_123" }),
        "resend",
        `a missing ${missing} must not take mail away from Resend`,
      );
      assert.equal(
        selectEmailTransport({ ...fullListmonk, [missing]: undefined }),
        "console",
        `a missing ${missing} must not select Listmonk`,
      );
    }
  });

  test("treats whitespace-only values as unset", () => {
    assert.equal(selectEmailTransport({ RESEND_API_KEY: "  " }), "console");
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
// wiring the cutover depends on: the same call goes to Listmonk or to Resend
// depending only on which variables are set.
describe("account emails", () => {
  const ENV_KEYS = [...LISTMONK_KEYS, "RESEND_API_KEY", "EMAIL_FROM"] as const;
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

  test("go through Listmonk once its set is complete, with Resend still configured", async () => {
    Object.assign(process.env, fullListmonk, { RESEND_API_KEY: "re_123" });
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

  test("stay on Resend, from EMAIL_FROM, while the Listmonk set is incomplete", async () => {
    Object.assign(process.env, fullListmonk, {
      LISTMONK_API_TOKEN: "",
      RESEND_API_KEY: "re_123",
      EMAIL_FROM: "noreply@playtiao.com",
    });
    const calls = stubFetch(() => okJson({ id: "email_1" }));

    await sendEmailChangeVerification("new@example.com", "https://playtiao.com/confirm");

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/api\.resend\.com\/emails/);
    const body = JSON.parse(calls[0].init.body as string);
    assert.equal(body.from, "noreply@playtiao.com");
    assert.deepEqual(body.to, "new@example.com");
  });

  test("skip seed accounts without calling any provider", async () => {
    Object.assign(process.env, fullListmonk);
    const calls = stubFetch(() => okJson({ data: true }));

    await sendVerificationEmail("bot-1@tiao-seed.invalid", "https://playtiao.com/verify");

    assert.equal(calls.length, 0);
  });
});
