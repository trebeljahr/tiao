import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  define: {
    __APP_VERSION__: JSON.stringify("test"),
    "process.env.APP_VERSION": JSON.stringify("0.1.0-build.42+abc1234"),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "../shared/src"),
      // Fix ESM resolution: next-intl imports "next/navigation" without .js extension
      "next/navigation": path.resolve(__dirname, "node_modules/next/navigation.js"),
      "next/headers": path.resolve(__dirname, "node_modules/next/headers.js"),
      // Stub better-auth (WIP migration — package not yet installed)
      "better-auth/react": path.resolve(__dirname, "src/test/stubs/better-auth-react.ts"),
      "better-auth/client/plugins": path.resolve(
        __dirname,
        "src/test/stubs/better-auth-client-plugins.ts",
      ),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Cap the worker pool locally so vitest doesn't fan out to
    // `os.cpus().length - 1` (~10 on Rico's Mac) and starve the machine
    // when dev servers / other worktrees are also running. 10 parallel
    // jsdom workers compete for CPU hard enough that vitest's birpc
    // times out (`[vitest-worker]: Timeout calling "onTaskUpdate"`) and
    // kills an otherwise-green run.
    //
    // CI (ubuntu-latest has 4 cores, nothing else competing) keeps the
    // default so it can use every core.
    maxWorkers: process.env.CI ? undefined : 4,
    // 15s per test (up from the 5s vitest default). The AI engine tests
    // under src/lib/engine are CPU-heavy (individual tests run for 6-16
    // seconds of pure search) and share vitest's worker pool with the
    // lightweight component tests. When several engine workers land on
    // the same pool as a render-heavy test like MultiplayerGamePage,
    // the component test gets starved and waitFor loops blow through
    // 5s even though the actual render work is sub-second. 15s is
    // enough headroom that genuine slow tests still pass cleanly while
    // real regressions still fail fast — anything that legitimately
    // needs >15s is almost certainly stuck, not slow.
    testTimeout: 15_000,
    // Per-file heap usage, printed inline next to the file name. Gated
    // behind LOG_HEAP=1 because it's noisy; useful when hunting the
    // specific file(s) that balloon memory during `npm test`.
    logHeapUsage: process.env.LOG_HEAP === "1",
    // Use worker threads instead of forked child processes.
    //
    // Vitest 2 defaulted to `threads`; Vitest 3 silently flipped the
    // default to `forks` (commit 530f5195 in this repo bumped
    // vitest ^2.1.3 → ^3.2.4). Forks are stricter isolation (separate
    // Node process per worker), but each fork pays the full Node +
    // Vite + jsdom cold-start cost on spawn, which stacks hard when
    // four of them boot at once at the top of `npm test` — that's the
    // "lag as soon as I hit enter" regression that showed up after the
    // vitest upgrade.
    //
    // Measured on a cleanly-loaded machine (full 63-file suite):
    //   pool=forks,  maxWorkers=4 → ~107s wall, 148% CPU (starved)
    //   pool=threads, maxWorkers=4 → ~51s wall, 248% CPU (busy)
    // Threads share the parent process's V8 startup, the Vite dev
    // server, and the module resolver cache, so spawn cost is ~zero.
    // Isolation is still per-file via fresh worker contexts; only the
    // process boundary changes.
    //
    // Caveat: runtimes vary enormously by system load. Under heavy
    // concurrent load (other dev servers, worktrees, Electron apps)
    // both pool types degrade hard — measured 282s for the same suite
    // with a load average of 27. That's a symptom of the machine, not
    // the pool. `npm test` also fans out to server + desktop suites
    // concurrently via `concurrently ...`, so running just
    // `npm --prefix client test` while iterating is friendlier.
    pool: "threads",
    poolOptions: {
      threads: {
        // Cap each worker thread at 1.5 GB heap (Node's default is
        // ~4 GB). Worker threads don't accept V8 flags via `execArgv`
        // (`ERR_WORKER_INVALID_EXEC_ARGV`) — the per-isolate heap limit
        // is set via `resourceLimits.maxOldGenerationSizeMb` instead.
        // `maxWorkers: 4` × 1.5 GB = 6 GB peak for client vitest,
        // leaving headroom for the OS + dev server + the server/desktop
        // suites that `npm test:unit` runs concurrently via
        // `concurrently ...`.
        //
        // Empirically (LOG_HEAP=1 across the full 63-file suite) no
        // file peaks above ~240 MB — MultiplayerGamePage.test.tsx
        // (1637 lines, 24 render() calls) is the outlier. 1.5 GB is
        // ~6× that ceiling, so hitting it means a real retention bug
        // in the offending file, not a reason to lift the cap.
        resourceLimits: {
          maxOldGenerationSizeMb: 1536,
        },
      },
    },
    server: {
      deps: {
        // Process next-intl through vite's pipeline to avoid ESM bare-specifier issues
        inline: ["next-intl"],
      },
    },
  },
});
