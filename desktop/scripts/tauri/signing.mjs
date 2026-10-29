import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Same isolated-keychain pattern as Mesozoic's Apple build. Never change the
// default keychain; restore the existing search list and delete our material.
export function appleSigning(
  env,
  mas = false,
  {
    platform = process.platform,
    run = (...args) =>
      execFileSync("security", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
  } = {},
) {
  if (env.TIAO_SIGNED !== "1" || platform !== "darwin") return { env, close() {} };
  if (!env.CSC_LINK) return { env, close() {} };
  const root = mkdtempSync(join(tmpdir(), "tiao-signing-"));
  const keychain = join(root, "build.keychain-db");
  const password = randomBytes(24).toString("hex");
  const p12 = join(root, "certificate.p12");
  const original = [...run("list-keychains", "-d", "user").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const close = () => {
    try {
      run("list-keychains", "-d", "user", "-s", ...original);
    } finally {
      try {
        run("delete-keychain", keychain);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  };
  try {
    writeFileSync(
      p12,
      existsSync(env.CSC_LINK) ? readFileSync(env.CSC_LINK) : Buffer.from(env.CSC_LINK, "base64"),
      { mode: 0o600 },
    );
    run("create-keychain", "-p", password, keychain);
    run("set-keychain-settings", "-lut", "21600", keychain);
    run("unlock-keychain", "-p", password, keychain);
    run(
      "import",
      p12,
      "-P",
      env.CSC_KEY_PASSWORD || "",
      "-T",
      "/usr/bin/codesign",
      "-T",
      "/usr/bin/productbuild",
      "-t",
      "cert",
      "-f",
      "pkcs12",
      "-k",
      keychain,
    );
    run("list-keychains", "-d", "user", "-s", keychain, ...original);
    run("set-key-partition-list", "-S", "apple-tool:,apple:", "-k", password, keychain);
    const identity =
      env.APPLE_SIGNING_IDENTITY ||
      (mas
        ? "Apple Distribution: Ricos Labs LLC (4BHY8H2J25)"
        : "Developer ID Application: Ricos Labs LLC (4BHY8H2J25)");
    const signingEnv = { ...env, APPLE_SIGNING_IDENTITY: identity, APPLE_KEYCHAIN: keychain };
    delete signingEnv.APPLE_CERTIFICATE;
    delete signingEnv.APPLE_CERTIFICATE_PASSWORD;
    return { env: signingEnv, close };
  } catch (_error) {
    close();
    throw Error(
      "Could not prepare Apple signing keychain; check the certificate and signing configuration.",
    );
  }
}
