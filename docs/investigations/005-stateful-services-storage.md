# Investigation: Stateful Services Storage (In-Memory vs Redis)

**Status:** Decided — see [ADR #2 (Redis for Stateful Services)](../ARCHITECTURE_DECISIONS.md#2-redis-for-stateful-services)
**Date:** 2026-03-25

## Context

Matchmaking queue, distributed locks, rate limit counters, and WebSocket connections were all stored in Node.js process memory. A server restart would lose all queued players and active locks. Horizontal scaling was impossible since each instance had its own state.

## Options Considered

### Everything in-memory (original)

- Simplest implementation, no external dependencies
- Single point of failure — restart = lost state
- Cannot scale horizontally

### Redis for everything

- Move all state (matchmaking, locks, rate limits, connections) to Redis
- Enables full horizontal scaling
- But: WebSocket socket objects cannot be serialized to Redis
- Adds required infrastructure dependency for development

### Pluggable abstraction with optional Redis (chosen)

- `MatchmakingStore` and `LockProvider` interfaces with both in-memory and Redis implementations
- Redis when `REDIS_URL` is set, in-memory fallback otherwise
- WebSocket connections stay in-memory (socket objects can't be serialized)
- Rate limiting via `rate-limit-redis` when Redis available

### MongoDB for stateful services

- Already available, no new infrastructure
- Too slow for high-frequency operations (lock contention, matchmaking polling)
- No native pub/sub or atomic set operations
- Wrong tool for ephemeral, high-throughput state

## What moved where

| Service               | Storage                                 | Why                                       |
| --------------------- | --------------------------------------- | ----------------------------------------- |
| Matchmaking queue     | Redis Sorted Set (scored by queue time) | Survives restarts, works across instances |
| Match mapping         | Redis String with 5-min TTL             | Ephemeral, cross-instance visibility      |
| Distributed locks     | Redis SETNX + TTL + Lua release         | Must work across instances                |
| Rate limit counters   | `rate-limit-redis`                      | Consistent limits across load balancer    |
| WebSocket connections | In-memory                               | Socket objects can't be serialized        |
| Abandon/clock timers  | In-memory                               | setTimeout handles, job queue planned     |
| Lobby connections     | In-memory                               | Socket references                         |

## Outcome

Pluggable abstractions with optional Redis. Local dev requires no Redis. The future path for WebSocket horizontal scaling is Redis Pub/Sub channels per game room (documented in ADR #6).
