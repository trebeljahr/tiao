import { readAppleConfig } from "./appleSignIn";

export type SocialProviderId = "github" | "google" | "discord" | "apple";

export const SOCIAL_PROVIDER_IDS: readonly SocialProviderId[] = [
  "apple",
  "google",
  "github",
  "discord",
];

type Env = Record<string, string | undefined>;

/**
 * Social providers the server can actually complete a sign-in with.
 * Exposed to clients via GET /api/auth-providers so the login UI only
 * offers buttons that work (Apple stays hidden until its key is set).
 */
export function getEnabledSocialProviders(env: Env = process.env): SocialProviderId[] {
  const enabled: SocialProviderId[] = [];
  if (readAppleConfig(env)) enabled.push("apple");
  if (env.GOOGLE_CLIENT_ID) enabled.push("google");
  if (env.GITHUB_CLIENT_ID) enabled.push("github");
  if (env.DISCORD_CLIENT_ID) enabled.push("discord");
  return enabled;
}
