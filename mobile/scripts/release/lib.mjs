import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

// Shared release checks for the Tiao mobile apps. Ported from Raptor Runner's
// proven pipeline; the scripts run with mobile/ as the working directory.
export const repository = "trebeljahr/tiao";
export const bundleId = "com.ricoslabs.tiao";
export const teamId = "4BHY8H2J25";
export const buildWorkflow = "build-mobile.yml";
export const mobileTargets = ["android-universal", "ios-arm64"];
export const credentials = {
  android: [
    "ANDROID_KEYSTORE_BASE64",
    "ANDROID_KEYSTORE_PASSWORD",
    "ANDROID_KEY_ALIAS",
    "ANDROID_KEY_PASSWORD",
  ],
  ios: [
    "APPLE_CERTIFICATE_BASE64",
    "APPLE_CERTIFICATE_PASSWORD",
    "APPLE_PROVISIONING_PROFILE_BASE64",
  ],
  play: ["PLAY_SERVICE_ACCOUNT_JSON"],
  testflight: ["APPLE_API_KEY_BASE64", "APPLE_API_KEY_ID", "APPLE_API_ISSUER_ID"],
};

export function requireCredentials(target, env) {
  if (!Object.hasOwn(credentials, target)) throw new Error(`Unknown credential target: ${target}`);
  // An unset secret expands to "", and base64 --decode of "" writes an empty
  // file. Check presence by name first so the failure says what is missing.
  const missing = credentials[target].filter((name) => !env[name]?.trim());
  if (missing.length) throw new Error(`Missing ${target} configuration: ${missing.join(", ")}`);
}

export function version(value) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`Release version must be a stable X.Y.Z value: ${value}`);
  }
  return value;
}

export function buildNumber(value) {
  // One explicit number for both stores. It must exceed their existing builds.
  if (!/^[1-9]\d*$/.test(String(value)) || Number(value) > 2100000000) {
    throw new Error(
      "Set RELEASE_BUILD_NUMBER to an integer from 1 to 2100000000, above both stores' current build numbers.",
    );
  }
  return String(value);
}

export function requireMain(env) {
  if (
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_REPOSITORY !== repository
  ) {
    throw new Error(`Release signing and publishing must be dispatched from main in ${repository}`);
  }
}

export function validateRun(run, runId) {
  if (
    !/^[1-9]\d*$/.test(String(runId)) ||
    String(run.id) !== String(runId) ||
    run.head_repository?.full_name !== repository ||
    run.event !== "workflow_dispatch" ||
    run.head_branch !== "main" ||
    run.path !== `.github/workflows/${buildWorkflow}` ||
    run.conclusion !== "success" ||
    !/^[a-f0-9]{40}$/.test(run.head_sha)
  ) {
    throw new Error(
      `Source must be a successful main-branch dispatch of ${buildWorkflow} in ${repository}`,
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
  buildNumber(manifest.buildNumber);
  const target = `${manifest.platform}-${manifest.arch}`;
  if (!mobileTargets.includes(target)) throw new Error(`Unknown artifact target: ${target}`);
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
    seen.add(file.name);
    const path = join(directory, file.name);
    if (!lstatSync(path).isFile() || sha256(path) !== file.sha256) {
      throw new Error(`Artifact checksum mismatch: ${file.name}`);
    }
  }
  return target;
}
