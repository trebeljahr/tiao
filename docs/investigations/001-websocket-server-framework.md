# Investigation: WebSocket Server Framework

**Status:** Pending
**Date:** 2026-03-28

## Context

The server uses Express 4 + raw `ws` WebSocket library. As the game grows, WebSocket throughput and concurrent connection capacity become increasingly important. Investigated whether replacing Express with a faster alternative could meaningfully improve performance on a single VPS box.

## Options Considered

### Express + ws (current)

- ~15K HTTP req/s, ~435K WS msg/s
- Massive middleware ecosystem (helmet, cors, morgan, rate-limit, multer all in use)
- Very mature, well-understood, huge community (~65K stars)
- Single-instance practical limit of ~5-10K concurrent WebSocket connections

### uWebSockets.js (via ultimate-express)

- C++ WebSocket/HTTP server with Node.js bindings
- ~57K HTTP req/s (via ultimate-express drop-in), ~2.5M WS msg/s (~10x over ws)
- ultimate-express is a drop-in Express 4 replacement — existing routes and middleware work unchanged
- WebSocket API differs from `ws` — needs rewrite of connection handling
- Single maintainer (Alex Hultman), not on npm (GitHub releases only), platform-specific binaries
- ~30-50K concurrent WS connections on same hardware

### uWebSockets.js (raw)

- ~94K HTTP req/s, ~2.5M WS msg/s
- Own routing API, no Express compatibility — full HTTP rewrite required
- Maximum possible performance but highest migration effort

### Hono + Bun native

- Hono: modern TypeScript-first framework on Web Standards (Fetch API), ~80-130K HTTP req/s on Bun
- Bun: JavaScript runtime replacing Node.js, native WS via uWS internally (~2.5M msg/s)
- Express middleware is **incompatible** with Hono — helmet, cors, morgan, rate-limit, multer all need replacements
- `bcrypt` (native C++ addon) may break on Bun — would need `bcryptjs` or `@node-rs/bcrypt`
- ~10-20% more real-world capacity than ultimate-express, but 5-10x more migration effort

### Soketi

- Self-hosted Pusher-protocol WebSocket service, built on uWS
- **Not a good fit** — designed for channel-based pub/sub, not custom game state messaging
- Would require separate process + Pusher SDK adoption + complete WS rewrite
- Maintenance concerns (infrequent updates, growing issue backlog)

## Analysis

The key insight is that **WebSocket throughput gains come from uWebSockets.js, which both the ultimate-express and Bun paths use**. The framework layer (Express vs Hono) only affects HTTP routing overhead, which is <1% of real response time when MongoDB queries take 5-50ms.

On a typical VPS (2-4 cores, 4-8GB RAM):

| Metric                    | Express + ws       | ultimate-express + uWS | Hono + Bun         |
| ------------------------- | ------------------ | ---------------------- | ------------------ |
| Concurrent WS connections | ~5-10K             | ~30-50K                | ~30-50K            |
| Real HTTP latency         | ~5-50ms (DB-bound) | ~5-50ms (DB-bound)     | ~5-50ms (DB-bound) |
| WS message throughput     | 1x                 | ~10x                   | ~10x (same uWS)    |
| Migration effort          | —                  | Low (1-2 days)         | High (1-2 weeks)   |

The real VPS bottlenecks are MongoDB queries, Redis lookups, and game logic CPU — not framework overhead.

## Recommendation

**ultimate-express + uWebSockets.js native WS** is the pragmatic choice:

1. Swap `require("express")` to `require("ultimate-express")` — routes, middleware, everything keeps working
2. Rewrite WS handling from `ws` to uWS native API (manageable since we already use raw `ws`, no socket.io abstractions to replicate)
3. Result: ~5-8x more concurrent connections, ~10x WS throughput, minimal business logic changes

The full Hono+Bun rewrite would yield only ~10-20% additional real-world capacity for 5-10x more effort and added risk with native addons (bcrypt, jimp, @aws-sdk).

Higher-leverage capacity improvements (independent of framework choice):

- MongoDB query optimization / connection pooling
- Moving hot game state to Redis
- Horizontal scaling with Redis Pub/Sub (already planned in ADR #6)
