/**
 * Maps OAuth/better-auth error codes to translation keys.
 * Used by both the sign-in flow (providers.tsx) and account linking (ProfilePage).
 */

const ERROR_KEY_MAP: Record<string, string> = {
  account_already_linked_to_different_user: "oauthErrorAlreadyLinked",
  account_already_linked: "oauthErrorAlreadyLinkedSelf",
  social_account_already_linked: "oauthErrorAlreadyLinked",
  user_already_exists: "oauthErrorUserExists",
  unable_to_create_user: "oauthErrorCreateFailed",
  access_denied: "oauthErrorAccessDenied",
  unauthorized: "oauthErrorAccessDenied",
};

/**
 * Return a user-friendly error message for an OAuth error code.
 * Falls back to the raw code if no mapping exists.
 */
export function getOAuthErrorMessage(code: string, t: (key: string) => string): string {
  const key = ERROR_KEY_MAP[code];
  if (!key) return code.replace(/_/g, " ");
  return t(key);
}
