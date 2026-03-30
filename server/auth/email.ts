import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM ?? "Tiao <noreply@tiao.app>";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

async function send(to: string, subject: string, html: string): Promise<void> {
  if (!resend) {
    console.info(`[email] (no RESEND_API_KEY) To: ${to} | Subject: ${subject}`);
    return;
  }

  const { error } = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject,
    html,
  });

  if (error) {
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
