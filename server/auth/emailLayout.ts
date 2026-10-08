/**
 * The one layout every account email uses: logo, heading, a few short
 * paragraphs, one button with the raw link under it, and a footer that says
 * why the reader got the mail.
 *
 * Mail clients are not browsers. Gmail drops SVG and data: images, Outlook
 * renders with Word and ignores most CSS, and every client strips <head> in
 * some mode. So the markup is nested tables with inline styles only, the logo
 * is a hosted PNG, and the <style> block carries nothing but the dark-mode
 * overrides that the clients which honour it (Apple Mail, iOS Mail) apply.
 */

const SITE_URL = "https://playtiao.com";
const LOGO_URL = `${SITE_URL}/tiao-icon-192.png`;

// The client theme's parchment and ink (client/app/[locale]/globals.css).
const COLOR = {
  page: "#f3e9d6",
  card: "#fcf8ef",
  border: "#e0cfb1",
  ink: "#2f251d",
  muted: "#6b5d51",
  button: "#2a1d13",
  buttonText: "#fbf3e4",
} as const;

const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";

export interface EmailContent {
  /** Hidden preview line most inboxes show after the subject. */
  preheader: string;
  heading: string;
  /** Plain-text paragraphs. They are escaped, never trusted as HTML. */
  paragraphs: string[];
  action: { label: string; url: string };
  /** Shown under the button, smaller: expiry and "ignore this" notes. */
  notes?: string[];
  /** Why the reader got this email. */
  reason: string;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function paragraph(text: string, className: string, style: string): string {
  return `<p class="${className}" style="margin:0 0 16px;${style}">${escapeHtml(text)}</p>`;
}

export function renderEmail(content: EmailContent): RenderedEmail {
  const url = escapeHtml(content.action.url);
  const body = content.paragraphs
    .map((text) =>
      paragraph(
        text,
        "tiao-ink tiao-sans",
        `font-family:${SANS};font-size:16px;line-height:24px;color:${COLOR.ink};`,
      ),
    )
    .join("\n");
  const notes = (content.notes ?? [])
    .map((text) =>
      paragraph(
        text,
        "tiao-muted tiao-sans",
        `font-family:${SANS};font-size:14px;line-height:21px;color:${COLOR.muted};`,
      ),
    )
    .join("\n");

  const html = `<!--[if mso]><style>.tiao-sans{font-family:Arial,sans-serif !important;}</style><![endif]-->
<style>
@media (prefers-color-scheme: dark) {
  .tiao-page { background-color:#17110c !important; }
  .tiao-card { background-color:#231a13 !important; border-color:#4a3a2b !important; }
  .tiao-ink { color:#f1e6d2 !important; }
  .tiao-muted { color:#c2b29c !important; }
  .tiao-link { color:#e9d2a6 !important; }
  .tiao-button { background-color:#e9d6b3 !important; }
  .tiao-button a { color:#2a1d13 !important; }
}
</style>
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(content.preheader)}</div>
<table role="presentation" class="tiao-page" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLOR.page};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td style="padding:0 0 20px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:middle;"><a href="${SITE_URL}"><img src="${LOGO_URL}" width="44" height="44" alt="Tiao" style="display:block;border:0;border-radius:10px;"></a></td>
<td class="tiao-ink" style="vertical-align:middle;padding-left:12px;font-family:${SERIF};font-size:24px;font-weight:bold;color:${COLOR.ink};">Tiao</td>
</tr></table>
</td></tr>
<tr><td class="tiao-card" style="background-color:${COLOR.card};border:1px solid ${COLOR.border};border-radius:12px;padding:32px;">
<h1 class="tiao-ink" style="margin:0 0 20px;font-family:${SERIF};font-size:26px;line-height:32px;font-weight:bold;color:${COLOR.ink};">${escapeHtml(content.heading)}</h1>
${body}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr>
<td class="tiao-button" align="center" bgcolor="${COLOR.button}" style="border-radius:8px;background-color:${COLOR.button};">
<a href="${url}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${SANS};font-size:16px;font-weight:bold;line-height:20px;color:${COLOR.buttonText};text-decoration:none;border-radius:8px;">${escapeHtml(content.action.label)}</a>
</td></tr></table>
<p class="tiao-muted" style="margin:0 0 4px;font-family:${SANS};font-size:13px;line-height:20px;color:${COLOR.muted};">Button not working? Paste this link into your browser:</p>
<p style="margin:0 0 24px;font-family:${SANS};font-size:13px;line-height:20px;word-break:break-all;"><a class="tiao-link" href="${url}" target="_blank" style="color:${COLOR.ink};text-decoration:underline;">${url}</a></p>
${notes}
</td></tr>
<tr><td class="tiao-muted" style="padding:20px 32px 0;font-family:${SANS};font-size:12px;line-height:18px;color:${COLOR.muted};text-align:center;">
${escapeHtml(content.reason)}<br>
<a class="tiao-link" href="${SITE_URL}" style="color:${COLOR.muted};text-decoration:underline;">playtiao.com</a>
</td></tr>
</table>
</td></tr>
</table>`;

  const text = [
    content.heading,
    "",
    ...content.paragraphs.flatMap((p) => [p, ""]),
    `${content.action.label}:`,
    content.action.url,
    "",
    ...(content.notes ?? []).flatMap((p) => [p, ""]),
    "--",
    content.reason,
    SITE_URL,
    "",
  ].join("\n");

  return { html, text };
}
