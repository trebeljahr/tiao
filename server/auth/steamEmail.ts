export const STEAM_EMAIL_DOMAIN = "steam.tiao.invalid";

/** Steam supplies no email. Never expose its internal adapter placeholder. */
export function publicAccountEmail(email?: string): string | undefined {
  return email?.toLowerCase().endsWith(`@${STEAM_EMAIL_DOMAIN}`) ? undefined : email;
}
