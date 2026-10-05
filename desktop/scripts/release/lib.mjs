// Shared release rules for build-desktop.yml and publish-desktop.yml.
// Ported from Raptor Runner's scripts/release/lib.mjs; Tiao adds the Mac App
// Store and Microsoft Store targets and per-file distribution channels.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export const repository = "trebeljahr/tiao";
export const appId = "com.ricoslabs.tiao";
export const teamId = "4BHY8H2J25";
export const steamAppId = "5035580";
export const buildWorkflow = "build-desktop.yml";
export const channels = ["direct", "itch", "steam", "mas", "msstore"];

// The lowest electron-builder that may sign a macOS build. Through 26.16.0 its
// throwaway keychain got a random password, but `security
// set-key-partition-list -k` was handed the p12's password instead. macOS 14
// and 15 ignore the mismatch; macOS 26 verifies it and fails with
// "SecKeychainUnlock: The user name or passphrase you entered is not correct"
// (electron-userland/electron-builder#10172, fixed in 26.16.1). npm's `latest`
// dist-tag still points below the fix, so a routine update can walk back.
export const minElectronBuilder = "26.16.1";

/** Compare two x.y.z versions numerically, ignoring prerelease suffixes. */
export function compareVersions(a, b) {
  const parts = (v) =>
    String(v)
      .split("-")[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

/**
 * The electron-builder and app-builder-lib versions a pnpm lockfile resolves.
 * Read from the lockfile, not node_modules, so the check runs before install.
 */
export function lockedBuilderVersions(lockfileText) {
  const found = (name) => [
    ...new Set(
      [...lockfileText.matchAll(new RegExp("^  " + name + "@([0-9][^(:\\s]*)", "gm"))].map(
        (m) => m[1],
      ),
    ),
  ];
  return { electronBuilder: found("electron-builder"), appBuilderLib: found("app-builder-lib") };
}

// One build leg per target. macOS is universal: the Mac App Store takes one
// binary per build, and a universal Steam depot needs no launcher script.
export const desktopTargets = [
  {
    platform: "macos",
    arch: "universal",
    runner: "macos-15",
    flag: "mac",
    channels: ["direct", "itch", "steam"],
  },
  {
    platform: "windows",
    arch: "x64",
    runner: "windows-2025",
    flag: "win",
    channels: ["direct", "itch", "steam"],
  },
  {
    platform: "linux",
    arch: "x64",
    runner: "ubuntu-24.04",
    flag: "linux",
    channels: ["direct", "itch", "steam"],
  },
  { platform: "mas", arch: "universal", runner: "macos-15", flag: "mac", channels: ["mas"] },
  { platform: "msstore", arch: "x64", runner: "windows-2025", flag: "win", channels: ["msstore"] },
];

export const platformSelections = {
  all: ["macos", "windows", "linux", "mas", "msstore"],
  desktop: ["macos", "windows", "linux"],
  stores: ["mas", "msstore"],
  macos: ["macos"],
  windows: ["windows"],
  linux: ["linux"],
  mas: ["mas"],
  msstore: ["msstore"],
};

// What each publish destination needs from one signed build run.
export const destinations = {
  "downloads-draft": { platforms: ["macos", "windows", "linux"], channel: "direct" },
  itch: { platforms: ["macos", "windows", "linux"], channel: "itch" },
  steam: { platforms: ["macos", "windows", "linux"], channel: "steam" },
  mas: { platforms: ["mas"], channel: "mas" },
  msstore: { platforms: ["msstore"], channel: "msstore" },
};

export const credentials = {
  macos: [
    "MAC_CSC_LINK",
    "MAC_CSC_KEY_PASSWORD",
    "APPLE_API_KEY_BASE64",
    "APPLE_API_KEY_ID",
    "APPLE_API_ISSUER_ID",
  ],
  // Azure Artifact Signing uses GitHub OIDC; the IDs are not secrets.
  windows: [],
  linux: [],
  mas: ["MAS_CSC_LINK", "MAS_CSC_KEY_PASSWORD", "MAS_PROVISIONING_PROFILE_BASE64"],
  msstore: [
    "WINDOWS_STORE_IDENTITY_NAME",
    "WINDOWS_STORE_PUBLISHER",
    "WINDOWS_STORE_PUBLISHER_DISPLAY_NAME",
  ],
  itch: ["BUTLER_API_KEY", "ITCH_USER", "ITCH_GAME"],
  steam: [
    "STEAM_USERNAME",
    "STEAM_CONFIG_VDF",
    "STEAM_DEPOT_WINDOWS",
    "STEAM_DEPOT_LINUX",
    "STEAM_DEPOT_MACOS",
  ],
  appstore: ["APPLE_API_KEY_BASE64", "APPLE_API_KEY_ID", "APPLE_API_ISSUER_ID"],
  "msstore-submission": [
    "MSSTORE_TENANT_ID",
    "MSSTORE_CLIENT_ID",
    "MSSTORE_CLIENT_SECRET",
    "MSSTORE_SELLER_ID",
    "MSSTORE_PRODUCT_ID",
  ],
};

const isSet = (env, name) => Boolean(env[name]?.trim());

export function requireCredentials(target, env) {
  if (!Object.hasOwn(credentials, target)) throw new Error("Unknown credential target: " + target);
  const missing = credentials[target].filter((name) => !isSet(env, name));
  if (missing.length)
    throw new Error("Missing " + target + " configuration: " + missing.join(", "));
}

// All-or-none: true when every name is set, false when none is, error otherwise.
export function optionalCredentials(target, env) {
  if (!Object.hasOwn(credentials, target)) throw new Error("Unknown credential target: " + target);
  const present = credentials[target].filter((name) => isSet(env, name));
  if (!present.length) return false;
  requireCredentials(target, env);
  return true;
}

export function version(value) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw new Error("Release version must be a stable X.Y.Z value: " + value);
  }
  return value;
}

export const releaseTag = (value) => "desktop-v" + version(value);

export function requireMain(env) {
  if (
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_REPOSITORY !== repository
  ) {
    throw new Error("Release signing and publishing must be dispatched from main in " + repository);
  }
}

export function selectTargets(selection) {
  if (!Object.hasOwn(platformSelections, selection))
    throw new Error("Unknown desktop platform selection: " + selection);
  return desktopTargets.filter((target) => platformSelections[selection].includes(target.platform));
}

export function validateRun(run, workflow, runId) {
  if (
    !/^[1-9]\d*$/.test(String(runId)) ||
    String(run.id) !== String(runId) ||
    run.head_repository?.full_name !== repository ||
    run.event !== "workflow_dispatch" ||
    run.head_branch !== "main" ||
    run.path !== ".github/workflows/" + workflow ||
    run.conclusion !== "success" ||
    !/^[a-f0-9]{40}$/.test(run.head_sha)
  ) {
    throw new Error(
      "Source must be a successful main-branch dispatch of " + workflow + " in " + repository,
    );
  }
}

export function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function validateManifest(manifest, run, directory) {
  if (
    manifest.schema !== 1 ||
    manifest.repository !== repository ||
    manifest.commit !== run.head_sha ||
    manifest.runId !== String(run.id) ||
    manifest.mode !== "signed"
  ) {
    throw new Error("Artifact metadata does not match the signed source run.");
  }
  version(manifest.version);
  const target = desktopTargets.find(
    (t) => t.platform === manifest.platform && t.arch === manifest.arch,
  );
  if (!target)
    throw new Error("Unknown artifact target: " + manifest.platform + "-" + manifest.arch);
  if (!Array.isArray(manifest.files) || !manifest.files.length)
    throw new Error("Empty artifact manifest.");
  const seen = new Set();
  for (const file of manifest.files) {
    if (
      typeof file.name !== "string" ||
      basename(file.name) !== file.name ||
      file.name.includes("\\") ||
      !/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(file.name) ||
      seen.has(file.name) ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    ) {
      throw new Error("Unsafe or duplicate artifact name/digest.");
    }
    if (!target.channels.includes(file.channel))
      throw new Error("Unexpected channel for " + file.name);
    seen.add(file.name);
    const path = join(directory, file.name);
    if (!lstatSync(path).isFile() || sha256(path) !== file.sha256)
      throw new Error("Artifact checksum mismatch: " + file.name);
  }
  return target;
}

// The manifests a destination publishes: exactly one per required target,
// one version, each carrying files for the destination's channel.
export function requireDestinationSet(manifests, destination) {
  if (!Object.hasOwn(destinations, destination))
    throw new Error("Unknown destination: " + destination);
  const { platforms, channel } = destinations[destination];
  const picked = manifests.filter((m) => platforms.includes(m.platform));
  const found = picked.map((m) => m.platform).sort();
  if (JSON.stringify(found) !== JSON.stringify([...platforms].sort())) {
    throw new Error(
      destination +
        " requires exactly one signed build of: " +
        platforms.join(", ") +
        " from one run.",
    );
  }
  if (new Set(manifests.map((m) => m.version)).size !== 1)
    throw new Error("Artifacts disagree on the version.");
  for (const manifest of picked) {
    if (!manifest.files.some((file) => file.channel === channel)) {
      throw new Error(manifest.platform + " has no " + channel + " files.");
    }
  }
  return picked;
}

// The files of one channel in one manifest with the given suffix; exactly one.
export function oneFile(manifest, channel, suffix) {
  const files = manifest.files.filter(
    (file) => file.channel === channel && file.name.endsWith(suffix),
  );
  if (files.length !== 1)
    throw new Error("Expected one " + channel + " " + suffix + " for " + manifest.platform);
  return files[0];
}

export function steamDepotIds(env) {
  const ids = ["WINDOWS", "LINUX", "MACOS"].map((os) => env["STEAM_DEPOT_" + os]);
  if (ids.some((id) => !/^[1-9]\d*$/.test(id ?? "")) || new Set(ids).size !== ids.length) {
    throw new Error("Set three distinct Steam depot IDs.");
  }
  return { windows: ids[0], linux: ids[1], macos: ids[2] };
}

export function steamBranch(value = "") {
  if (value && (!/^[a-zA-Z0-9_-]+$/.test(value) || value === "default")) {
    throw new Error("Choose a Steam beta branch or leave empty for upload only.");
  }
  return value;
}

export function steamBuildVdf({ version: appVersion, commit, outputDir, roots, depots, branch }) {
  const quote = (value) => JSON.stringify(String(value));
  const depot = (os) =>
    quote(depots[os]) +
    ' { "ContentRoot" ' +
    quote(roots[os]) +
    ' "FileMapping" { "LocalPath" "*" "DepotPath" "." "recursive" "1" }' +
    ' "FileExclusion" "steam_appid.txt" "FileExclusion" "*.pdb" "FileExclusion" "*.map" "FileExclusion" ".DS_Store" }';
  return (
    '"appbuild" { "AppID" ' +
    quote(steamAppId) +
    ' "Desc" ' +
    quote("Tiao " + appVersion + " " + commit) +
    ' "BuildOutput" ' +
    quote(outputDir) +
    (branch ? ' "SetLive" ' + quote(branch) : "") +
    ' "Depots" { ' +
    ["windows", "linux", "macos"].map(depot).join("\n") +
    " } }\n"
  );
}

// Reads one file out of an app.asar without dependencies (Chromium pickle
// header: [4][header pickle size] then [payload size][json length][json]).
export function readAsarFile(asarPath, name) {
  const buffer = readFileSync(asarPath);
  const headerSize = buffer.readUInt32LE(4);
  const jsonLength = buffer.readUInt32LE(12);
  const header = JSON.parse(buffer.toString("utf8", 16, 16 + jsonLength));
  let node = header;
  for (const part of name.split("/")) {
    node = node.files?.[part];
    if (!node) throw new Error(name + " is not in " + asarPath);
  }
  if (node.unpacked) throw new Error(name + " is unpacked from " + asarPath);
  const start = 8 + headerSize + Number(node.offset);
  return buffer.subarray(start, start + node.size);
}

export function asarHas(asarPath, prefix) {
  const buffer = readFileSync(asarPath);
  const header = JSON.parse(buffer.toString("utf8", 16, 16 + buffer.readUInt32LE(12)));
  let node = header;
  for (const part of prefix.split("/")) {
    node = node.files?.[part];
    if (!node) return false;
  }
  return true;
}

// The baked channel decides updater, Steam and store behaviour at runtime;
// a build with the wrong metadata runs fine and misbehaves silently.
export function assertPackagedChannel(asarPath, channel) {
  const meta = JSON.parse(readAsarFile(asarPath, "package.json").toString("utf8"));
  if (meta.distributionChannel !== channel) {
    throw new Error(
      asarPath + " is baked as " + meta.distributionChannel + ", expected " + channel,
    );
  }
  const steam = meta.steamBuild === true || meta.steamBuild === "true";
  if (steam !== (channel === "steam"))
    throw new Error(asarPath + " has the wrong steamBuild flag for " + channel);
  if (channel === "steam" && String(meta.steamAppId) !== steamAppId)
    throw new Error(asarPath + " has the wrong Steam appid");
  if (
    (channel === "mas" || channel === "msstore") &&
    asarHas(asarPath, "node_modules/steamworks.js")
  ) {
    throw new Error(asarPath + " ships steamworks.js in a store build");
  }
  return meta;
}
