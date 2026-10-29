import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildConfig, metadata } from "./config.mjs";
import { stageLinuxRuntime } from "./linux-steam-runtime.mjs";
import { createNotarizer } from "./notarize.mjs";
import { appleSigning } from "./signing.mjs";
import { loadArchive, prepareSdk } from "./steam-sdk.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(desktop);
const channel = process.env.TIAO_DISTRIBUTION_CHANNEL || "direct";
const host = { darwin: "macos", win32: "windows", linux: "linux" }[process.platform];
const platform = channel === "mas" ? "mas" : channel === "msstore" ? "msstore" : host;
const signed = process.env.TIAO_SIGNED === "1";
const config = buildConfig({ channel, platform, signed });
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const meta = metadata(channel, version);
const mac = host === "macos";
if ((platform === "mas" && !mac) || (platform === "msstore" && host !== "windows"))
  throw Error("Store build requires its native host");
const prebuilt = process.argv.includes("--prebuilt");
execFileSync(process.execPath, ["scripts/tauri/stage.mjs", ...(prebuilt ? ["--prebuilt"] : [])], {
  stdio: "inherit",
});
writeFileSync("src-tauri/.generated-build.json", JSON.stringify(meta, null, 2) + "\n");
if (meta.steamBuild)
  await prepareSdk(
    host,
    resolve("src-tauri/.generated-sdk"),
    await loadArchive(process.env.STEAM_SDK_ARCHIVE),
  );
const target = mac ? process.env.TIAO_TARGET || "universal-apple-darwin" : undefined;
const arch = mac
  ? target === "universal-apple-darwin"
    ? "universal"
    : target.startsWith("aarch64")
      ? "arm64"
      : "x64"
  : "x64";
const targetRoot = resolve(process.env.CARGO_TARGET_DIR || "src-tauri/target");
const release = join(targetRoot, ...(target ? [target] : []), "release");
rmSync(join(release, "bundle"), { recursive: true, force: true });
writeFileSync("src-tauri/.generated-config.json", JSON.stringify(config, null, 2) + "\n");
const bundles = mac ? "app" : host === "linux" ? "appimage" : channel === "direct" ? "nsis" : null;
let env = {
  ...process.env,
  CARGO_TARGET_DIR: targetRoot,
  TIAO_DISTRIBUTION_CHANNEL: channel,
  APPLE_CERTIFICATE: signed ? process.env.CSC_LINK || "" : "",
  APPLE_CERTIFICATE_PASSWORD: signed ? process.env.CSC_KEY_PASSWORD || "" : "",
  APPLE_SIGNING_IDENTITY: config.bundle.macOS.signingIdentity,
};
if (signed && env.APPLE_API_KEY_ID) {
  env.APPLE_API_KEY_PATH = env.APPLE_API_KEY;
  env.APPLE_API_KEY = env.APPLE_API_KEY_ID;
}
if (signed && env.APPLE_APP_SPECIFIC_PASSWORD) env.APPLE_PASSWORD = env.APPLE_APP_SPECIFIC_PASSWORD;
if (!signed) {
  delete env.APPLE_CERTIFICATE;
  delete env.APPLE_CERTIFICATE_PASSWORD;
  delete env.APPLE_API_KEY;
  delete env.APPLE_API_KEY_PATH;
  delete env.APPLE_API_KEY_ID;
  delete env.APPLE_API_ISSUER;
  delete env.APPLE_ID;
  delete env.APPLE_PASSWORD;
}
const signing = appleSigning(env, platform === "mas");
env = signing.env;
try {
  execFileSync(
    "pnpm",
    [
      "exec",
      "tauri",
      "build",
      "--config",
      "src-tauri/.generated-config.json",
      ...(target ? ["--target", target] : []),
      ...(bundles ? ["--bundles", bundles] : ["--no-bundle"]),
      ...(process.env.TIAO_ENABLE_UPDATER === "1" ? ["--features", "updater"] : []),
    ],
    { stdio: "inherit", env },
  );
  const output = resolve("dist", channel);
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  const unpacked = join(
    output,
    mac
      ? platform === "mas"
        ? `mas-${arch}`
        : `mac-${arch}`
      : host === "windows"
        ? "win-unpacked"
        : "linux-unpacked",
  );
  mkdirSync(unpacked, { recursive: true });
  if (!mac) copyMetadata();
  function copyMetadata() {
    cpSync("src-tauri/.generated-build.json", join(unpacked, "tiao-build.json"));
  }
  const base = `Tiao-${version}-${platform}-${arch}`;
  const copy = (source, dest) => cpSync(source, dest, { recursive: true, verbatimSymlinks: true });
  const find = (dir, suffix) => {
    const files = readdirSync(dir).filter((name) => name.endsWith(suffix));
    if (files.length !== 1) throw Error(`Expected one ${suffix} in ${dir}`);
    return join(dir, files[0]);
  };
  if (mac) {
    const app = join(unpacked, meta.productName + ".app");
    copy(join(release, "bundle/macos", meta.productName + ".app"), app);
    const notarize = createNotarizer({ env });
    if (signed && platform !== "mas") await notarize(app, { app: true });
    if (process.env.TIAO_ENABLE_UPDATER === "1") {
      const archive = join(release, "bundle/macos", meta.productName + ".app.tar.gz");
      rmSync(archive, { force: true });
      rmSync(archive + ".sig", { force: true });
      execFileSync("tar", ["-czf", archive, "-C", unpacked, meta.productName + ".app"], {
        env: { ...env, COPYFILE_DISABLE: "1" },
      });
      execFileSync("pnpm", ["exec", "tauri", "signer", "sign", archive], { env, stdio: "inherit" });
    }
    if (platform === "mas" && signed) {
      const installer =
        process.env.MAS_INSTALLER_IDENTITY ||
        "3rd Party Mac Developer Installer: Ricos Labs LLC (4BHY8H2J25)";
      execFileSync(
        "productbuild",
        [
          "--component",
          app,
          "/Applications",
          "--sign",
          installer,
          join(unpacked, `Tiao-${version}-mas-universal.pkg`),
        ],
        { stdio: "inherit" },
      );
    } else if (channel === "direct" || channel === "itch") {
      execFileSync("ditto", [
        "-c",
        "-k",
        "--sequesterRsrc",
        "--keepParent",
        app,
        join(output, base + ".zip"),
      ]);
      if (channel === "direct") {
        const image = join(output, ".dmg-source");
        mkdirSync(image);
        execFileSync("ditto", [app, join(image, meta.productName + ".app")]);
        symlinkSync("/Applications", join(image, "Applications"));
        try {
          execFileSync(
            "hdiutil",
            [
              "create",
              "-volname",
              "Tiao",
              "-srcfolder",
              image,
              "-ov",
              "-format",
              "UDZO",
              join(output, base + ".dmg"),
            ],
            { stdio: "inherit" },
          );
        } finally {
          rmSync(image, { recursive: true, force: true });
        }
        if (signed) {
          execFileSync("codesign", [
            "--force",
            "--sign",
            env.APPLE_SIGNING_IDENTITY,
            "--timestamp",
            join(output, base + ".dmg"),
          ]);
          await notarize(join(output, base + ".dmg"));
        }
      }
    }
  } else if (host === "windows") {
    copy(join(release, meta.productName + ".exe"), join(unpacked, meta.productName + ".exe"));
    copy("src-tauri/.generated-build.json", join(unpacked, "tiao-build.json"));
    if (meta.steamBuild) {
      copy("src-tauri/.generated-sdk/steam_api64.dll", join(unpacked, "steam_api64.dll"));
      copy("src-tauri/.generated-sdk/STEAM-SDK-NOTICE.txt", join(unpacked, "STEAM-SDK-NOTICE.txt"));
    }
    if (signed && platform === "windows")
      execFileSync(
        "pwsh",
        [
          "-NoProfile",
          "-NonInteractive",
          "-File",
          "scripts/sign-windows.ps1",
          "-FilePath",
          join(unpacked, meta.productName + ".exe"),
        ],
        { stdio: "inherit" },
      );
    if (channel === "direct") {
      copy(find(join(release, "bundle/nsis"), ".exe"), join(output, base + "-setup.exe"));
      copy(join(unpacked, "Tiao.exe"), join(output, base + "-portable.exe"));
    }
    if (channel === "itch")
      execFileSync(
        "pwsh",
        [
          "-NoProfile",
          "-Command",
          "Compress-Archive -LiteralPath $args[0] -DestinationPath $args[1]",
          join(unpacked, "Tiao.exe"),
          join(output, base + ".zip"),
        ],
        { stdio: "inherit" },
      );
    if (channel === "msstore")
      execFileSync(
        "pwsh",
        [
          "-NoProfile",
          "-File",
          "scripts/tauri/msix.ps1",
          "-Source",
          unpacked,
          "-Output",
          join(output, base + ".appx"),
          "-Version",
          version,
        ],
        { stdio: "inherit" },
      );
  } else {
    const image = find(join(release, "bundle/appimage"), ".AppImage");
    if (meta.steamBuild) {
      const runtime = join(output, ".portable");
      stageLinuxRuntime({ imageDir: join(release, "bundle/appimage"), outputDir: runtime });
      copy(join(runtime, "appdir"), join(unpacked, "appdir"));
      rmSync(runtime, { recursive: true, force: true });
      copy(
        "src-tauri/.generated-sdk/libsteam_api.so",
        join(unpacked, "appdir/usr/bin/libsteam_api.so"),
      );
      copy("src-tauri/.generated-build.json", join(unpacked, "tiao-build.json"));
      copy(
        "scripts/tauri/linux-launcher.sh",
        join(unpacked, channel === "steam-demo" ? "tiao-demo" : "tiao"),
      );
      execFileSync("chmod", [
        "+x",
        join(unpacked, channel === "steam-demo" ? "tiao-demo" : "tiao"),
      ]);
    } else {
      copy(image, join(output, base + ".AppImage"));
    }
  }
  if (process.env.TIAO_ENABLE_UPDATER === "1") {
    const kind = mac ? "macos" : host === "windows" ? "nsis" : "appimage";
    const directory = join(release, "bundle", kind);
    const payload = find(
      directory,
      mac ? ".app.tar.gz" : host === "windows" ? ".exe" : ".AppImage",
    );
    const name = mac
      ? meta.productName + ".app.tar.gz"
      : base + (host === "windows" ? "-setup.exe" : ".AppImage");
    // Signature and payload must use the same published filename.
    copy(payload, join(output, name));
    copy(payload + ".sig", join(output, name + ".sig"));
  }
  console.log(`Packaged ${channel}: ${output}`);
} finally {
  signing.close();
}
