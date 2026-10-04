// @ts-check
/**
 * Which storefront shipped this copy of Tiao, and what that storefront owns.
 *
 * One electron-builder run is made per channel (see
 * scripts/release/builder-config.cjs), and the channel is baked into the
 * packaged package.json as `distributionChannel`. Env vars do not survive
 * packaging, so the baked value is the load-bearing source; the Electron
 * store flags (`process.mas`, `process.windowsStore`) are a fallback for a
 * store build that somehow lost its metadata.
 *
 *   direct   — GitHub Releases / website download. The only channel that may
 *              self-update (and only with TIAO_ENABLE_UPDATER=1).
 *   itch     — itch.io; updates arrive through butler and the itch app.
 *   steam    — SteamPipe owns the installed files.
 *   mas      — Mac App Store; the sandbox forbids writing the app bundle.
 *   msstore  — Microsoft Store; MSIX installs are read-only.
 */

/** @typedef {"direct" | "itch" | "steam" | "mas" | "msstore"} DistributionChannel */

/** @type {readonly DistributionChannel[]} */
const DISTRIBUTION_CHANNELS = Object.freeze(["direct", "itch", "steam", "mas", "msstore"]);

/**
 * @param {unknown} value
 * @returns {value is DistributionChannel}
 */
function isDistributionChannel(value) {
  return typeof value === "string" && DISTRIBUTION_CHANNELS.includes(/** @type {any} */ (value));
}

/**
 * Pure resolver so every channel is a unit test instead of a build.
 *
 * @param {{
 *   bakedChannel?: unknown;
 *   steamBuild: boolean;
 *   mas?: boolean;
 *   windowsStore?: boolean;
 * }} input
 * @returns {DistributionChannel}
 */
function resolveDistributionChannel({ bakedChannel, steamBuild, mas, windowsStore }) {
  // A Steam build is a Steam build regardless of what else is set: the
  // STEAM_BUILD dev override must also flip the channel, or the renderer
  // would show direct-download UI inside Steam.
  if (steamBuild) return "steam";
  if (isDistributionChannel(bakedChannel)) return bakedChannel;
  if (mas) return "mas";
  if (windowsStore) return "msstore";
  return "direct";
}

/**
 * Whether this channel may replace its own files with electron-updater.
 * Every storefront ships updates itself; an in-app updater there either
 * cannot write (MAS sandbox, MSIX) or fights the store (Steam, itch).
 *
 * @param {DistributionChannel} channel
 */
function channelAllowsSelfUpdate(channel) {
  return channel === "direct";
}

/** @returns {DistributionChannel} */
function currentDistributionChannel() {
  /** @type {{ distributionChannel?: unknown }} */
  let meta = {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    meta = /** @type {{ distributionChannel?: unknown }} */ (require("../package.json"));
  } catch {
    /* treat as direct */
  }
  const { STEAM_ENABLED } = require("./steam.cjs");
  const proc = /** @type {NodeJS.Process & { mas?: boolean; windowsStore?: boolean }} */ (process);
  return resolveDistributionChannel({
    bakedChannel: meta.distributionChannel,
    steamBuild: STEAM_ENABLED,
    mas: proc.mas === true,
    windowsStore: proc.windowsStore === true,
  });
}

const DISTRIBUTION_CHANNEL = currentDistributionChannel();

module.exports = {
  DISTRIBUTION_CHANNELS,
  DISTRIBUTION_CHANNEL,
  isDistributionChannel,
  resolveDistributionChannel,
  channelAllowsSelfUpdate,
};
