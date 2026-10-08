import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";

import {
  type EmailTransportEnv,
  listmonkTxBody,
  sendEmailChangeVerification,
  sendModerationAlert,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "../auth/email";
import { escapeHtml, renderEmail } from "../auth/emailLayout";

const content = {
  preheader: "Preview line",
  heading: "Reset your password",
  paragraphs: ["First paragraph.", "Second paragraph."],
  action: { label: "Choose a new password", url: "https://playtiao.com/reset?token=a&b=c" },
  notes: ["The link works for 1 hour."],
  reason: "You got this email because of a test.",
};

describe("renderEmail", () => {
  test("uses the hosted PNG logo, never SVG or a data URI", () => {
    const { html } = renderEmail(content);
    assert.match(html, /<img src="https:\/\/playtiao\.com\/tiao-icon-192\.png"/);
    assert.doesNotMatch(html, /\.svg|data:/);
  });

  test("puts the link in the button and again as plain text under it", () => {
    const { html } = renderEmail(content);
    const escaped = "https://playtiao.com/reset?token=a&amp;b=c";
    assert.equal(html.split(`href="${escaped}"`).length - 1, 2);
    assert.match(html, new RegExp(`>${escaped.replace(/[?.]/g, "\\$&")}</a>`));
    assert.match(html, />Choose a new password<\/a>/);
  });

  test("lays out with tables and a max width for mail clients", () => {
    const { html } = renderEmail(content);
    assert.match(html, /<table role="presentation"/);
    assert.match(html, /max-width:560px/);
    assert.match(html, /@media \(prefers-color-scheme: dark\)/);
    assert.match(html, /You got this email because of a test\./);
    assert.match(html, /href="https:\/\/playtiao\.com"/);
  });

  test("escapes every value it is given", () => {
    const { html } = renderEmail({
      ...content,
      heading: "<script>alert(1)</script>",
      paragraphs: ['Player "<b>evil</b>" & co'],
      action: { label: "Go", url: 'https://x.test/?a="><img src=x>' },
    });
    assert.doesNotMatch(html, /<script>|<b>evil|"><img src=x>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /Player &quot;&lt;b&gt;evil&lt;\/b&gt;&quot; &amp; co/);
  });

  test("renders a plain-text alternative with the raw link", () => {
    assert.equal(
      renderEmail(content).text,
      [
        "Reset your password",
        "",
        "First paragraph.",
        "",
        "Second paragraph.",
        "",
        "Choose a new password:",
        "https://playtiao.com/reset?token=a&b=c",
        "",
        "The link works for 1 hour.",
        "",
        "--",
        "You got this email because of a test.",
        "https://playtiao.com",
        "",
      ].join("\n"),
    );
  });
});

test("escapeHtml covers the five HTML-significant characters", () => {
  assert.equal(
    escapeHtml(`<a href="x">'&'</a>`),
    "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
  );
});

const fullListmonk: EmailTransportEnv = {
  LISTMONK_URL: "https://listmonk.example.com",
  LISTMONK_API_USER: "tiao",
  LISTMONK_API_TOKEN: "token",
  LISTMONK_TX_TEMPLATE_ID: "16",
  LISTMONK_FROM: "Tiao <noreply@mail.playtiao.com>",
};

describe("listmonkTxBody plain text", () => {
  test("sends the text part as altbody, with template braces broken up", () => {
    const body = listmonkTxBody(
      { to: "a@example.com", subject: "s", html: "<p>h</p>", text: "Hi {{ .Tx }}" },
      fullListmonk,
    );
    assert.equal(body.altbody, "Hi { { .Tx }}");
  });

  test("leaves altbody out when there is no text", () => {
    const body = listmonkTxBody(
      { to: "a@example.com", subject: "s", html: "<p>h</p>" },
      fullListmonk,
    );
    assert.equal("altbody" in body, false);
  });
});

describe("every account email uses the branded layout", () => {
  const ENV_KEYS = [...Object.keys(fullListmonk), "RESEND_API_KEY", "EMAIL_FROM"];
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
    Object.assign(process.env, fullListmonk);
  });

  afterEach(() => {
    mock.restoreAll();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  test("with logo, button, fallback link and plain text", async () => {
    const bodies: { data: { body: string }; altbody: string }[] = [];
    mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(init?.body as string));
      return new Response("{}", { status: 200 });
    });

    const cases: [() => Promise<void>, string, string][] = [
      [
        () => sendPasswordResetEmail("p@example.com", "https://playtiao.com/r?t=1"),
        "https://playtiao.com/r?t=1",
        "Reset your password",
      ],
      [
        () => sendVerificationEmail("p@example.com", "https://playtiao.com/v?t=2"),
        "https://playtiao.com/v?t=2",
        "Confirm your email address",
      ],
      [
        () => sendEmailChangeVerification("p@example.com", "https://playtiao.com/c?t=3"),
        "https://playtiao.com/c?t=3",
        "Confirm your new email address",
      ],
      [
        () => sendModerationAlert("Mod", 3),
        "https://playtiao.com/admin/reports",
        "Player flagged for review",
      ],
    ];
    for (const [sendIt] of cases) await sendIt();

    assert.equal(bodies.length, cases.length);
    bodies.forEach((body, i) => {
      const [, url, heading] = cases[i];
      assert.match(body.data.body, /tiao-icon-192\.png/);
      assert.match(body.data.body, new RegExp(`>${heading}</h1>`));
      assert.equal(
        body.data.body.split(`href="${url}"`).length - 1,
        2,
        `${heading}: button + fallback link`,
      );
      assert.match(body.altbody, new RegExp(`^${heading}\\n`));
      assert.ok(body.altbody.includes(`\n${url}\n`));
    });
  });

  test("escapes a player's display name in the moderation alert", async () => {
    let html = "";
    mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
      html = JSON.parse(init?.body as string).data.body;
      return new Response("{}", { status: 200 });
    });
    await sendModerationAlert('<img src=x onerror="alert(1)">', 2);
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  });
});
