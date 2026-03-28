# Investigation: Database Choice

**Status:** Pending (never formally investigated)
**Date:** Since project inception

## Context

MongoDB was adopted from the start — the server was extracted from another project that already used MongoDB + Mongoose. No formal comparison with alternatives was conducted. This investigation captures the implicit tradeoffs for future reference.

## Current Choice: MongoDB + Mongoose

**Why it works well for this project:**

- Document model naturally fits game state (single document per game, see ADR #5)
- Flexible schema for evolving game features (Mixed type for GameState)
- TTL indexes for automatic session cleanup
- Mongoose provides good TypeScript support and validation
- Simple operational model for self-hosting (single Coolify service)

**Where it creates friction:**

- No relational joins — social features (friends, invitations) require multiple queries or manual denormalization
- Tournament bracket queries across matches are awkward in document model
- No built-in full-text search (player search uses regex)

## Alternatives worth considering

### PostgreSQL (+ Prisma or Drizzle)

- Relational model better suited for social graph (friends, invitations, tournaments)
- Strong consistency guarantees, ACID transactions
- Full-text search built in
- Game state storage would need JSONB column (workable but less natural than MongoDB documents)
- Would require migrating all Mongoose schemas — significant effort

### Supabase (PostgreSQL + auth + realtime)

- Hosted PostgreSQL with built-in auth, realtime subscriptions, and storage
- Could replace MongoDB + custom auth + S3 in one service
- But: adds vendor dependency, hosted service costs, less control
- Realtime subscriptions could supplement (not replace) WebSocket game state

### SQLite (via Turso or libsql)

- Extremely lightweight, no separate server process
- Good for small-to-medium scale
- Limited concurrent write throughput (relevant for multiplayer)
- Interesting for a simpler deployment model

## Open Questions

- Is the social features friction worth a migration, or manageable with current patterns?
- If horizontal scaling becomes necessary, MongoDB sharding vs PostgreSQL replication?
- Could a hybrid approach work (MongoDB for game state, PostgreSQL for social/relational data)?
