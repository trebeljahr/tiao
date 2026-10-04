// @ts-check
/**
 * electron-builder configuration per distribution channel.
 *
 * desktop/package.json `build` is the shared base (and what a plain
 * `electron-builder` run uses). This module layers one channel on top:
 *
 *   direct   signed installers for GitHub Releases / website downloads
 *   itch     zip / AppImage for butler, updater off
 *   steam    unpacked directories for SteamPipe depots, Steam gate baked in
 *   mas      Mac App Store pkg, universal, sandboxed, no steamworks.js
 *   msstore  unsigned AppX for Partner Center (the Store signs it)
 *
 * Pure: every input is passed in so each channel is a unit test
 * (builder-config.test.mjs) rather than a build on another OS.
 */

const STEAM_APP_ID = 5035580;
const TEAM_ID = "4BHY8H2J25";
const CHANNELS = ["direct", "itch", "steam", "mas", "msstore"];
const STORE_IDENTITY_VARS = [
  "WINDOWS_STORE_IDENTITY_NAME",
  "WINDOWS_STORE_PUBLISHER",
  "WINDOWS_STORE_PUBLISHER_DISPLAY_NAME",
];

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} name
 */
function envValue(env, name) {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

/**
 * @param {{
 *   base: Record<string, any>;
 *   channel: string;
 *   signed: boolean;
 *   env?: Record<string, string | undefined>;
 * }} input
 * @returns {Record<string, any>}
 */
function createBuilderConfig({ base, channel, signed, env = {} }) {
  if (!CHANNELS.includes(channel)) {
    throw new Error(`Unknown distribution channel: ${channel} (expected ${CHANNELS.join(", ")})`);
  }
  const store = channel === "mas" || channel === "msstore";
  /** @type {Record<string, any>} */
  const config = {
    ...base,
    directories: { ...base.directories, output: `dist/${channel}` },
    extraMetadata: { ...base.extraMetadata, distributionChannel: channel },
    // Only direct downloads carry an update feed. Explicit null: left
    // undefined, electron-builder writes app-update.yml for a GitHub feed.
    publish: channel === "direct" ? base.publish : null,
    mac: { ...base.mac },
    win: { ...base.win },
    linux: { ...base.linux },
  };

  if (channel === "steam") {
    const appId = Number.parseInt(envValue(env, "TIAO_STEAM_APPID") ?? String(STEAM_APP_ID), 10);
    if (!Number.isInteger(appId) || appId <= 0 || appId === 480) {
      throw new Error("TIAO_STEAM_APPID must be Tiao's real appid (never Spacewar 480).");
    }
    config.extraMetadata.steamBuild = true;
    config.extraMetadata.steamAppId = appId;
  }

  if (store) {
    // Neither store build may ship steamworks.js: App Review rejects the
    // unsigned Steam dylib under the sandbox, and neither build talks to
    // Steam. src/steam.cjs only requires it inside a Steam build anyway.
    config.files = [...base.files, "!node_modules/steamworks.js/**"];
    config.asarUnpack = (base.asarUnpack ?? []).filter(
      (/** @type {string} */ pattern) => !pattern.includes("steamworks.js"),
    );
  }

  // Targets per channel. The CLI picks the platform (--mac/--win/--linux).
  const universal = ["universal"];
  const x64 = ["x64"];
  if (channel === "itch") {
    config.mac.target = [{ target: "zip", arch: universal }];
    config.win.target = [{ target: "zip", arch: x64 }];
    config.linux.target = [{ target: "AppImage", arch: x64 }];
  } else if (channel === "steam") {
    config.mac.target = [{ target: "dir", arch: universal }];
    config.win.target = [{ target: "dir", arch: x64 }];
    config.linux.target = [{ target: "dir", arch: x64 }];
  } else if (channel === "mas") {
    config.mac.target = [{ target: "mas", arch: universal }];
  } else if (channel === "msstore") {
    config.win.target = [{ target: "appx", arch: x64 }];
  }

  // macOS signing. Developer ID for direct/itch/steam with notarization
  // from APPLE_API_KEY / APPLE_API_KEY_ID / APPLE_API_ISSUER (read by
  // electron-builder itself); Apple Distribution + Mac Installer
  // Distribution for MAS with the store provisioning profile.
  if (channel === "mas") {
    const profile = envValue(env, "MAS_PROVISIONING_PROFILE");
    if (signed && !profile) {
      throw new Error("A signed Mac App Store build needs MAS_PROVISIONING_PROFILE (a file path).");
    }
    config.mas = {
      ...base.mas,
      provisioningProfile: profile ?? null,
      // Unsigned: skip signing outright. electron-builder's ad-hoc fallback
      // cannot derive ElectronTeamID and fails; an unsigned MAS run only
      // checks the config and leaves dist/mas/mas-universal/Tiao.app.
      ...(signed ? {} : { identity: null }),
    };
  } else if (signed) {
    config.mac.hardenedRuntime = true;
  } else {
    // An ad-hoc signature has no Team ID, and the hardened runtime's
    // library validation then refuses Electron Framework at launch.
    config.mac.identity = null;
    config.mac.hardenedRuntime = false;
    config.mac.notarize = false;
  }

  // Windows signing. Azure Artifact Signing through the GitHub OIDC
  // session that azure/login establishes (scripts/sign-windows.*).
  // The Store AppX stays unsigned: Partner Center signs it.
  if (channel === "msstore") {
    const identity = Object.fromEntries(STORE_IDENTITY_VARS.map((name) => [name, envValue(env, name)]));
    const missing = STORE_IDENTITY_VARS.filter((name) => !identity[name]);
    if (signed && missing.length) {
      throw new Error("Missing Microsoft Store identity: " + missing.join(", "));
    }
    config.appx = {
      ...base.appx,
      // Placeholders keep an unsigned smoke build valid; Partner Center
      // refuses a package whose identity does not match the reservation.
      identityName: identity.WINDOWS_STORE_IDENTITY_NAME ?? "RicosLabsLLC.Tiao.Smoke",
      publisher: identity.WINDOWS_STORE_PUBLISHER ?? "CN=00000000-0000-0000-0000-000000000000",
      publisherDisplayName: identity.WINDOWS_STORE_PUBLISHER_DISPLAY_NAME ?? "Ricos Labs LLC",
    };
  } else if (signed) {
    config.win.signtoolOptions = {
      ...base.win.signtoolOptions,
      sign: "./scripts/sign-windows.cjs",
      signingHashAlgorithms: ["sha256"],
      publisherName: "Ricos Labs LLC",
    };
  }

  // A signed run must never quietly fall back to an unsigned binary.
  if (signed && channel !== "msstore") config.forceCodeSigning = true;

  return config;
}

module.exports = { createBuilderConfig, CHANNELS, STEAM_APP_ID, TEAM_ID, STORE_IDENTITY_VARS };
