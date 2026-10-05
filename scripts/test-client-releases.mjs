/**
 * Local mixed-release browser proof for the web client.
 *
 * Builds two real production clients: B (this source) and C (B plus a changed
 * lazily loaded AuthDialog description), with C carrying B's assets as CI
 * would. Both run through the production server.mjs behind a routing proxy
 * that decides per request which release answers. Chromium (HTTP cache off,
 * service workers blocked) then checks the release boundaries. The API is a
 * stub that answers 401; no external service is contacted except Google Fonts
 * during `next build`.
 *
 *   node scripts/test-client-releases.mjs
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
  createWriteStream,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const client = join(root, "client");
const require = createRequire(join(root, "package.json"));
const { chromium } = require(
  require.resolve("playwright-core", { paths: [require.resolve("@playwright/test")] }),
);
const { compose, verify } = await import(join(client, "scripts/carry-release-static.mjs"));

const B = "b".repeat(40);
const C = "c".repeat(40);
const OLD_TEXT = "Log in or create an account to save your profile.";
const NEW_TEXT = "Log in or create an account to keep your profile (release C).";
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function eventually(check, label, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await check()) return;
    } catch {}
    await sleep(100);
  }
  throw new Error(`Timed out: ${label}`);
}
async function freePort() {
  for (;;) {
    const port = 49_152 + Math.floor(Math.random() * 16_000);
    const probe = createServer();
    try {
      await new Promise((done, fail) => {
        probe.once("error", fail);
        probe.listen(port, "127.0.0.1", done);
      });
    } catch {
      continue;
    }
    await new Promise((done) => probe.close(done));
    return port;
  }
}

// PROOF_WORK reuses earlier builds in that directory (iteration aid).
const work = process.env.PROOF_WORK || (await mkdtemp(join(tmpdir(), "tiao-client-releases-")));
const report = { checks: [], requests: 0 };
const children = [];
let browser, proxy, apiStub, lastPage;

function build(label, sha) {
  if (existsSync(join(work, label, ".next/BUILD_ID"))) return;
  const env = {
    ...process.env,
    NODE_ENV: "production",
    BUILD_COMMIT: sha,
    NODE_OPTIONS: "--network-family-autoselection-attempt-timeout=3000",
  };
  execFileSync(
    process.execPath,
    [join(client, "node_modules/next/dist/bin/next"), "build", "--webpack"],
    {
      cwd: client,
      env,
      stdio: [
        "ignore",
        openSync(join(work, `build-${label}.log`), "w"),
        openSync(join(work, `build-${label}.err.log`), "w"),
      ],
    },
  );
  const target = join(work, label);
  renameSync(join(client, ".next"), join(target, ".next"));
}

async function instance(label, sha, apiPort) {
  const dir = join(work, label);
  for (const name of [
    "node_modules",
    "public",
    "messages",
    "src",
    "next.config.mjs",
    "package.json",
    "server.mjs",
    "runtime-proxy.mjs",
    "release-assets.mjs",
    "tunnel-envelope.mjs",
  ])
    if (!existsSync(join(dir, name))) symlinkSync(join(client, name), join(dir, name));
  const port = await freePort();
  const log = createWriteStream(join(work, `server-${label}.log`));
  const child = spawn(process.execPath, [join(dir, "server.mjs")], {
    cwd: dir,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "production",
      PORT: String(port),
      BUILD_COMMIT: sha,
      API_URL: `http://127.0.0.1:${apiPort}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  children.push(child);
  await eventually(
    async () => (await fetch(`http://127.0.0.1:${port}/health`)).ok,
    `${label} ready`,
    60_000,
  );
  return { label, port, child };
}

try {
  await mkdir(join(work, "B"), { recursive: true });
  await mkdir(join(work, "C"), { recursive: true });
  const dialogPath = join(client, "app/[locale]/AuthDialog.tsx");
  const original = readFileSync(dialogPath, "utf8");
  assert.ok(original.includes(OLD_TEXT), "AuthDialog description moved; update the proof");
  build("B", B);
  try {
    writeFileSync(dialogPath, original.replace(OLD_TEXT, NEW_TEXT));
    build("C", C);
  } finally {
    writeFileSync(dialogPath, original);
  }
  // C carries B exactly as CI composes it from the previous image.
  const previous = join(work, "previous-of-C");
  await rm(previous, { recursive: true, force: true });
  await rm(join(work, "C/release-static"), { recursive: true, force: true });
  await mkdir(previous);
  symlinkSync(join(work, "B/.next/static"), join(previous, "static"));
  compose({ previousDir: previous, previousSha: B, out: join(work, "C/release-static") });
  report.carry = verify({
    own: join(work, "C/.next/static"),
    carried: join(work, "C/release-static"),
  });

  const apiPort = await freePort();
  apiStub = createServer((req, res) => {
    res.writeHead(req.url?.endsWith("/health") ? 200 : 401, { "Content-Type": "application/json" });
    res.end(
      req.url?.endsWith("/health")
        ? JSON.stringify({
            rollingProtocol: 2,
            database: "connected",
            redis: "ok",
            realtime: "ready",
          })
        : "{}",
    );
  }).listen(apiPort, "127.0.0.1");
  const servers = { B: await instance("B", B, apiPort), C: await instance("C", C, apiPort) };

  // Routing proxy: the scenario decides which release answers each class.
  let routes = { doc: "B", static: "B", rsc: "B" };
  const seen = [];
  const proxyPort = await freePort();
  proxy = createServer((req, res) => {
    const kind = req.url.startsWith("/_next/static/")
      ? "static"
      : req.headers.rsc === "1"
        ? "rsc"
        : "doc";
    const target = servers[routes[kind]];
    const upstream = httpRequest(
      {
        host: "127.0.0.1",
        port: target.port,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (response) => {
        seen.push({
          kind,
          via: target.label,
          url: req.url,
          status: response.statusCode,
          asset: response.headers["x-tiao-release-asset"],
          deployment: req.headers["x-deployment-id"],
        });
        report.requests++;
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  }).listen(proxyPort, "127.0.0.1");
  const origin = `http://127.0.0.1:${proxyPort}`;

  // Use an installed Chromium rather than downloading the exact pinned build.
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  async function tab() {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    lastPage = page;
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    const errors = [];
    const documents = [];
    // Serwist's auto-registration throws when service workers are blocked,
    // as they are here; that message is unrelated to release handling.
    page.on("pageerror", (error) => {
      if (!/reading 'waiting'/.test(error.message)) errors.push(error.message);
    });
    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame())
        documents.push(request.url());
    });
    return { context, page, errors, documents };
  }

  // 1. A B document whose every static request reaches C: C serves B's
  // chunks, including the changed AuthDialog module, from its carried assets.
  {
    routes = { doc: "B", static: "C", rsc: "B" };
    const { context, page, errors } = await tab();
    const before = seen.length;
    await page.goto(`${origin}/local?autostart=1&boardSize=9&scoreToWin=10`);
    await page.getByTestId("cell-4-4").waitFor();
    await page.getByRole("button", { name: /open navigation/i }).click();
    await page
      .getByRole("button", { name: /^log in$/i })
      .first()
      .click();
    await page.getByText(OLD_TEXT).waitFor({ timeout: 15_000 });
    const statics = seen.slice(before).filter((row) => row.kind === "static");
    const failed = statics.filter((row) => row.via !== "C" || row.status !== 200);
    assert.deepEqual(failed, []);
    const dialogChunk = readdirSync(join(work, "B/.next/static/chunks")).find((name) =>
      readFileSync(join(work, "B/.next/static/chunks", name), "utf8").includes(OLD_TEXT),
    );
    assert.ok(dialogChunk, "dialog chunk not found in build B");
    assert.ok(
      statics.some((row) => row.url.includes(dialogChunk) && row.asset === B),
      `changed module ${dialogChunk} was not served from B's carried assets`,
    );
    report.carriedStaticRequests = statics.filter((row) => row.asset === B).length;
    report.staticRequestsScenario1 = statics.length;
    assert.deepEqual(errors, []);
    report.checks.push(
      "B document runs entirely on chunks C serves from its carried assets, changed lazy module included",
    );
    await context.close();
  }

  // 2. Router request from an old tab is refused; one full navigation follows.
  {
    // Every flight request reaches C from page load, so prefetches are refused too.
    routes = { doc: "B", static: "B", rsc: "C" };
    const { context, page, errors, documents } = await tab();
    const before = seen.length;
    await page.goto(`${origin}/local?autostart=1&boardSize=9&scoreToWin=10`);
    await page.waitForLoadState("load");
    await sleep(1500);
    routes = { doc: "C", static: "C", rsc: "C" };
    documents.length = 0;
    // Follow the first visible in-app link of the navigation drawer.
    await page.getByRole("button", { name: /open navigation/i }).click();
    const links = page.locator('a[href^="/"]:visible');
    await links.first().waitFor();
    let destination = "";
    for (const href of await links.evaluateAll((all) => all.map((a) => a.getAttribute("href")))) {
      if (href && href !== "/" && !href.startsWith("/local")) {
        destination = href;
        break;
      }
    }
    assert.ok(destination, "no in-app link in the navigation drawer");
    await page.locator(`a[href="${destination}"]:visible`).first().click();
    await page.waitForURL((url) => url.pathname === destination);
    await page.waitForLoadState("load");
    await sleep(1500);
    await sleep(2000);
    const refused = seen.slice(before).filter((row) => row.kind === "rsc" && row.status === 409);
    assert.ok(refused.length > 0, "no router request was refused");
    assert.ok(refused.every((row) => row.deployment === B));
    assert.equal(
      documents.filter((url) => new URL(url).pathname === destination).length,
      1,
      JSON.stringify(documents),
    );
    const after = seen.slice(before).filter((row) => row.kind === "rsc" && row.status === 200);
    assert.ok(
      after.every((row) => row.deployment === C),
      "page did not continue on release C",
    );
    assert.deepEqual(errors, []);
    report.checks.push("foreign router request gets 409 and exactly one full navigation onto C");
    await context.close();
  }

  // 3. A C document reaches B for its chunks (overlap): one reload recovers.
  {
    routes = { doc: "C", static: "B", rsc: "C" };
    const { context, page, documents } = await tab();
    const flip = setInterval(() => {
      if (documents.length >= 1 && seen.some((row) => row.via === "B" && row.status === 404))
        routes = { doc: "C", static: "C", rsc: "C" };
    }, 20);
    const start = seen.length;
    const consoleLines = [];
    page.on("console", (message) => consoleLines.push(message.text()));
    await page.goto(`${origin}/local?autostart=1&boardSize=9&scoreToWin=10`);
    await page.getByTestId("cell-4-4").waitFor({ timeout: 20_000 });
    clearInterval(flip);
    report.scenario3 = {
      requests: seen.slice(start).map((row) => `${row.kind} ${row.via} ${row.status} ${row.url}`),
      console: consoleLines.slice(0, 20),
    };
    await sleep(1500);
    assert.equal(documents.length, 2, JSON.stringify(documents));
    report.checks.push(
      "missing initial chunks on an older server cause one guarded reload, then C runs",
    );
    await context.close();
  }

  // 4. A hot-seat game survives a reload of the same URL.
  {
    routes = { doc: "C", static: "C", rsc: "C" };
    const { context, page, errors } = await tab();
    await page.goto(`${origin}/local?autostart=1&boardSize=9&scoreToWin=10`);
    for (const cell of ["cell-4-4", "cell-2-2", "cell-6-6"]) await page.getByTestId(cell).click();
    const stones = () =>
      page.evaluate(() => JSON.parse(sessionStorage.getItem("tiao:tab-game:v1:local") ?? "null"));
    await eventually(async () => (await stones())?.data.game.history.length === 3, "game saved");
    await page.reload();
    await page.getByTestId("cell-4-4").waitFor();
    await sleep(1000);
    assert.equal((await stones())?.data.game.history.length, 3);
    assert.equal(await page.getByRole("dialog").count(), 0, "setup dialog reopened after reload");
    assert.deepEqual(errors, []);
    report.checks.push("hot-seat game is restored after a reload");
    await context.close();
  }

  // 5. Retirement: C stays live through the drain, then exits cleanly.
  {
    const drainAt = Date.now();
    servers.C.child.kill("SIGTERM");
    await eventually(
      async () => (await fetch(`http://127.0.0.1:${servers.C.port}/health`)).status === 503,
      "C draining",
    );
    const page = await fetch(`http://127.0.0.1:${servers.C.port}/local`);
    assert.equal(page.status, 200);
    const [code] = await once(servers.C.child, "exit");
    report.drainMs = Date.now() - drainAt;
    assert.equal(code, 0);
    assert.ok(report.drainMs >= 20_000 && report.drainMs < 29_000, `drain ${report.drainMs}ms`);
    report.checks.push("drain keeps serving, health reports 503, process exits 0 before 29 s");
  }

  writeFileSync(join(work, "result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, evidenceDirectory: work }));
} catch (error) {
  try {
    await lastPage?.screenshot({ path: join(work, "failure.png"), fullPage: true });
    writeFileSync(join(work, "failure.html"), (await lastPage?.content()) ?? "");
  } catch {}
  writeFileSync(
    join(work, "failure.json"),
    JSON.stringify({ ...report, error: String(error) }, null, 2),
  );
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  proxy?.close();
  apiStub?.close();
  for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
  for (const label of process.env.PROOF_WORK ? [] : ["B", "C"])
    if (existsSync(join(work, label, ".next")))
      await rm(join(work, label, ".next"), { recursive: true, force: true });
}
