# Investigation: WebSocket Library

**Status:** Decided — see [ADR #6 (WebSocket Architecture)](../ARCHITECTURE_DECISIONS.md#6-websocket-architecture)
**Date:** Since project inception

## Context

The game requires real-time bidirectional communication for move updates, clock synchronization, rematch/takeback negotiation, and lobby notifications.

## Options Considered

### Socket.IO

- Most popular Node.js real-time library (~62K stars)
- Automatic fallback to long-polling, reconnection, rooms, namespaces, acknowledgements
- Significant protocol overhead (framing, fallback negotiation, heartbeat)
- Larger client bundle (~45KB min+gzip with client library)
- Abstractions (rooms, namespaces) are convenient but add latency

### ws (chosen)

- Raw WebSocket library for Node.js (~22K stars)
- Minimal overhead — just WebSocket protocol, nothing more
- No rooms, namespaces, reconnection, or fallback — build what you need
- Tiny footprint, fast
- JSON message serialization handled manually

### WebSocket API (native, via frameworks like Hono or Bun)

- Available if migrating to a different framework/runtime (see Investigation #001)
- Same raw WebSocket semantics as `ws`

## Outcome

Raw `ws` was chosen because:

1. The game has exactly two connection types (game + lobby) — no need for Socket.IO's namespace abstraction
2. Game state sync is custom (server-authoritative validation, optimistic client updates) — Socket.IO's event system adds overhead without helping
3. Fallback to long-polling is unnecessary — all modern browsers/devices support WebSocket
4. Reconnection is handled at the application level (rejoin game by ID) rather than at the transport level
5. Smaller attack surface and easier to audit

The tradeoff is manually implementing ping/pong heartbeat (10s interval), origin validation, and connection lifecycle management. These are straightforward and total ~100 lines of code.
