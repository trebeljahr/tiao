#!/usr/bin/env node
// Measure client cold-compile time for a given Next.js route.
//
// Spawns the client Next.js dev server DIRECTLY (skipping the
// scripts/dev.mjs + concurrently + nodemon + npm wrapping chain)
// in its own process group so we can reliably tear it down between
// runs. Then GETs the target route and times wall-clock TTFB.
//
// Usage:
//   node scripts/measure-cold-compile.mjs                    # default: /matchmaking
//   node scripts/measure-cold-compile.mjs /lobby              # custom route
//   node scripts/measure-cold-compile.mjs /matchmaking 3      # 3 repeat runs
//   NEXT_DEV_BUNDLER=webpack node scripts/measure-cold-compile.mjs /matchmaking
//                                                             # force webpack
//   MEASURE_QUIET=1 node scripts/measure-cold-compile.mjs     # silence child stderr
//
// Notes:
//   - Use DEFAULT-LOCALE-STRIPPED URLs (`/matchmaking` not
//     `/en/matchmaking`). next-intl 307-redirects `/<default_locale>/x`
//     to `/x`; measuring the redirect is not measuring the compile.
//     The script follows redirects, so it would catch the compile
//     eventually, but starting with the canonical URL is cleaner.
//
//   - The server side is NOT started. Only the client Next.js dev
//     server is spawned. API calls will fail during SSR (the route
//     may render with a network error in the component), but the
//     compile time is what we care about — compile is independent
//     of whether the server responds.
//
//   - Runs are fully isolated: fresh process group, fresh `.next`
//     dir, random client + API ports (no collisions with any
//     currently-running dev server), wait for the port to be FREE
//     between runs (TIME_WAIT can hold a port for 30-60 s otherwise).
//
//   - First request pays the cold-compile cost. We never make a
//     second request — the only relevant number is TTFB of GET /.
//     With N repeats we start a FRESH dev server each run.
//
// Output:
//   === cold-compile measurement ===
//   route:   /matchmaking
//   runs:    3
//   bundler: turbopack (default)
//   [1] boot 5932 ms + compile 17402 ms = 23334 ms
//   [2] boot 5814 ms + compile 18015 ms = 23829 ms
//   [3] boot 5907 ms + compile 17239 ms = 23146 ms
//   median compile: 17402 ms  (min 17239, max 18015, stddev 338)
//   median boot:    5907 ms

import { spawn } from "child_process";
import { connect, createServer as createNetServer } from "net";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { access, rm } from "fs/promises";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const repoRoot = resolve(__dirname, "..");
const clientDir = resolve(repoRoot, "client");

const route = process.argv[2] ?? "/matchmaking";
const runs = Number.parseInt(process.argv[3] ?? "1", 10);
const bundler = process.env.NEXT_DEV_BUNDLER ?? "turbopack";
const quiet = process.env.MEASURE_QUIET === "1";

if (!Number.isFinite(runs) || runs < 1 || runs > 10) {
  console.error("runs must be 1..10");
  process.exit(1);
}

// ─── utilities ────────────────────────────────────────────────────────

/** Pick a free TCP port in the given range. Returns the port number. */
function pickFreePort(min, max) {
  return new Promise((res, rej) => {
    const port = min + Math.floor(Math.random() * (max - min + 1));
    const server = createNetServer();
    server.once("error", () => res(pickFreePort(min, max))); // collision, retry
    server.listen(port, "127.0.0.1", () => {
      server.close(() => res(port));
    });
  });
}

/** Poll until a TCP port is free (nobody listening). */
async function waitForPortFree(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const free = await new Promise((res) => {
      const sock = connect(port, "127.0.0.1");
      sock.once("connect", () => {
        sock.destroy();
        res(false);
      });
      sock.once("error", () => res(true));
    });
    if (free) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/** Delete every .next / .next-* dir in client/ so the next compile is cold. */
async function clearCaches() {
  const candidates = [".next"];
  for (let p = 3100; p <= 3999; p++) candidates.push(`.next-${p}`);
  for (let p = 5100; p <= 5999; p++) candidates.push(`.next-${p}`);
  let cleared = 0;
  for (const c of candidates) {
    const dir = resolve(clientDir, c);
    try {
      await access(dir);
      await rm(dir, { recursive: true, force: true });
      cleared++;
    } catch {
      /* missing → skip */
    }
  }
  if (cleared > 0) console.log(`  cleared ${cleared} cache dir(s)`);
}

// ─── dev server lifecycle ────────────────────────────────────────────

/**
 * Spawn `node server.mjs` in a new process group so we can kill the
 * whole tree reliably. Returns { child, clientUrl, bootMs, stdout }.
 */
function spawnDevServer(clientPort, apiPort) {
  const bootStart = Date.now();
  const env = {
    ...process.env,
    PORT: String(clientPort),
    API_PORT: String(apiPort),
    NEXT_PUBLIC_API_PORT: String(apiPort),
    NODE_ENV: "development",
    NEXT_DEV_BUNDLER: bundler,
  };
  const child = spawn("node", ["server.mjs"], {
    cwd: clientDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // new process group — kill children with process.kill(-pgid, sig)
  });

  return new Promise((resolvePromise, reject) => {
    let stdout = "";
    let stderr = "";
    let resolved = false;
    const onData = (src) => (chunk) => {
      const text = chunk.toString();
      if (src === "stdout") stdout += text;
      else stderr += text;
      if (!quiet && src === "stderr") process.stderr.write(`    [child stderr] ${text}`);
      // Next 16 prints "Next.js ready on http://..."; older: "Ready in Xms"
      if (!resolved && /Next\.js ready on|Ready in|✓ Ready/.test(text)) {
        resolved = true;
        const bootMs = Date.now() - bootStart;
        resolvePromise({
          child,
          clientUrl: `http://127.0.0.1:${clientPort}`,
          bootMs,
          getStdout: () => stdout,
          getStderr: () => stderr,
        });
      }
    };
    child.stdout.on("data", onData("stdout"));
    child.stderr.on("data", onData("stderr"));
    child.once("exit", (code, signal) => {
      if (!resolved) {
        reject(
          new Error(
            `dev server exited before ready (code=${code}, signal=${signal})\n` +
              `stdout tail:\n${stdout.slice(-800)}\n` +
              `stderr tail:\n${stderr.slice(-800)}`,
          ),
        );
      }
    });
    // Safety timeout: longest legitimate boot I've seen is ~45 s, 180 s is
    // generous.
    setTimeout(() => {
      if (!resolved) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* already dead */
        }
        reject(
          new Error(
            `dev server did not become ready within 180 s\n` +
              `stdout tail:\n${stdout.slice(-1500)}\n` +
              `stderr tail:\n${stderr.slice(-1500)}`,
          ),
        );
      }
    }, 180_000).unref();
  });
}

/**
 * Kill the entire process group the child owns. Waits for the child
 * to exit (up to 10 s), then ALSO waits for the bound port to be
 * free so the next run can claim it without racing TIME_WAIT.
 */
async function teardown(child, clientPort) {
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* already dead */
    }
    await new Promise((res) => {
      const hardKill = setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* already dead */
        }
      }, 5000);
      child.once("exit", () => {
        clearTimeout(hardKill);
        res();
      });
      setTimeout(res, 10_000).unref(); // final escape
    });
  }
  // Wait for the port to actually be free. TCP TIME_WAIT can linger
  // otherwise.
  await waitForPortFree(clientPort, 15_000);
}

// ─── HTTP timing ──────────────────────────────────────────────────────

/**
 * GET the target route and return wall-clock time to fetch the final
 * (post-redirect) response body. Follows redirects manually (up to 5
 * hops) so next-intl's `/en/x → /x` rewrite doesn't short-circuit
 * the measurement.
 */
async function timeRequest(baseUrl) {
  const url = baseUrl + route;
  const start = Date.now();
  let currentUrl = url;
  let response;
  let hops = 0;
  while (true) {
    response = await fetch(currentUrl, { redirect: "manual" });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      await response.text();
      hops++;
      if (hops > 5) break;
      const loc = response.headers.get("location");
      currentUrl = new URL(loc, currentUrl).toString();
      continue;
    }
    break;
  }
  await response.text();
  const elapsed = Date.now() - start;
  return { elapsed, status: response.status, finalUrl: currentUrl, hops };
}

// ─── main ────────────────────────────────────────────────────────────

function stddev(xs) {
  if (xs.length <= 1) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sq = xs.map((x) => (x - mean) ** 2).reduce((a, b) => a + b, 0) / xs.length;
  return Math.round(Math.sqrt(sq));
}

async function main() {
  console.log(`=== cold-compile measurement ===`);
  console.log(`route:   ${route}`);
  console.log(`runs:    ${runs}`);
  console.log(`bundler: ${bundler}`);

  const compileTimes = [];
  const bootTimes = [];

  for (let i = 1; i <= runs; i++) {
    await clearCaches();
    const clientPort = await pickFreePort(3100, 3999);
    const apiPort = await pickFreePort(5100, 5999);
    let spawned;
    try {
      spawned = await spawnDevServer(clientPort, apiPort);
    } catch (err) {
      console.error(`[${i}] ${err.message}`);
      continue;
    }
    const { child, clientUrl, bootMs } = spawned;
    let result;
    try {
      result = await timeRequest(clientUrl);
    } catch (err) {
      console.error(`[${i}] fetch failed: ${err.message}`);
      result = null;
    }
    await teardown(child, clientPort);

    if (!result || result.status >= 400) {
      const status = result?.status ?? "no-response";
      console.error(`[${i}] request failed: ${status}`);
      continue;
    }
    const compileMs = result.elapsed;
    const hopNote =
      result.hops > 0
        ? ` [${result.hops} hop${result.hops === 1 ? "" : "s"} → ${result.finalUrl}]`
        : "";
    console.log(
      `[${i}] boot ${bootMs} ms + compile ${compileMs} ms = ${bootMs + compileMs} ms${hopNote}`,
    );
    compileTimes.push(compileMs);
    bootTimes.push(bootMs);

    // Brief cooldown between runs so the OS finishes releasing FDs,
    // threads, etc. Especially important when tests cascade.
    if (i < runs) await new Promise((r) => setTimeout(r, 500));
  }

  if (compileTimes.length === 0) {
    console.error("all runs failed");
    process.exit(1);
  }

  const compileSorted = [...compileTimes].sort((a, b) => a - b);
  const bootSorted = [...bootTimes].sort((a, b) => a - b);
  const medCompile = compileSorted[Math.floor(compileSorted.length / 2)];
  const medBoot = bootSorted[Math.floor(bootSorted.length / 2)];
  console.log(
    `median compile: ${medCompile} ms  (min ${compileSorted[0]}, max ${compileSorted[compileSorted.length - 1]}, stddev ${stddev(compileTimes)})`,
  );
  console.log(`median boot:    ${medBoot} ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
