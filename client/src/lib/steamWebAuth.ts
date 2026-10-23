import { API_BASE_URL } from "./api";

export type { SteamProfileDefaults } from "../../../shared/src/steamIdentity";

import type { SteamProfileDefaults } from "../../../shared/src/steamIdentity";

async function steamRequest(path: string, body?: Record<string, unknown>) {
  const response = await fetch(`${API_BASE_URL}/api/auth/steam/${path}`, {
    method: body ? "POST" : "GET",
    credentials: "include",
    ...(body
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "Steam sign-in failed. Please try again.");
  return result;
}
export async function startSteamWebSignIn(intent: "sign-in" | "link" = "sign-in") {
  const { url } = await steamRequest("start", { intent, returnPath: window.location.pathname });
  // The server issues only the fixed Steam OpenID URL.
  const target = new URL(url);
  if (target.origin !== "https://steamcommunity.com" || target.pathname !== "/openid/login")
    throw new Error("Invalid Steam sign-in URL.");
  window.location.assign(target.href);
}
export async function getPendingSteamWebAccount(): Promise<{
  status: "none" | "needs_setup";
  profile?: SteamProfileDefaults;
}> {
  try {
    return await steamRequest("pending");
  } catch {
    return { status: "none" };
  }
}
export async function finishSteamWebAccount(
  action: "create" | "link" | "cancel",
  username?: string,
) {
  return steamRequest("finish", { action, username });
}
