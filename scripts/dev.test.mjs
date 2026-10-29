import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function launch(args = [], overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "tiao-dev-urls-"));
  try {
    // Parallel-mode shutdown checks Git for Next's generated tsconfig changes.
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "server"));
    mkdirSync(join(root, "node_modules/.bin"), { recursive: true });
    for (const file of ["dev.mjs", "dev-infra.mjs"]) {
      cpSync(new URL(file, import.meta.url), join(root, "scripts", file));
    }
    // Capture commands without starting watchers, Next, or infrastructure.
    writeFileSync(
      join(root, "node_modules/.bin/concurrently"),
      '#!/usr/bin/env node\nconsole.log("COMMANDS=" + JSON.stringify(process.argv.slice(2)));\n',
      { mode: 0o755 },
    );
    writeFileSync(
      join(root, "server/.env"),
      "BETTER_AUTH_URL=http://localhost:3000\nFRONTEND_URL=https://stale.example\n",
    );
    writeFileSync(
      join(root, "server/index.mjs"),
      `process.loadEnvFile();
console.log(JSON.stringify({
  apiPort: process.env.PORT,
  frontend: process.env.FRONTEND_URL,
  auth: process.env.BETTER_AUTH_URL,
}));
`,
    );
    const env = {
      ...process.env,
      PORT: "",
      API_PORT: "",
      DEV_PARALLEL: "",
      BETTER_AUTH_URL: "http://localhost:3000",
      FRONTEND_URL: "https://stale-parent.example",
      ...overrides,
    };
    const output = execFileSync(process.execPath, ["scripts/dev.mjs", "--skip-infra", ...args], {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 10_000,
    });
    const commands = JSON.parse(output.split("COMMANDS=")[1].trim()).slice(5);
    const instances = [];
    for (let i = 0; i < commands.length; i += 2) {
      const clientPort = commands[i].match(/\bPORT=(\d+)/)[1];
      const apiPort = commands[i].match(/\bAPI_PORT=(\d+)/)[1];
      const serverCommand = commands[i + 1]
        .slice(1, -1)
        .replace("node --watch --import tsx index.ts", "node index.mjs");
      const actual = JSON.parse(
        execFileSync("/bin/sh", ["-c", serverCommand], {
          cwd: root,
          env,
          encoding: "utf8",
          timeout: 10_000,
        }),
      );
      assert.deepEqual(actual, {
        apiPort,
        frontend: `http://localhost:${clientPort}`,
        auth: `http://localhost:${clientPort}`,
      });
      instances.push({ clientPort, apiPort });
    }
    return instances;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("random dev ports override stale auth URLs in the environment and .env", () => {
  assert.equal(launch().length, 1);
});

test("explicit client and API ports determine the public auth origin", () => {
  assert.deepEqual(launch([], { PORT: "54321", API_PORT: "54322" }), [
    { clientPort: "54321", apiPort: "54322" },
  ]);
});

test("fixed dev mode uses the client port for auth", () => {
  assert.deepEqual(launch(["--fixed"]), [{ clientPort: "3000", apiPort: "5005" }]);
});

test("parallel dev instances each use their paired client's auth origin", () => {
  const instances = launch(["3"], { DEV_PARALLEL: "1" });
  assert.equal(instances.length, 3);
  assert.equal(new Set(instances.map(({ clientPort }) => clientPort)).size, 3);
  assert.equal(new Set(instances.map(({ apiPort }) => apiPort)).size, 3);
});
