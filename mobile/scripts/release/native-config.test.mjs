import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Guards the committed native settings that store review and the release
// verifiers depend on, so a `cap` regeneration cannot drop them silently.
const mobile = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(join(mobile, path), "utf8");

test("iOS Info.plist declares export compliance, the OAuth scheme and the display name", () => {
  const plist = read("ios/App/App/Info.plist");
  assert.match(plist, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
  assert.match(plist, /<key>CFBundleDisplayName<\/key>\s*<string>Tiao<\/string>/);
  assert.match(plist, /<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>tiao<\/string>/);
  assert.match(
    plist,
    /<key>CFBundleShortVersionString<\/key>\s*<string>\$\(MARKETING_VERSION\)<\/string>/,
  );
  assert.match(
    plist,
    /<key>CFBundleVersion<\/key>\s*<string>\$\(CURRENT_PROJECT_VERSION\)<\/string>/,
  );
});

test("iOS privacy manifest ships in the app bundle and declares no tracking", () => {
  const project = read("ios/App/App.xcodeproj/project.pbxproj");
  assert.match(project, /PrivacyInfo\.xcprivacy in Resources \*\/,/);
  const manifest = read("ios/App/App/PrivacyInfo.xcprivacy");
  assert.match(manifest, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  for (const type of [
    "EmailAddress",
    "UserID",
    "GameplayContent",
    "ProductInteraction",
    "CrashData",
  ]) {
    assert.ok(manifest.includes(`NSPrivacyCollectedDataType${type}`), type);
  }
  assert.ok(manifest.includes("CA92.1"));
  assert.doesNotMatch(manifest, /<key>NSPrivacyCollectedDataTypeTracking<\/key>\s*<true\/>/);
});

test("Android manifest removes AD_ID, disables backup and accepts tiao://auth/complete", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  assert.match(
    manifest,
    /android:name="com\.google\.android\.gms\.permission\.AD_ID"\s+tools:node="remove"/,
  );
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
  assert.match(manifest, /android:scheme="tiao"\s+android:host="auth"\s+android:path="\/complete"/);
});

test("Android targets SDK 36 and takes versions from package.json and the build number", () => {
  const variables = read("android/variables.gradle");
  assert.match(variables, /compileSdkVersion = 36/);
  assert.match(variables, /targetSdkVersion = 36/);
  const gradle = read("android/app/build.gradle");
  assert.match(gradle, /versionCode releaseBuildNumber \? releaseBuildNumber\.toInteger\(\) : 1/);
  assert.match(gradle, /versionName packageVersion/);
  assert.match(gradle, /minifyEnabled true/);
  assert.match(gradle, /applicationId "com\.ricoslabs\.tiao"/);
});

test("mobile-version writes package.json version and the build number into the Xcode project", () => {
  const root = mkdtempSync(join(tmpdir(), "tiao-mobile-version-"));
  try {
    cpSync(
      join(mobile, "ios/App/App.xcodeproj/project.pbxproj"),
      join(root, "ios/App/App.xcodeproj/project.pbxproj"),
    );
    cpSync(join(mobile, "package.json"), join(root, "package.json"));
    const script = fileURLToPath(new URL("./mobile-version.mjs", import.meta.url));
    const run = (env) =>
      execFileSync(process.execPath, [script], {
        cwd: root,
        env: { ...process.env, ...env },
        stdio: "pipe",
      });
    run({ RELEASE_BUILD_NUMBER: "77" });
    const project = readFileSync(join(root, "ios/App/App.xcodeproj/project.pbxproj"), "utf8");
    const { version } = JSON.parse(read("package.json"));
    assert.equal(project.match(/MARKETING_VERSION = [^;]+;/g).length, 2);
    for (const line of project.match(/MARKETING_VERSION = [^;]+;/g))
      assert.equal(line, `MARKETING_VERSION = ${version};`);
    for (const line of project.match(/CURRENT_PROJECT_VERSION = [^;]+;/g))
      assert.equal(line, "CURRENT_PROJECT_VERSION = 77;");
    assert.throws(() => run({ RELEASE_BUILD_NUMBER: "0" }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
