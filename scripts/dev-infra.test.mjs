import assert from "node:assert/strict";
import test from "node:test";
import { startDevInfra } from "./dev-infra.mjs";

const log = () => {};

test("running native services need no Docker", async () => {
  await startDevInfra({
    log,
    probe: async () => true,
    compose: () => assert.fail("Docker must not be called"),
  });
});

test("skip-infra leaves managed services alone", async () => {
  await startDevInfra({
    skip: true,
    log,
    probe: () => assert.fail("Ports must not be probed"),
    compose: () => assert.fail("Docker must not be called"),
  });
});

for (const [port, service] of [
  [6379, "redis"],
  [27017, "mongo"],
]) {
  test(`starts only ${service} when the other service runs natively`, async () => {
    let started = false;
    await startDevInfra({
      log,
      probe: async (candidate) => candidate !== port || started,
      compose: (missing) => {
        assert.deepEqual(missing, [service]);
        started = true;
      },
    });
    assert.equal(started, true);
  });
}

test("Docker failure stops startup and exposes the underlying error", async () => {
  await assert.rejects(
    startDevInfra({
      log,
      probe: async () => false,
      compose: () => {
        throw Object.assign(new Error("Command failed"), {
          stderr: Buffer.from('context "colima": context not found'),
        });
      },
    }),
    /Docker Compose failed:[\s\S]*context "colima": context not found[\s\S]*colima start/,
  );
});

test("waits for both services after container creation", async () => {
  let probes = 0;
  await startDevInfra({
    log,
    pollMs: 1,
    probe: async () => ++probes > 4,
    compose: (missing) => assert.deepEqual(missing, ["redis", "mongo"]),
  });
  assert.ok(probes >= 6);
});

test("unreachable services after Compose succeeds stop startup", async () => {
  await assert.rejects(
    startDevInfra({
      log,
      timeoutMs: 0,
      probe: async (port) => port === 27017,
      compose: () => {},
    }),
    /Redis:6379 still unreachable.*docker compose/,
  );
});
