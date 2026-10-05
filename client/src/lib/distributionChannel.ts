/**
 * Which channel shipped the running client.
 *
 *   - `ios` / `android`  — Capacitor native app (App Store / Google Play)
 *   - `direct` / `itch` / `steam` / `mas` / `msstore` — Electron desktop,
 *     read from `window.electron.config.distributionChannel` (baked into
 *     the packaged desktop package.json, see desktop/src/distribution.cjs)
 *   - `web` — everything else (playtiao.com in a browser)
 *
 * App-store channels must not show external payment or donation links
 * (Apple 3.1.1, Google Play payments policy, Steam, Microsoft Store).
 * Gate those with `isAppStoreChannel()`.
 *
 * Synchronous on purpose: callers run during render. Both the
 * Capacitor bridge (`window.Capacitor`) and the Electron preload
 * (`window.electron`) are injected before any page script runs.
 */

import { useSyncExternalStore } from "react";

export type DistributionChannel =
  | "web"
  | "direct"
  | "itch"
  | "steam"
  | "mas"
  | "msstore"
  | "ios"
  | "android";

const DESKTOP_CHANNELS: ReadonlySet<DistributionChannel> = new Set([
  "direct",
  "itch",
  "steam",
  "mas",
  "msstore",
]);

const APP_STORE_CHANNELS: ReadonlySet<DistributionChannel> = new Set([
  "steam",
  "mas",
  "msstore",
  "ios",
  "android",
]);

type ChannelWindow = {
  Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
  electron?: {
    isElectron?: boolean;
    config?: { distributionChannel?: string; isSteamBuild?: boolean };
  };
};

/** The Capacitor native platform, or null in a browser / Electron. */
export function getNativeMobilePlatform(): "ios" | "android" | null {
  if (typeof window === "undefined") return null;
  const cap = (window as unknown as ChannelWindow).Capacitor;
  if (!cap || typeof cap.getPlatform !== "function") return null;
  if (typeof cap.isNativePlatform === "function" && !cap.isNativePlatform()) return null;
  const platform = cap.getPlatform();
  return platform === "ios" || platform === "android" ? platform : null;
}

export function getDistributionChannel(): DistributionChannel {
  if (typeof window === "undefined") return "web";

  const mobile = getNativeMobilePlatform();
  if (mobile) return mobile;

  const electron = (window as unknown as ChannelWindow).electron;
  if (electron?.config) {
    // A Steam build is the steam channel even on a preload that predates
    // the distributionChannel field.
    if (electron.config.isSteamBuild === true) return "steam";
    const raw = electron.config.distributionChannel;
    if (typeof raw === "string" && DESKTOP_CHANNELS.has(raw as DistributionChannel)) {
      return raw as DistributionChannel;
    }
    return "direct";
  }

  return "web";
}

/** True for channels whose store rules forbid external payment links. */
export function isAppStoreChannel(
  channel: DistributionChannel = getDistributionChannel(),
): boolean {
  return APP_STORE_CHANNELS.has(channel);
}

const noopSubscribe = () => () => {};

/**
 * Hydration-safe `isAppStoreChannel()` for render paths of statically
 * exported pages. The server snapshot is the build-time guess: every
 * Capacitor build (NEXT_PUBLIC_PLATFORM=mobile) ships through a store,
 * so its pre-rendered HTML already omits payment links. Desktop shares
 * one bundle across channels, so it corrects itself right after
 * hydration.
 */
export function useIsAppStoreChannel(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => isAppStoreChannel(),
    () => process.env.NEXT_PUBLIC_PLATFORM === "mobile",
  );
}
