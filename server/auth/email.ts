import { renderEmail } from "./emailLayout";

const IS_DEV = process.env.NODE_ENV !== "production";
const LISTMONK_TIMEOUT_MS = 10_000;

export type EmailTransportKind = "listmonk" | "console";

/**
 * The subset of the environment that decides how mail leaves this server.
 * Optional strings so `process.env` can be passed as-is, and so the selection
 * can be unit-tested without mutating the real environment.
 */
export interface EmailTransportEnv {
  LISTMONK_URL?: string;
  LISTMONK_API_USER?: string;
  LISTMONK_API_TOKEN?: string;
  LISTMONK_TX_TEMPLATE_ID?: string;
  LISTMONK_FROM?: string;
  LISTMONK_REPLY_TO?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative, sent next to the HTML when present. */
  text?: string;
}

const LISTMONK_VARS = [
  "LISTMONK_URL",
  "LISTMONK_API_USER",
  "LISTMONK_API_TOKEN",
  "LISTMONK_TX_TEMPLATE_ID",
  "LISTMONK_FROM",
] as const;

/** The Listmonk variables that are unset, blank or (the template id) not a number. */
export function missingListmonkVars(source: EmailTransportEnv): string[] {
  return LISTMONK_VARS.filter((name) => {
    const value = source[name]?.trim() ?? "";
    return name === "LISTMONK_TX_TEMPLATE_ID" ? !/^\d+$/.test(value) : !value;
  });
}

/**
 * Which transport a given environment selects:
 *
 *   1. Listmonk — only when its whole set is present. It relays through
 *                 Amazon SES. A partial set is a misconfiguration, not a
 *                 transport, and the boot log names what is missing.
 *   2. console  — anything else. Sends are logged, not delivered, which is
 *                 right for local dev.
 */
export function selectEmailTransport(source: EmailTransportEnv): EmailTransportKind {
  return missingListmonkVars(source).length === 0 ? "listmonk" : "console";
}

/**
 * The `/api/tx` body for one email.
 *
 * `subscriber_mode: "external"` is what lets it reach anybody at all. In the
 * `default` mode Listmonk looks the recipient up as a newsletter subscriber
 * and answers 400 when there is none, which is every player who signs up,
 * resets a password or changes an email address.
 *
 * `from_email` is always sent: Listmonk falls back to its global From when it
 * is empty, and that instance is shared with other projects.
 *
 * The HTML goes in unescaped. The tx template renders it with
 * `{{ .Tx.Data.body | Safe }}` and the subject with `{{ .Tx.Data.subject }}`.
 *
 * `altbody` becomes the text/plain part. Listmonk runs it through Go's
 * template engine whenever it contains `{{`, so that sequence is broken up
 * here: the text can carry a player's display name.
 */
export function listmonkTxBody(
  message: EmailMessage,
  source: Pick<
    EmailTransportEnv,
    "LISTMONK_TX_TEMPLATE_ID" | "LISTMONK_FROM" | "LISTMONK_REPLY_TO"
  >,
) {
  if (/[\r\n]/.test(source.LISTMONK_REPLY_TO ?? "")) throw new Error("Invalid LISTMONK_REPLY_TO");
  return {
    ...(source.LISTMONK_REPLY_TO?.trim()
      ? { headers: [{ "Reply-To": source.LISTMONK_REPLY_TO.trim() }] }
      : {}),
    subscriber_email: message.to,
    subscriber_mode: "external",
    template_id: Number(source.LISTMONK_TX_TEMPLATE_ID),
    from_email: source.LISTMONK_FROM?.trim(),
    data: { subject: message.subject, body: message.html },
    content_type: "html",
    ...(message.text ? { altbody: message.text.replace(/\{\{/g, "{ {") } : {}),
  };
}

/**
 * POST one message to Listmonk's `/api/tx`.
 *
 * A 200 here means Listmonk queued the message, not that SES accepted it:
 * the SMTP send runs after the response. A recipient SES refuses (any
 * unverified address while the account is in the SES sandbox) or a From
 * outside the verified `mail.playtiao.com` identity does not reach this code
 * at all. It shows only in Listmonk → Settings → Logs.
 */
export async function sendViaListmonk(
  message: EmailMessage,
  source: EmailTransportEnv,
): Promise<void> {
  const baseUrl = (source.LISTMONK_URL ?? "").trim().replace(/\/+$/, "");
  const credentials = `${source.LISTMONK_API_USER?.trim()}:${source.LISTMONK_API_TOKEN?.trim()}`;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/tx`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(credentials).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(listmonkTxBody(message, source)),
      signal: AbortSignal.timeout(LISTMONK_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Listmonk ${baseUrl}/api/tx unreachable: ${reason}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Listmonk /api/tx answered ${response.status}: ${text.slice(0, 500)}`);
  }
}

/**
 * Extract a URL from the HTML body so we can log it in dev when email
 * delivery isn't actually possible (e.g. no provider configured).
 */
function extractFirstUrl(html: string): string | null {
  const match = html.match(/href="([^"]+)"/);
  return match?.[1] ?? null;
}

function describeForLog(message: EmailMessage): string {
  const url = extractFirstUrl(message.html);
  return `To: ${message.to} | Subject: ${message.subject}${url ? ` | Link: ${url}` : ""}`;
}

/**
 * Send one email through whichever transport the environment selects.
 *
 * Resolves once the provider has accepted the message. For Listmonk that
 * happens before SES is asked, so a resolved promise is not proof of
 * delivery (see sendViaListmonk). Throws when the provider refuses or cannot
 * be reached, except in dev, where the link is logged instead so the flow
 * stays testable without a working provider.
 */
async function send(message: EmailMessage): Promise<void> {
  // Seed/test accounts use @tiao-seed.invalid emails — skip the provider
  // entirely so dev seeding scripts don't burn through the email quota. The
  // seed tournament script creates dozens of bot accounts at a time.
  // `.invalid` is reserved per RFC 2606 so these addresses are guaranteed
  // to never reach a real mail server even if the skip check fails.
  // `@seed.local` is the legacy pattern kept here as a safety net for any
  // older seed accounts still in the database.
  if (message.to.endsWith("@tiao-seed.invalid") || message.to.endsWith("@seed.local")) {
    return;
  }

  const transport = selectEmailTransport(process.env);
  if (transport === "console") {
    console.info(`[email] (no email provider configured) ${describeForLog(message)}`);
    return;
  }

  try {
    await sendViaListmonk(message, process.env);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (IS_DEV) {
      console.warn(`[email] (dev fallback — ${reason}) ${describeForLog(message)}`);
      return;
    }
    console.error(`[email] ${transport} send to ${message.to} failed: ${reason}`);
    throw new Error(`Email delivery failed: ${reason}`);
  }
}

/** One boot line naming the active transport, so a change in Coolify can be
 *  confirmed from the container log before anyone requests a reset. */
function logSelectedTransport(): void {
  const source: EmailTransportEnv = process.env;
  const transport = selectEmailTransport(source);
  const missing = missingListmonkVars(source);
  const partial =
    missing.length > 0 && missing.length < LISTMONK_VARS.length
      ? ` — Listmonk ignored, missing ${missing.join(", ")}`
      : "";

  if (transport === "listmonk") {
    console.info(
      `[email] transport: Listmonk ${source.LISTMONK_URL?.trim()} (template ${source.LISTMONK_TX_TEMPLATE_ID?.trim()}, from ${source.LISTMONK_FROM?.trim()})`,
    );
  } else {
    console.info(`[email] transport: none, emails are logged instead of sent${partial}`);
  }
}

if (process.env.NODE_ENV !== "test") {
  logSelectedTransport();
}

export async function sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
  await send({
    to: email,
    subject: "Reset your Tiao password",
    ...renderEmail({
      preheader: "Choose a new password for your Tiao account.",
      heading: "Reset your password",
      paragraphs: [
        "Someone asked to reset the password of the Tiao account that uses this email address.",
        "Use the link below to choose a new password.",
      ],
      action: { label: "Choose a new password", url: resetUrl },
      notes: [
        "The link works for 1 hour.",
        "Did not ask for this? Ignore this email. Your password stays the same.",
      ],
      reason: "You got this email because someone asked for a password reset on playtiao.com.",
    }),
  });
}

export async function sendVerificationEmail(email: string, verifyUrl: string): Promise<void> {
  await send({
    to: email,
    subject: "Verify your Tiao email",
    ...renderEmail({
      preheader: "Confirm your email address to finish your Tiao sign-up.",
      heading: "Confirm your email address",
      paragraphs: [
        "Thanks for signing up for Tiao.",
        "Confirm this email address to finish setting up your account.",
      ],
      action: { label: "Confirm email address", url: verifyUrl },
      notes: [
        "The link works for 1 hour.",
        "Did not sign up? Ignore this email. Nothing happens without the link.",
      ],
      reason: "You got this email because someone signed up on playtiao.com with this address.",
    }),
  });
}

export async function sendModerationAlert(displayName: string, reportCount: number): Promise<void> {
  const adminUrl = process.env.CLIENT_URL
    ? `${process.env.CLIENT_URL}/admin/reports`
    : "https://playtiao.com/admin/reports";
  await send({
    to: "moderation@playtiao.com",
    subject: `[Tiao] Player flagged for review: ${displayName}`,
    ...renderEmail({
      preheader: `${displayName} has ${reportCount} report(s).`,
      heading: "Player flagged for review",
      paragraphs: [
        `The player ${displayName} has ${reportCount} report(s). Tiao flagged the player automatically.`,
      ],
      action: { label: "Review flagged players", url: adminUrl },
      reason: "You got this email because this address receives Tiao moderation alerts.",
    }),
  });
}

export async function sendEmailChangeVerification(
  newEmail: string,
  confirmUrl: string,
): Promise<void> {
  await send({
    to: newEmail,
    subject: "Confirm your new Tiao email",
    ...renderEmail({
      preheader: "Confirm the new email address for your Tiao account.",
      heading: "Confirm your new email address",
      paragraphs: [
        "Someone asked to move a Tiao account to this email address.",
        "Use the link below to confirm the change.",
      ],
      action: { label: "Confirm new email", url: confirmUrl },
      notes: [
        "The link works for 24 hours.",
        "Did not ask for this? Ignore this email. The account keeps its current address.",
      ],
      reason: "You got this email because someone entered this address on playtiao.com.",
    }),
  });
}
