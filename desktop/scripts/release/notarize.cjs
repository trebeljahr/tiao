// Apple can accept notarization, then drop the connection while stapling its
// ticket. Recover that step without rebuilding or weakening any signature gate.
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

function credentials(env) {
  if (env.APPLE_KEYCHAIN_PROFILE) {
    return {
      keychainProfile: env.APPLE_KEYCHAIN_PROFILE,
      ...(env.APPLE_KEYCHAIN ? { keychain: env.APPLE_KEYCHAIN } : {}),
    };
  }
  if (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) {
    return { appleApiKey: env.APPLE_API_KEY, appleApiKeyId: env.APPLE_API_KEY_ID, appleApiIssuer: env.APPLE_API_ISSUER };
  }
  if (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) {
    return { appleId: env.APPLE_ID, appleIdPassword: env.APPLE_APP_SPECIFIC_PASSWORD, teamId: env.APPLE_TEAM_ID };
  }
  throw Error("Signed macOS builds need a notarytool profile or complete Apple notarization credentials.");
}
const diagnostic = error => [error.message,error.stdout,error.stderr].filter(Boolean).join("\n");
const transient = error => /NSURLErrorDomain|network connection was lost|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|timed out|HTTP.*(?:429|50[234])/i.test(diagnostic(error));

function createNotarizer({ notarize, run, wait = delay, env = process.env, warn = console.warn }) {
  async function retry(operation, shouldRetry) {
    for (let attempt = 1; ; attempt++) {
      try { return await operation(); }
      catch (error) {
        if (attempt === 3 || !shouldRetry(error)) throw error;
        warn(`[notarize] Temporary Apple service failure; retry ${attempt + 1}/3 in 20 seconds.`);
        await wait(20000);
      }
    }
  }
  return async context => {
    if (context.electronPlatformName !== "darwin" || env.TIAO_SIGNED !== "1") return;
    const appPath = path.join(context.appOutDir,context.packager.appInfo.productFilename + ".app");
    const auth = credentials(env);
    try {
      await retry(() => notarize({ appPath,...auth }),error => transient(error) && !/Failed to staple/i.test(diagnostic(error)));
    } catch (error) {
      // This error is thrown only after Apple's notarization accepted the app.
      // Ticket delivery can lag or lose its connection. Never ignore a rejection.
      if (!/Failed to staple your application with code:/i.test(diagnostic(error))) throw error;
      await retry(() => run("xcrun",["stapler","staple",appPath]),() => true);
    }
    await retry(() => run("xcrun",["stapler","validate",appPath]),transient);
  };
}
module.exports = async context => createNotarizer({
  notarize: require("@electron/notarize").notarize,
  run: (command,args) => execFileSync(command,args,{encoding:"utf8",stdio:["ignore","pipe","pipe"]}),
})(context);
module.exports.credentials = credentials;
module.exports.createNotarizer = createNotarizer;
