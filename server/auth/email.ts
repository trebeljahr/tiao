import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM ?? "Tiao <noreply@playtiao.com>";
const IS_DEV = process.env.NODE_ENV !== "production";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

/**
 * Extract a URL from the HTML body so we can log it in dev when email
 * delivery isn't actually possible (e.g. unverified domain on Resend).
 */
function extractFirstUrl(html: string): string | null {
  const match = html.match(/href="([^"]+)"/);
  return match?.[1] ?? null;
}

async function send(to: string, subject: string, html: string): Promise<void> {
  if (!resend) {
    const url = extractFirstUrl(html);
    console.info(
      `[email] (no RESEND_API_KEY) To: ${to} | Subject: ${subject}${url ? ` | Link: ${url}` : ""}`,
    );
    return;
  }

  const { error } = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject,
    html,
  });

  if (error) {
    // In dev, gracefully fall back to logging the link to the console so the
    // developer can still test the flow without a verified Resend domain.
    if (IS_DEV) {
      const url = extractFirstUrl(html);
      console.warn(
        `[email] (dev fallback — Resend rejected: ${error.message}) To: ${to} | Subject: ${subject}${
          url ? ` | Link: ${url}` : ""
        }`,
      );
      return;
    }
    console.error(`[email] Failed to send to ${to}:`, error);
    throw new Error(`Email delivery failed: ${error.message}`);
  }
}

export async function sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
  await send(
    email,
    "Reset your Tiao password",
    `<p>You requested a password reset. Click the link below to set a new password:</p>
     <p><a href="${resetUrl}">Reset password</a></p>
     <p>If you didn't request this, you can safely ignore this email.</p>`,
  );
}

export async function sendVerificationEmail(email: string, verifyUrl: string): Promise<void> {
  await send(
    email,
    "Verify your Tiao email",
    `<p>Welcome to Tiao! Click the link below to verify your email address:</p>
     <p><a href="${verifyUrl}">Verify email</a></p>`,
  );
}

export async function sendEmailChangeVerification(
  newEmail: string,
  confirmUrl: string,
): Promise<void> {
  await send(
    newEmail,
    "Confirm your new Tiao email",
    `<p>Someone (hopefully you) requested to change the email on a Tiao account to this address.</p>
     <p>Click the link below to confirm the change:</p>
     <p><a href="${confirmUrl}">Confirm email change</a></p>
     <p>If you didn't request this, you can safely ignore this email — your account is unaffected.</p>`,
  );
}
