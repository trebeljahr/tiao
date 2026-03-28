# Architecture Decisions

This document records the key architectural decisions made in Tiao, the reasoning behind them, and their consequences. Each decision follows the Context / Decision / Consequences format.

---

## 1. Standardized Error Response Format

**Context:** API routes returned errors in two inconsistent formats — some with `{message}` only, others with `{code, message}`. Client code had to parse message strings to determine error types, making programmatic error handling fragile and localization impossible.

**Decision:** All error responses use `{code, message}` format. Codes are uppercase, snake_case, machine-readable identifiers (e.g., `VALIDATION_ERROR`, `DUPLICATE_EMAIL`, `NOT_AUTHENTICATED`). Messages are human-readable sentences for display.

**Consequences:**

- Clients can branch on `code` instead of string-matching messages
- Error messages can be changed without breaking client logic
- Enables future localization (map codes to translated strings)
- Slightly larger response payloads (negligible)

---

## 2. Redis for Stateful Services

> Investigation: [005-stateful-services-storage.md](investigations/005-stateful-services-storage.md)

**Context:** Matchmaking queue, distributed locks, and rate limit counters were all stored in Node.js process memory. This made the server a single point of failure — a restart loses all queued players and active locks. Horizontal scaling is impossible since each instance has its own state.

**Decision:** Extract matchmaking and locking into pluggable abstractions (`MatchmakingStore`, `LockProvider`) with both in-memory and Redis implementations. Rate limiting uses `rate-limit-redis` when available. Redis is **optional** — when `REDIS_URL` is not set, the server falls back to in-memory stores for local development and testing.

**What moved to Redis:**

- Matchmaking queue (Redis Sorted Set, scored by queue time)
- Matchmaking match mapping (Redis String with 5-minute TTL)
- Distributed locks (SETNX + TTL + Lua release script)
- Rate limit counters (via `rate-limit-redis`)

**What stays in-memory:**

- WebSocket connections (socket objects cannot be serialized)
- Abandon timers and clock timers (setTimeout handles; job queue migration planned)
- Lobby connections (socket references)

**Consequences:**

- Enables horizontal scaling when Redis is available
- Matchmaking survives server restarts
- Locks work across instances
- Rate limits are consistent across load-balanced instances
- Local development requires no Redis (in-memory fallback)
- Added dependency: `ioredis`, `rate-limit-redis`

---

## 3. Per-Account Rate Limiting

**Context:** Rate limiting was purely IP-based. Users behind shared proxies (corporate networks, mobile carriers) were unfairly rate-limited together. An attacker on a proxy could exhaust limits for all users on that proxy.

**Decision:** Rate limit key generator uses `playerId` for authenticated requests and falls back to `req.ip` for unauthenticated ones. The player identity is resolved from the session cookie via the existing `getPlayerFromRequest()` function.

**Consequences:**

- Fair per-user limits regardless of IP sharing
- Authenticated users get their own limit buckets
- Unauthenticated endpoints (login, signup, guest creation) still use IP-based limiting
- Slightly higher per-request overhead (session cookie lookup on every rate-limited request)
- Rate limit state is distributed via Redis when available

---

## 4. Session Strategy: HMAC Cookie Digests

> Investigation: [002-auth-strategy.md](investigations/002-auth-strategy.md)

**Context:** The server needs to authenticate players across HTTP requests and WebSocket connections. Options considered: JWT tokens, opaque session tokens, HMAC-digested cookies.

**Decision:** Sessions use HttpOnly cookies containing a random 48-byte base64url token. The server stores only the HMAC-SHA256 digest (keyed with `TOKEN_SECRET`) in MongoDB's `GameSession` collection with a TTL index for automatic expiration.

**Why not JWT:**

- JWTs can't be revoked without a blacklist (which requires storage anyway)
- Game sessions need server-side state (player identity, session validity)
- JWT tokens are larger (header + payload + signature) than a simple cookie
- No need for cross-service token validation (single backend)

**Consequences:**

- Immediate session revocation (delete from DB)
- DB query on every authenticated request (fast with indexed `tokenDigest`)
- TOKEN_SECRET compromise requires credential rotation (not token re-issuance)
- 30-day TTL with MongoDB TTL index for automatic cleanup
- SameSite=Strict + HttpOnly + Secure flags prevent XSS and CSRF

---

## 5. Game State in Single MongoDB Document

> Investigation: [006-database-choice.md](investigations/006-database-choice.md)

**Context:** Each multiplayer game needs persistent state including the board, move history, scores, clock times, and metadata. Options considered: single document, event sourcing, separate collections for state vs. history.

**Decision:** Store the entire game state as a single MongoDB document (`GameRoom`). The `state` field is `Schema.Types.Mixed` containing the full `GameState` object (board positions, history, scores, pending jumps).

**Why not event sourcing:**

- Games are short (typically < 200 moves, completing in minutes)
- Turn-based game with low write frequency (one move per turn)
- Single document = atomic reads/writes without transactions
- No need for replay/audit infrastructure at this scale

**Consequences:**

- Simple query model (find by gameId, get everything)
- Document grows with each move (acceptable for < 200 moves)
- List queries fetch full state even when only metadata is needed (mitigated with `.limit()`)
- Atomic state transitions without distributed transactions
- If games grow very long, document size could become a concern (MongoDB 16MB limit)

---

## 6. WebSocket Architecture

> Investigations: [009-websocket-library.md](investigations/009-websocket-library.md), [001-websocket-server-framework.md](investigations/001-websocket-server-framework.md)

**Context:** The game requires real-time bidirectional communication for move updates, clock synchronization, rematch/takeback negotiation, and lobby notifications.

**Decision:** Single `ws.WebSocketServer` instance handling two connection types:

- `/api/ws?gameId=XXXX` — per-game connections for move updates
- `/api/ws/lobby` — lobby connections for matchmaking and social notifications

Messages are JSON-serialized and dispatched through `GameService.applyAction()`. Server validates every move using the shared game engine before broadcasting.

**Current limitation:** All WebSocket connections must terminate at the same server instance. Cross-instance broadcasting is not yet implemented.

**Future path:** Redis Pub/Sub channels per game room. Each instance subscribes to rooms where it has active connections. Broadcast publishes to Redis; local instances relay to their sockets.

**Consequences:**

- Simple, direct socket ↔ memory model with low latency
- Ping/pong heartbeat (10s) detects stale connections
- Origin validation prevents Cross-Site WebSocket Hijacking
- Single-instance bottleneck for concurrent connections (~10K practical limit per instance)

---

## 7. Shared Game Engine (Pure Functions)

**Context:** Both client and server need to validate game rules. Duplicating logic creates desync risk. Trusting the client is insecure.

**Decision:** Game rules are implemented as pure functions in `shared/src/tiao.ts`. Both client and server import from the same package. Functions take `GameState` and return `RuleResult<T>` (success with new state, or failure with code/reason). No side effects, no I/O.

**Client usage:** Optimistic UI updates — the client runs the rule engine locally to provide instant feedback, then sends the move to the server. If the server rejects it, the client reverts to the server-confirmed state.

**Server usage:** Authoritative validation — every move is validated using the same functions before persisting. The server is the single source of truth.

**Consequences:**

- Consistent behavior between client and server (same code, same edge cases)
- Cheating requires breaking the server, not just the client
- Larger client bundle (game engine code shipped to browser)
- Game logic changes require deploying both client and server
- Pure functions are trivially testable (no mocks needed)

---

## 8. Dual Authentication: Guest + Account

> Investigation: [002-auth-strategy.md](investigations/002-auth-strategy.md)

**Context:** The game should be accessible immediately (no signup wall) but also support persistent profiles, friends, and match history.

**Decision:** Two player types share a common `PlayerIdentity` shape:

- **Guest:** Instant creation, no credentials, ephemeral UUID, limited to one unfinished multiplayer game. Session-only persistence.
- **Account:** Email/password (bcrypt), persistent profile, friends list, game history, profile pictures. Full social features.

**Consequences:**

- Zero friction for first-time players (play immediately)
- Social features (friends, invitations, history) require an account
- Guest → Account upgrade is a separate flow (no automatic migration of guest games)
- Matchmaking mixes guests and accounts (no separate queues)
- Moderation: accounts can be banned, guests are ephemeral
- Guest smurf risk in matchmaking (mitigated by single-game limit)

---

## 9. Image Processing: Client + Server Resize

**Context:** Profile picture uploads need to be resized and optimized. The client runs on devices with varying network speeds.

**Decision:** Dual resize pipeline:

- **Client-side (canvas):** Crops to square, resizes to 512x512, compresses to JPEG at 85% quality. Provides instant preview and reduces upload payload (~30KB).
- **Server-side (Jimp):** Resizes to 320px width, converts to JPEG. Ensures consistent dimensions regardless of client behavior. Uploads to S3.

**Why both:**

- Client resize gives instant feedback and smaller uploads (important for mobile)
- Server resize guarantees uniformity (browser canvas quality varies)
- Defense in depth: even if client is modified, server produces consistent output

**Consequences:**

- Fast perceived upload (small payload after client resize)
- Consistent storage format (server normalizes everything to 320px JPEG)
- Upload limit: 512KB (after client resize, typical images are ~30KB)
- MIME type whitelist: JPEG, PNG, WebP, GIF (SVG rejected to prevent script injection)

---

## 10. Vite to Next.js 14 App Router Migration

> Investigation: [007-client-framework.md](investigations/007-client-framework.md)

**Context:** The client was a Vite-powered React SPA with react-router-dom. As the project matured, the SPA model became limiting: no server-side rendering for SEO, no social sharing meta tags (Open Graph), and no control over initial HTML for performance. A framework with SSR capabilities was needed.

**Decision:** Migrate to Next.js 14 App Router. This required:

- Replacing react-router-dom with Next.js file-system routing (`app/` directory)
- Creating a custom `server.mjs` wrapping Next.js with `http-proxy` for WebSocket proxying — same-origin session cookies don't work with cross-origin WebSocket connections
- Extracting auth state from `App.tsx` into an `AuthContext` provider
- Renaming `src/pages/` to `src/views/` to avoid Next.js Pages Router conflict
- Converting `VITE_*` environment variables to `NEXT_PUBLIC_*`
- Changing production Dockerfile from Nginx static serving to `node server.mjs`
- Changing SameSite cookie from `Strict` to `Lax` for Next.js navigation behavior

**Consequences:**

- SSR enables SEO and social sharing meta tags
- Custom `server.mjs` adds a proxy layer but enables same-origin cookies for WebSocket auth
- Production deployment requires a Node.js runtime (no longer static files)
- Vitest decoupled from build tool via standalone `vitest.config.mts`
- Larger deployment footprint but better user experience on first load

---

## 11. Tournament System Architecture

**Context:** The game needed a competitive structure beyond individual matches. Players requested organized tournaments with brackets, standings, and progression. The tournament system needed to integrate with the existing GameService and WebSocket infrastructure without disrupting normal game flow.

**Decision:** A dedicated tournament layer with its own service (`tournamentService.ts`), MongoDB model, REST API (12 endpoints), and WebSocket notifications. Three tournament formats supported:

- **Single Elimination:** Standard bracket, losers are eliminated
- **Round Robin:** Every player plays every other player, standings by points
- **Groups + Knockout:** Group stage (round-robin) followed by single-elimination bracket

Key design choices:

- Tournament games are regular games with special lifecycle rules (deferred timers, no rematch, auto-drop on disconnect)
- Bracket generation uses circle method (round-robin) and snake-seeding (elimination)
- GameService completion callbacks trigger automatic round advancement
- Shared tournament types in `shared/src/tournament.ts` for client-server consistency
- Player data assembled dynamically from `GameAccount` (no denormalized copies)

**Consequences:**

- Tournament games reuse the existing game engine and WebSocket infrastructure
- Round advancement is automatic — no manual intervention after tournament starts
- Tournament-specific UI (brackets, standings, match cards) is a significant client-side addition
- The `tournamentService.ts` is the largest single service file (~1100 lines) — potential candidate for decomposition
- Forfeit and auto-drop mechanics add complexity to the game lifecycle
