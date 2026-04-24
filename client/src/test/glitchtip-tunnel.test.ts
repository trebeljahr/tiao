import { describe, expect, it } from "vitest";
import { buildGlitchtipEnvelopeTarget } from "../../tunnel-envelope.mjs";

// Regression coverage for the /_e tunnel 403 in prod (2026-04-20):
// The Sentry browser SDK in `tunnel` mode puts the DSN in the envelope
// header's `dsn` field and sends NO X-Sentry-Auth header and NO
// ?sentry_key= query. GlitchTip's /api/<projectId>/envelope/ endpoint
// rejects that with `403 {"detail": "Denied"}`. server.mjs must
// therefore synthesize the classic `?sentry_key=...&sentry_version=7`
// query string onto the forwarded target URL.
describe("buildGlitchtipEnvelopeTarget", () => {
  function envelope(dsn: string, extraHeaderFields: Record<string, unknown> = {}) {
    const header = JSON.stringify({
      sent_at: "2026-04-20T00:00:00.000Z",
      dsn,
      ...extraHeaderFields,
    });
    const item = `{"type":"session"}\n{"sid":"s","status":"ok"}`;
    return Buffer.from(`${header}\n${item}`);
  }

  it("builds the ingest path with sentry_key + sentry_version from the DSN", () => {
    const { targetPath } = buildGlitchtipEnvelopeTarget(
      envelope("https://abc123def@glitchtip.example.com/42"),
    );

    expect(targetPath).toBe("/api/42/envelope/?sentry_key=abc123def&sentry_version=7");
  });

  it("parses only the first newline-delimited line as the envelope header", () => {
    // Envelope format: <header>\n<item-header>\n<item-payload>\n...
    // The item payloads below are arbitrary JSON objects that would
    // fail JSON.parse if the parser tried to read past the first line.
    const body = Buffer.concat([
      Buffer.from(JSON.stringify({ dsn: "https://k@glitchtip.example.com/3" }) + "\n"),
      Buffer.from(`{"type":"event"}\n`),
      Buffer.from(`{"message":"unrelated","data":[1,2,3]}\n`),
    ]);

    const { targetPath } = buildGlitchtipEnvelopeTarget(body);
    expect(targetPath).toBe("/api/3/envelope/?sentry_key=k&sentry_version=7");
  });

  it("throws when the envelope header is not valid JSON", () => {
    expect(() => buildGlitchtipEnvelopeTarget(Buffer.from("not-json\n{}"))).toThrow();
  });

  it("throws when the DSN is missing from the envelope header", () => {
    expect(() =>
      buildGlitchtipEnvelopeTarget(
        Buffer.from(JSON.stringify({ sent_at: "2026-04-20T00:00:00Z" })),
      ),
    ).toThrow();
  });

  it("throws when the DSN has no project ID (empty path)", () => {
    expect(() =>
      buildGlitchtipEnvelopeTarget(envelope("https://abc@glitchtip.example.com/")),
    ).toThrow(/project ID/);
  });

  it("throws when the DSN has no public key", () => {
    expect(() => buildGlitchtipEnvelopeTarget(envelope("https://glitchtip.example.com/1"))).toThrow(
      /public key/,
    );
  });
});
