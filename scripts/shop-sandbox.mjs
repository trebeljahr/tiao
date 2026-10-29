#!/usr/bin/env node
// Isolated, local shop QA. Never reads the repo's .env files or OS keychain.
import { spawn } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireServer = createRequire(join(repo, "server/package.json"));

export function sandboxEnv({ mongoPort, apiPort, webPort, stripeKey = "", steamKey = "", secret }) {
  if (stripeKey && !/^(sk|rk)_test_/.test(stripeKey)) throw Error("Refusing non-test Stripe key");
  // Deliberate allowlist: no inherited DB, Redis, mail, analytics, OAuth or store secrets.
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    NODE_ENV: "test",
    NODE_OPTIONS: "--no-deprecation",
    DOTENV_CONFIG_QUIET: "true",
    TOKEN_SECRET: secret,
    BETTER_AUTH_SECRET: secret,
    MONGODB_URI: `mongodb://127.0.0.1:${mongoPort}/tiao_shop_sandbox`,
    PORT: String(apiPort),
    FRONTEND_URL: `http://127.0.0.1:${webPort}`,
    BETTER_AUTH_URL: `http://127.0.0.1:${webPort}`,
    S3_BUCKET_NAME: "sandbox-unused",
    S3_PUBLIC_URL: "http://127.0.0.1:1/sandbox-unused",
    STEAM_APPID: "5035580",
    STEAM_MICROTXN_SANDBOX: "true",
    STEAM_PUBLISHER_WEB_API_KEY: steamKey,
    STRIPE_SECRET_KEY: stripeKey,
    STRIPE_WEBHOOK_SECRET: "",
    TIAO_KEYCHAIN_ACCESS: "deny",
  };
}

export async function freeHighPort() {
  for (let i = 0; i < 3; i++) {
    const port = randomInt(49152, 65536);
    const probe = createServer();
    try {
      await new Promise((ok, fail) => {
        probe.once("error", fail);
        probe.listen(port, "127.0.0.1", ok);
      });
      await new Promise((ok) => probe.close(ok));
      return port;
    } catch {
      /* Try another random high port. */
    }
  }
  throw Error("No free high port after three attempts");
}

async function waitFor(check, child, label, timeout = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (child.exitCode !== null) throw Error(`${label} exited (${child.exitCode})`);
    try {
      if (await check()) return;
    } catch {
      /* Startup is not ready yet. */
    }
    await new Promise((ok) => setTimeout(ok, 200));
  }
  throw Error(`${label} did not become ready`);
}

export async function main(args = process.argv.slice(2)) {
  const allowed = new Set(["--secrets-file", "--without-stripe", "--without-web", "--web-export"]);
  let secretsFile;
  let webExport = join(repo, "client/out");
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i])) throw Error(`Unknown option: ${args[i]}`);
    if (args[i] === "--web-export") {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw Error("--web-export needs a path");
      webExport = resolve(value);
    } else if (args[i] === "--secrets-file") {
      secretsFile = args[++i];
      if (!secretsFile || secretsFile.startsWith("--")) throw Error("--secrets-file needs a path");
    }
  }
  if (!args.includes("--without-web")) {
    await readFile(join(webExport, "shop.html")).catch(() => {
      throw Error("Build client web export first, or pass --web-export <existing client/out>");
    });
  }
  const dotenv = requireServer("dotenv");
  const secrets = secretsFile ? dotenv.parse(await readFile(resolve(secretsFile))) : {};
  const stripeKey = args.includes("--without-stripe") ? "" : secrets.STRIPE_SECRET_KEY || "";
  if (!args.includes("--without-stripe") && !stripeKey)
    throw Error("Provide STRIPE_SECRET_KEY in --secrets-file, or explicitly use --without-stripe");
  const [mongoPort, apiPort, webPort] = [
    await freeHighPort(),
    await freeHighPort(),
    await freeHighPort(),
  ];
  if (new Set([mongoPort, apiPort, webPort]).size !== 3) throw Error("Port collision; retry");
  const env = sandboxEnv({
    mongoPort,
    apiPort,
    webPort,
    stripeKey,
    steamKey: secrets.STEAM_PUBLISHER_WEB_API_KEY || "",
    secret: randomBytes(32).toString("hex"),
  });
  if (stripeKey) {
    const Stripe = requireServer("stripe");
    try {
      await new Stripe(stripeKey, { maxNetworkRetries: 0, timeout: 12000 }).accounts.retrieve();
    } catch (error) {
      throw Error(`Stripe test-key preflight failed (${error.code || error.type || "connection"})`);
    }
  }
  const state = await mkdtemp(join(tmpdir(), "tiao-shop-sandbox-"));
  await mkdir(join(state, "db"), { mode: 0o700 });
  console.log(`State: ${state}`);
  const children = new Set();
  let stopping = false;
  let api;
  function child(command, argv, options = {}) {
    const proc = spawn(command, argv, {
      cwd: state,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    const logFile = join(state, `process-${proc.pid}.log`);
    const log = createWriteStream(logFile, { mode: 0o600 });
    const secretValues = [
      env.TOKEN_SECRET,
      env.STRIPE_SECRET_KEY,
      env.STEAM_PUBLISHER_WEB_API_KEY,
      env.STRIPE_WEBHOOK_SECRET,
    ].filter(Boolean);
    for (const stream of [proc.stdout, proc.stderr]) {
      let pending = "";
      const flush = (final = false) => {
        const lines = pending.split("\n");
        pending = final ? "" : lines.pop();
        for (let line of lines) {
          for (const value of secretValues) line = line.replaceAll(value, "[redacted]");
          log.write(
            line.replace(/(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+/g, "[redacted]") +
              "\n",
          );
        }
      };
      stream.on("data", (data) => {
        pending += data.toString();
        flush();
      });
      stream.on("end", () => flush(true));
    }
    proc.once("close", () => log.end());
    children.add(proc);
    proc.once("error", () => {
      console.error(`${command} could not start`);
      void stop(1);
    });
    proc.on("exit", () => children.delete(proc));
    return proc;
  }
  async function end(proc, timeout = 5000) {
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
    const exited = new Promise((ok) => proc.once("exit", ok));
    proc.kill("SIGTERM");
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeout);
    await exited;
    clearTimeout(timer);
  }
  async function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    process.stdin.pause();
    await Promise.all(
      [...children].filter((proc) => proc !== api && proc !== mongo).map((proc) => end(proc)),
    );
    await end(api, 25000);
    await end(mongo);
    console.log("Owned processes stopped. Isolated database retained in state directory.");
    process.exit(code);
  }
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
  const mongo = child("mongod", [
    "--bind_ip",
    "127.0.0.1",
    "--port",
    String(mongoPort),
    "--dbpath",
    join(state, "db"),
    "--logpath",
    join(state, "mongo.log"),
    "--quiet",
  ]);
  // Keep logs out of the transcript (raw third-party errors can include credentials).
  const { MongoClient } = requireServer("mongodb");
  await waitFor(
    async () => {
      const c = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 200 });
      try {
        await c.connect();
        return true;
      } finally {
        await c.close();
      }
    },
    mongo,
    "MongoDB",
  ).catch(async (error) => {
    console.error(error.message);
    await stop(1);
  });
  let webhookSecret;
  if (stripeKey) {
    const cliConfig = join(state, "stripe.toml");
    await writeFile(cliConfig, "", { mode: 0o600 });
    const listener = child(
      "stripe",
      [
        "listen",
        "--config",
        cliConfig,
        "--forward-to",
        `http://127.0.0.1:${apiPort}/api/shop/webhook`,
        "--events",
        "checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,charge.refunded,charge.dispute.created,charge.dispute.updated,charge.dispute.closed,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed",
      ],
      { env: { ...env, STRIPE_API_KEY: stripeKey, STRIPE_NO_AUTO_UPDATE: "1" } },
    );
    let output = "";
    const parse = (data) => {
      output = (output + data.toString()).slice(-8192);
      webhookSecret = output.match(/whsec_[A-Za-z0-9]+/)?.[0];
    };
    listener.stdout.on("data", parse);
    listener.stderr.on("data", parse);
    await waitFor(() => Boolean(webhookSecret), listener, "Stripe listener").catch(
      async (error) => {
        console.error(error.message);
        await stop(1);
      },
    );
    env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    console.log("Stripe test-mode listener ready; signing secret held in memory.");
  }
  async function startApi() {
    api = child(process.execPath, [
      "--import",
      pathToFileURL(requireServer.resolve("tsx")).href,
      join(repo, "scripts/shop-sandbox-api.mjs"),
    ]);
    api.stdout.resume();
    api.stderr.resume();
    await waitFor(
      async () => {
        const response = await fetch(`http://127.0.0.1:${apiPort}/api/shop/iap/config`);
        const config = await response.json();
        if (
          config.steam.enabled !== Boolean(env.STEAM_PUBLISHER_WEB_API_KEY) ||
          (config.steam.enabled && config.steam.sandbox !== true)
        )
          throw Error("Steam sandbox routing mismatch");
        return response.ok;
      },
      api,
      "API",
    );
    console.log(
      `API ready: http://127.0.0.1:${apiPort}; Steam ${env.STEAM_PUBLISHER_WEB_API_KEY ? "sandbox" : "disabled (no publisher key)"}`,
    );
  }
  await startApi().catch(async (error) => {
    console.error(error.message);
    await stop(1);
  });
  if (!args.includes("--without-web")) {
    const web = child(process.execPath, [join(repo, "scripts/shop-sandbox-web.mjs")], {
      cwd: join(repo, "client"),
      env: {
        ...env,
        NODE_ENV: "development",
        PORT: String(webPort),
        API_PORT: String(apiPort),
        TIAO_QA_WEB_EXPORT: webExport,
      },
    });
    web.stdout.resume();
    web.stderr.resume();
    await waitFor(
      async () => (await fetch(`http://127.0.0.1:${webPort}/api/shop/catalog`)).ok,
      web,
      "Web",
      90000,
    ).catch(async (error) => {
      console.error(error.message);
      await stop(1);
    });
    console.log(`Web export: ${webExport}`);
    console.log(`Shop: http://127.0.0.1:${webPort}/shop`);
  }
  async function saveState() {
    await writeFile(
      join(state, "session.json"),
      JSON.stringify(
        {
          repo,
          apiPort,
          webPort,
          mongoPort,
          mongoUri: env.MONGODB_URI,
          steamSandbox: true,
          steamEnabled: Boolean(env.STEAM_PUBLISHER_WEB_API_KEY),
          stripeEnabled: Boolean(stripeKey),
          pids: [...children].map((p) => p.pid),
          apiPid: api.pid,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  }
  await saveState();
  console.log("Enter r to restart API (same isolated DB); q to stop. Ctrl-C also cleans up.");
  let restarting = false;
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", async (data) => {
    if (data.trim() === "q") await stop();
    if (data.trim() === "r" && !restarting) {
      restarting = true;
      try {
        await end(api);
        await startApi();
        await saveState();
      } catch (error) {
        console.error(error.message);
        await stop(1);
      } finally {
        restarting = false;
      }
    }
  });
  process.stdin.resume();
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
