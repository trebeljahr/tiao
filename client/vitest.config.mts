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
    // Explicit pool — matches vitest 3.x default but makes `poolOptions.forks`
    // below unambiguously apply regardless of any future default change.
    pool: "forks",
    poolOptions: {
      forks: {
        // Cap each worker process at 1.5 GB heap (default Node ceiling
        // is ~4 GB). Vitest spawns one fork per test file under
        // `isolate: true`, and `maxWorkers: 4` keeps 4 concurrent.
        // Without a cap a heavy file (render-heavy component test,
        // leaky provider, fake-timer drift, etc.) lets Node grow the
        // worker heap toward 4 GB before aggressive GC — 4 × 4 = 16 GB
        // paged to swap freezes a 16 GB MacBook, especially combined
        // with the server + desktop suites that `npm test:unit` runs
        // concurrently via `concurrently ...`. 4 × 1.5 GB = 6 GB peak
        // leaves generous headroom for the OS + dev server(s) + the
        // concurrent server/desktop test runners.
        //
        // Empirically (with LOG_HEAP=1) no client test file peaks above
        // ~240 MB even on MultiplayerGamePage.test.tsx (1637 lines, 24
        // render() calls), so 1.5 GB is 6× the current ceiling — plenty
        // of buffer before a cap-forced crash would happen. If a file
        // ever does hit this, it's almost certainly a retention bug in
        // that file's setup/teardown — fix the bug, don't lift the cap.
        execArgv: ["--max-old-space-size=1536"],
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
