import { readFileSync } from "node:fs";
export const channels = ["direct", "itch", "steam", "steam-demo", "mas", "msstore"];
const products = JSON.parse(
  readFileSync(new URL("../../steam-apps.json", import.meta.url), "utf8"),
);
export function buildConfig({ channel = "direct", platform, signed = false, env = process.env }) {
  if (!channels.includes(channel)) throw Error("Unknown channel: " + channel);
  if (!["macos", "windows", "linux", "mas", "msstore"].includes(platform))
    throw Error("Unknown platform");
  if (
    (channel === "mas" && platform !== "mas") ||
    (channel === "msstore" && platform !== "msstore")
  )
    throw Error("Store channel and platform disagree");
  const steam = channel === "steam" || channel === "steam-demo";
  const product = steam ? products[channel] : { productName: "Tiao" };
  if (steam && env.TIAO_STEAM_APPID && env.TIAO_STEAM_APPID !== String(product.appId))
    throw Error("Steam AppID must match the selected product");
  const mac = platform === "macos" || platform === "mas";
  const config = {
    productName: product.productName,
    mainBinaryName: product.productName,
    identifier: "com.ricoslabs.tiao" + (channel === "steam-demo" ? ".demo" : ""),
    build: { beforeBuildCommand: "" },
    bundle: {
      resources: { ".generated-build.json": "tiao-build.json" },
      macOS: {
        signingIdentity: signed
          ? env.APPLE_SIGNING_IDENTITY ||
            (channel === "mas"
              ? "Apple Distribution: Ricos Labs LLC (4BHY8H2J25)"
              : "Developer ID Application: Ricos Labs LLC (4BHY8H2J25)")
          : "-",
        hardenedRuntime: channel !== "mas",
        entitlements:
          channel === "mas"
            ? "../build/entitlements.mas.plist"
            : steam
              ? "../build/entitlements.steam.plist"
              : "../build/entitlements.mac.plist",
      },
      windows: {
        signCommand:
          signed && platform === "windows"
            ? "pwsh -NoProfile -NonInteractive -File ../scripts/sign-windows.ps1 -FilePath %1"
            : null,
      },
    },
  };
  if (steam) {
    if (mac) config.bundle.macOS.frameworks = [".generated-sdk/libsteam_api.dylib"];
    else
      config.bundle.resources[
        ".generated-sdk/" + (platform === "windows" ? "steam_api64.dll" : "libsteam_api.so")
      ] = platform === "windows" ? "steam_api64.dll" : "libsteam_api.so";
    config.bundle.resources[".generated-sdk/STEAM-SDK-NOTICE.txt"] = "STEAM-SDK-NOTICE.txt";
  }
  if (channel === "mas") {
    if (signed && (!env.MAS_PROVISIONING_PROFILE || !env.TIAO_BUILD_NUMBER))
      throw Error("Signed MAS build requires profile and build number");
    if (env.TIAO_BUILD_NUMBER && !/^[1-9]\d{0,8}$/.test(env.TIAO_BUILD_NUMBER))
      throw Error("Invalid MAS build number");
    config.bundle.macOS.minimumSystemVersion = "12.0";
    config.bundle.macOS.files = { "Resources/Assets.car": "../build/Assets.car" };
    if (env.MAS_PROVISIONING_PROFILE)
      config.bundle.macOS.files["embedded.provisionprofile"] = env.MAS_PROVISIONING_PROFILE;
    if (env.TIAO_BUILD_NUMBER) config.bundle.macOS.bundleVersion = env.TIAO_BUILD_NUMBER;
  }
  if (env.TIAO_ENABLE_UPDATER === "1") {
    if (channel !== "direct") throw Error("Only direct builds can enable the updater");
    if (!env.TIAO_UPDATER_PUBLIC_KEY || !env.TIAO_UPDATER_ENDPOINT)
      throw Error("Tauri updater requires its own public key and endpoint");
    if (!env.TIAO_UPDATER_ENDPOINT.startsWith("https://"))
      throw Error("Updater endpoint must use HTTPS");
    config.plugins = {
      updater: { pubkey: env.TIAO_UPDATER_PUBLIC_KEY, endpoints: [env.TIAO_UPDATER_ENDPOINT] },
    };
    config.bundle.createUpdaterArtifacts = true;
  }
  return config;
}
export function metadata(channel, version) {
  if (!channels.includes(channel)) throw Error("Unknown channel");
  return {
    runtime: "tauri",
    distributionChannel: channel,
    version,
    steamBuild: channel === "steam" || channel === "steam-demo",
    steamDemo: channel === "steam-demo",
    ...(products[channel]
      ? { steamAppId: products[channel].appId, productName: products[channel].productName }
      : { productName: "Tiao" }),
  };
}
