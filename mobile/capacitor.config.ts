import type { CapacitorConfig } from "@capacitor/cli";

/*
 * Tiao — Capacitor (iOS + Android) configuration.
 *
 * Architecture mirrors the Electron desktop wrapper at `../desktop/`:
 *   • The Next.js client is built once with `NEXT_PUBLIC_PLATFORM=mobile`
 *     into `client/.next-mobile/` (see `client/next.config.mjs`).
 *     `webDir` below points at that directory — `cap sync` copies the
 *     static export into the native iOS / Android projects.
 *   • A small redirect `index.html` is written at the root of
 *     `.next-mobile/` by `mobile/scripts/write-index-redirect.sh` so
 *     the WebView lands on `/en/` (or whichever locale the browser
 *     prefers) instead of a Next-intl 404. Next's static export
 *     emits per-locale directories but no root entry point, since
 *     locale negotiation normally happens in middleware on the web
 *     build — middleware doesn't run in static exports.
 *   • The mobile API URL is baked in at build time via
 *     NEXT_PUBLIC_MOBILE_API_URL (default: production). The Capacitor
 *     WebView has no preload bridge to inject a URL at runtime the
 *     way the Electron build does.
 *   • Bundle id is `com.ricoslabs.tiao` — the same appId the Electron
 *     desktop build uses (`../desktop/package.json`), registered as an
 *     Apple App ID under the Ricos Labs LLC team (4BHY8H2J25). One id
 *     lets the iOS and macOS / Mac App Store builds share one App Store
 *     Connect record. `cap add` writes it into the native projects once
 *     (PRODUCT_BUNDLE_IDENTIFIER, applicationId / namespace); a later
 *     change here does not reach an already generated ios/ or android/.
 *     Registered is final: the App ID cannot be renamed.
 */
const config: CapacitorConfig = {
  appId: "com.ricoslabs.tiao",
  appName: "Tiao",
  webDir: "../client/.next-mobile",

  // Match the existing brand background so the splash → app
  // transition doesn't flash a different hue. #2a1d13 is the same
  // brown tone used elsewhere in the client shell.
  backgroundColor: "#2a1d13",

  android: {
    // Production builds block plain HTTP. We override to `false`
    // explicitly so the intent is visible in code review and matches
    // the network-security-config that ships in the Android project.
    allowMixedContent: false,
  },

  // Live-reload during development. When CAP_DEV_URL is set at
  // `cap sync` time (by scripts/android-dev.sh / scripts/ios-dev.sh),
  // the WebView loads from the Next.js dev server on your LAN
  // instead of the bundled `.next-mobile/` folder. Edits to
  // client/src hot-reload in place — no APK rebuild per change.
  //
  // On production builds (CAP_DEV_URL unset), this block is omitted
  // entirely and the WebView loads bundled assets as normal.
  //
  // cleartext: true because the dev server speaks plain HTTP. This
  // only applies when server.url is set — the production build keeps
  // cleartext blocked.
  ...(process.env.CAP_DEV_URL
    ? {
        server: {
          url: process.env.CAP_DEV_URL,
          cleartext: true,
        },
      }
    : {}),

  plugins: {
    SplashScreen: {
      // The client does not call SplashScreen.hide() yet, so the native
      // splash must hide itself or the app would stay on it forever.
      // The redirect page and the app shell use the splash's brown, so
      // the hand-over does not flash.
      launchShowDuration: 1000,
      launchAutoHide: true,
      launchFadeOutDuration: 200,
      backgroundColor: "#2a1d13",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    SystemBars: {
      // Light status-bar icons on the dark brown background. The client
      // does not set viewport-fit=cover, so on Android 15+ Capacitor pads
      // the WebView out of the system bars instead of drawing under them.
      style: "DARK",
    },
  },
};

export default config;
