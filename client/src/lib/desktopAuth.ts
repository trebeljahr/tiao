import { steamUsernameSuggestion } from "../../../shared/src/steamIdentity";
import { refreshElectronTokenFromBridge } from "./api";
import { isSteamBuild } from "./SteamBridge";
import { safeLocalStorage } from "./safeLocalStorage";
import type { SteamProfileDefaults } from "./steamWebAuth";

type DesktopProvider = "github" | "google" | "discord" | "apple" | "steam";
type DesktopAuth = {
  startOAuth?: (
    provider: DesktopProvider,
    options?: { linkSteam?: boolean },
  ) => Promise<{ ok: boolean; reason?: string }>;
  linkOAuth?: (provider: DesktopProvider) => Promise<{ ok: boolean; reason?: string }>;
  onAuthComplete?: (cb: () => void) => () => void;
  cancelOAuth?: () => Promise<void>;
  confirmSteamLink?: () => Promise<void>;
  steam?: (input: { action: "check" | "create" | "link"; username?: string }) => Promise<{
    status: "signed_in" | "needs_setup" | "unavailable";
    profile?: SteamProfileDefaults;
  }>;
  login?: (
    identifier: string,
    password: string,
    options?: { linkSteam?: boolean },
  ) => Promise<{ pendingSteamLink?: boolean } | undefined>;
};
export function desktopAuthBridge(): DesktopAuth | null {
  if (typeof window === "undefined") return null;
  const electron = (
    window as unknown as { electron?: { isElectron?: boolean; auth?: DesktopAuth } }
  ).electron;
  return electron?.isElectron ? (electron.auth ?? null) : null;
}

export async function signInWithSteam(action: "check" | "create" | "link", username?: string) {
  const bridge = desktopAuthBridge();
  if (action === "check" && safeLocalStorage.getItem("tiao:steam-signed-out") === "1")
    return { status: "unavailable" as const };
  if (!isSteamBuild() || !bridge?.steam) return { status: "unavailable" as const };
  const result = await bridge.steam({ action, username });
  if (result.profile?.displayName)
    result.profile.suggestedUsername =
      steamUsernameSuggestion(result.profile.displayName) || result.profile.suggestedUsername;
  if (result.status !== "unavailable") await refreshElectronTokenFromBridge();
  return result;
}
