# Investigation: Testing Framework

**Status:** Decided
**Date:** 2025-2026

## Context

The project needs unit testing for the shared game engine and server logic, component testing for React views, and end-to-end testing for the full game flow.

## Options Considered

### Jest

- Industry standard, used initially
- Slow startup, heavy configuration
- ESM support is painful (the shared game engine and server use ESM)
- Removed in commit `8114d3d3`

### Vitest (chosen for unit/component)

- Vite-native test runner, fast startup, native ESM support
- Compatible with Jest's `expect` API (easy migration)
- Watch mode with instant re-runs
- When Vite was removed in favor of Next.js, a standalone `vitest.config.mts` was created to keep Vitest independent of the build tool

### Playwright (chosen for E2E)

- Cross-browser E2E testing
- Reliable selectors, auto-waiting, trace viewer for debugging
- E2E tests run against isolated Docker infrastructure (dedicated MongoDB on port 27018, Redis on port 6380, MinIO on port 9002 — all with tmpfs for speed)
- Parallel workers in CI for faster runs

## Outcome

- **Unit/Component:** Vitest
- **E2E:** Playwright with isolated Docker containers
- **CI:** Separate test workflow from deploy, parallel Playwright workers, smart retries

The E2E isolation setup (Investigation #013) ensures tests never pollute the development database.
