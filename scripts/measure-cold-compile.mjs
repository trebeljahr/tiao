#!/usr/bin/env node
// Measure client cold-compile time for a given Next.js route.
//
// What it does:
//   1. Clears the client's .next / .next-* dirs so every run starts cold
//   2. Spawns `npm run dev` in the background, tears up the full dev stack
//   3. Waits for the dev server to respond on its client port
//   4. Issues a GET to the target route and times wall-clock TTFB
//   5. Kills the dev server
//   6. Prints the measurement
//
// Usage:
//   node scripts/measure-cold-compile.mjs                    # default: /en/matchmaking
//   node scripts/measure-cold-compile.mjs /en/lobby           # custom route
//   node scripts/measure-cold-compile.mjs /en/matchmaking 3   # 3 repeat runs
//   MEASURE_PARALLEL=1 node scripts/measure-cold-compile.mjs  # measure dev:parallel cold compile
//
// Notes:
//   - The first request pays the cold-compile cost. Subsequent requests to
//     the SAME route are nearly instant because Next keeps the compiled
//     chunks in memory. To measure cold compile accurately we MUST use a
//     fresh dev server each run.
//   - With N repeats we print the individual times + median + min/max so
//     you can see noise floor vs signal.
//   - The npm install step is NOT wiped. We're measuring Next's own cold
//     compile, not dependency install.
//
// Expected output shape:
//   === cold-compile measurement ===
//   route:    /en/matchmaking
//   mode:     dev
//   runs:     1
//   [1] 48312 ms  (boot 1243 ms + compile 47069 ms)
//   median:   48312 ms
//   min..max: 48312..48312 ms

import { spawn } from "child_process";
import { rm, access } from "fs/promises";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const repoRoot = resolve(__dirname, "..");
const clientDir = resolve(repoRoot, "client");

const route = process.argv[2] ?? "/en/matchmaking";
const runs = Number.parseInt(process.argv[3] ?? "1", 10);
const parallelMode = process.env.MEASURE_PARALLEL === "1";

if (!Number.isFinite(runs) || runs < 1 || runs > 10) {
  console.error("runs must be 1..10");
  process.exit(1);
}

/** Delete every .next / .next-* dir under client/ so the next compile is cold. */
async function clearCaches() {
  const candidates = [".next"];
  // In parallel mode, per-port dirs will be created. Zap anything matching.
  for (let p = 3100; p <= 3999; p++) candidates.push(`.next-${p}`);
  for (let p = 5100; p <= 5999; p++) candidates.push(`.next-${p}`);
  const dirs = [];
  for (const c of candidates) {
    const dir = resolve(clientDir, c);
    try {
      await access(dir);
      dirs.push(dir);
    } catch {
      /* missing → skip */
    }
  }
  for (const dir of dirs) {
    await rm(dir, { recursive: true, force: true });
  }
  if (dirs.length > 0) {
    console.log(`  cleared ${dirs.length} cache dir(s)`);
  }
}

/** Spawn `npm run dev` (or `npm run dev:parallel`) and resolve the dev URL + child. */
function spawnDevServer() {
  const bootStart = Date.now();
  const npmArgs = parallelMode ? ["run", "dev:parallel"] : ["run", "dev"];
  const child = spawn("npm", npmArgs, {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  return new Promise((resolvePromise, reject) => {
    let stderr = "";
    let stdout = "";

    // Grab the first client URL we see in the dev.mjs banner. Matches both
    // `Client: http://localhost:3100` (solo mode) and
    // `[1] client → http://localhost:3100` (parallel mode).
    const clientUrlRegex = /(?:Client:|client →)\s+(http:\/\/localhost:\d+)/;
    let clientUrl = null;
    let resolved = false;

    const onData = (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (!clientUrl) {
        const m = text.match(clientUrlRegex);
        if (m) clientUrl = m[1];
      }
      // Next 16 prints "Next.js ready on http://..." once dev server is live.
      // Older versions print "Ready in Xms" or "✓ Ready in ...". Match any.
      // In dev:parallel we want BOTH instances ready before measuring so
      // the second cold-compile of /matchmaking on instance 2 doesn't race
      // instance 1's boot.
      if (clientUrl && /Next\.js ready on|Ready in|✓ Ready/.test(text) && !resolved) {
        resolved = true;
        const bootMs = Date.now() - bootStart;
        resolvePromise({ child, clientUrl, bootMs });
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      onData(chunk); // some Next versions emit "Ready in" on stderr
    });

    child.once("exit", (code) => {
      if (!resolved) {
        reject(
          new Error(
            `dev server exited (code=${code}) before reporting a client URL\n` +
              `stdout tail: ${stdout.slice(-500)}\n` +
              `stderr tail: ${stderr.slice(-500)}`,
          ),
        );
      }
    });

    // Safety timeout. The tsx cold-compile of the server alone is
    // ~30-40s, and dev:parallel + font stagger pushes the total even
    // higher. 4 minutes is a generous budget that'll catch a real
    // hang while still tolerating a genuine cold boot.
    setTimeout(() => {
      if (!resolved) {
        try {
          child.kill("SIGTERM");
        } catch {
          /* already dead */
        }
        reject(
          new Error(
            "dev server did not become ready within 240 s\n" +
              `stdout tail: ${stdout.slice(-1500)}`,
          ),
        );
      }
    }, 240_000).unref();
  });
}

/**
 * GET the target route and return wall-clock time to fetch the final
 * (post-redirect) response body. We have to FOLLOW redirects because
 * next-intl strips the default locale (`/en/foo` → 307 → `/foo`); if
 * we stop at the 307 we measure the redirect response (<200 ms) not
 * the actual compile of the target route.
 */
async function timeRequest(baseUrl) {
  const url = baseUrl + route;
  const start = Date.now();
  let currentUrl = url;
  let response;
  let hops = 0;
  // Manually chase redirects (up to 5 hops) so we can log each one.
  // fetch's default `redirect: "follow"` would also work but doesn't
  // give us visibility into the chain.
  while (true) {
    response = await fetch(currentUrl, { redirect: "manual" });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      await response.text(); // drain
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

/** Cleanly kill a spawned dev server tree. scripts/dev.mjs propagates SIGTERM. */
function killTree(child) {
  return new Promise((res) => {
    let killed = false;
    const done = () => {
      if (killed) return;
      killed = true;
      res();
    };
    child.once("exit", done);
    try {
      child.kill("SIGTERM");
    } catch {
      done();
    }
    // Hard kill after 5 s if SIGTERM was ignored
    setTimeout(() => {
      if (!killed) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already dead */
        }
        done();
      }
    }, 5_000).unref();
  });
}

async function main() {
  console.log(`=== cold-compile measurement ===`);
  console.log(`route:    ${route}`);
  console.log(`mode:     ${parallelMode ? "dev:parallel" : "dev"}`);
  console.log(`runs:     ${runs}`);

  const results = [];
  for (let i = 1; i <= runs; i++) {
    await clearCaches();
    const { child, clientUrl, bootMs } = await spawnDevServer();
    try {
      const { elapsed, status, finalUrl, hops } = await timeRequest(clientUrl);
      if (status >= 400) {
        console.error(`[${i}] request failed: HTTP ${status} (final ${finalUrl})`);
        results.push(null);
      } else {
        const compileMs = elapsed;
        const hopNote = hops > 0 ? ` [${hops} redirect${hops === 1 ? "" : "s"} → ${finalUrl}]` : "";
        console.log(
          `[${i}] ${compileMs} ms  (boot ${bootMs} ms + compile ${compileMs} ms)${hopNote}`,
        );
        results.push(compileMs);
      }
    } finally {
      await killTree(child);
    }
  }

  const ok = results.filter((r) => r !== null);
  if (ok.length === 0) {
    console.error("all runs failed");
    process.exit(1);
  }
  const sorted = [...ok].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  console.log(`median:   ${median} ms`);
  console.log(`min..max: ${sorted[0]}..${sorted[sorted.length - 1]} ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
