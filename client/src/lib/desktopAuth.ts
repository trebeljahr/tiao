import { refreshElectronTokenFromBridge } from "./api";
import { isSteamBuild } from "./SteamBridge";
import { safeLocalStorage } from "./safeLocalStorage";

type DesktopAuth = {
  steam?: (input: {
    action: "check" | "create" | "link";
    username?: string;
  }) => Promise<{ status: "signed_in" | "needs_setup" | "unavailable" }>;
  login?: (identifier: string, password: string) => Promise<void>;
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
  if (result.status !== "unavailable") await refreshElectronTokenFromBridge();
  return result;
}
