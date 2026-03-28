# Investigation: E2E Test Isolation

**Status:** Decided
**Date:** 2026-03

## Context

E2E tests were running against the development MongoDB instance, causing data pollution and flaky tests. Tests interfered with each other and with manual development.

## Options Considered

### Shared dev database with cleanup scripts

- Simplest approach — tests clean up after themselves
- Fragile: test failures leave orphaned data, parallel tests conflict
- Development data can break tests and vice versa

### In-memory MongoDB (mongodb-memory-server)

- Runs an ephemeral MongoDB instance in the test process
- Good for unit tests but doesn't test the real server startup path
- E2E tests need a real server process, not just a database

### Dedicated Docker containers (chosen)

- Separate MongoDB (port 27018), Redis (port 6380), MinIO (port 9002)
- tmpfs mounts for RAM-backed storage (fast, ephemeral)
- `docker-compose.e2e.yml` for local runs
- GitHub Actions services for CI (same containers)
- Playwright `globalSetup` starts containers, `globalTeardown` stops them

## Outcome

Fully isolated E2E infrastructure with ephemeral Docker containers. Each test run gets fresh, empty databases. No state leaks between test runs or between testing and development.

The CI pipeline runs tests in a separate workflow from deployment, with parallel Playwright workers for speed. Tests use `tmpfs` mounts so database operations are memory-speed.
