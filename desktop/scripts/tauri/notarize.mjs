import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
export function notaryCredentials(env) {
  if (env.APPLE_KEYCHAIN_PROFILE) return ["--keychain-profile", env.APPLE_KEYCHAIN_PROFILE];
  if (env.APPLE_API_KEY_PATH && env.APPLE_API_KEY && env.APPLE_API_ISSUER)
    return [
      "--key",
      env.APPLE_API_KEY_PATH,
      "--key-id",
      env.APPLE_API_KEY,
      "--issuer",
      env.APPLE_API_ISSUER,
    ];
  if (env.APPLE_ID && env.APPLE_PASSWORD && env.APPLE_TEAM_ID)
    return [
      "--apple-id",
      env.APPLE_ID,
      "--password",
      env.APPLE_PASSWORD,
      "--team-id",
      env.APPLE_TEAM_ID,
    ];
  throw Error("Signed macOS packages require Apple notarization credentials or a keychain profile");
}
export function createNotarizer({
  env = process.env,
  run = (command, args) =>
    execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
  wait = setTimeout,
} = {}) {
  const staple = async (path) => {
    for (let attempt = 0; ; attempt++) {
      try {
        run("xcrun", ["stapler", "staple", path]);
        run("xcrun", ["stapler", "validate", path]);
        return;
      } catch {
        if (attempt === 2) throw Error("Could not staple and validate the Apple ticket");
        await wait(20000);
      }
    }
  };
  const submit = async (path) => {
    const credentials = notaryCredentials(env);
    for (let attempt = 0; ; attempt++) {
      let text;
      try {
        text = run("xcrun", [
          "notarytool",
          "submit",
          path,
          ...credentials,
          "--wait",
          "--timeout",
          "20m",
          "--output-format",
          "json",
        ]);
      } catch {
        if (attempt === 2) throw Error("Apple notarization transport failed");
        await wait(20000);
        continue;
      }
      const result = JSON.parse(text);
      if (result.status !== "Accepted") throw Error("Apple notarization rejected the package");
      break;
    }
    await staple(path);
  };
  return async (path, { app = false } = {}) => {
    if (!app) {
      await submit(path);
      return;
    }
    try {
      run("xcrun", ["stapler", "validate", path]);
      return;
    } catch {}
    // Mesozoic's packaging verifies/repairs app tickets before creating archives.
    try {
      await staple(path);
      return;
    } catch {}
    const root = mkdtempSync(join(tmpdir(), "tiao-notary-"));
    try {
      const zip = join(root, "app.zip");
      run("ditto", ["-c", "-k", "--keepParent", path, zip]);
      const credentials = notaryCredentials(env);
      const result = JSON.parse(
        run("xcrun", [
          "notarytool",
          "submit",
          zip,
          ...credentials,
          "--wait",
          "--timeout",
          "20m",
          "--output-format",
          "json",
        ]),
      );
      if (result.status !== "Accepted") throw Error("Apple notarization rejected the app");
      await staple(path);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
}
