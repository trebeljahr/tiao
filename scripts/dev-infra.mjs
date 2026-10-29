import { execFileSync } from "node:child_process";
import { Socket } from "node:net";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const services = [
  { name: "redis", label: "Redis:6379", port: 6379 },
  { name: "mongo", label: "Mongo:27017", port: 27017 },
];

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = new Socket();
    const finish = (ready) => {
      socket.destroy();
      resolve(ready);
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
    socket.connect(port, "127.0.0.1");
  });
}

function runCompose(missing) {
  execFileSync("docker", ["compose", "-f", "docker-compose.dev.yml", "up", "-d", ...missing], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
}

export async function startDevInfra({
  skip = false,
  probe = isPortOpen,
  compose = runCompose,
  timeoutMs = 30_000,
  pollMs = 500,
  log = console.log,
} = {}) {
  if (skip) {
    log("  Infra:  skipped (--skip-infra)");
    return;
  }

  async function unavailable() {
    const ready = await Promise.all(services.map(({ port }) => probe(port)));
    return services.filter((_, index) => !ready[index]);
  }

  let missing = await unavailable();
  if (missing.length === 0) {
    log("  Infra:  up (Redis + Mongo reachable)");
    return;
  }

  log(
    `  Infra:  starting docker compose (${missing.map(({ label }) => label).join(", ")} unreachable)...`,
  );
  try {
    // Do not bind Mongo's port when a native Mongo instance already owns it.
    compose(missing.map(({ name }) => name));
  } catch (err) {
    const detail = err.stderr?.toString().trim() || err.message;
    throw new Error(
      `Docker Compose failed:\n${detail}\nStart Docker (or run \`colima start\`), then retry \`pnpm dev\`. Use --skip-infra only when you manage the required services yourself.`,
      { cause: err },
    );
  }

  const deadline = Date.now() + timeoutMs;
  do {
    missing = await unavailable();
    if (missing.length === 0) {
      log("  Infra:  up (Redis + Mongo ready)");
      return;
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  } while (Date.now() < deadline);

  throw new Error(
    `${missing.map(({ label }) => label).join(", ")} still unreachable after ${timeoutMs / 1000}s. Check \`docker compose -f docker-compose.dev.yml ps\` and service logs before retrying.`,
  );
}
