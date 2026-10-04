# Multiplayer rolling protocol 2

Mongo remains the authoritative room store. Redis supplies short-lived game
locks, per-connection presence, Pub/Sub and BullMQ timers. Health must pass
`/health` on the backend and `/health` on the frontend before replacement.
The backend reports `rollingProtocol: 2` and checks Mongo, Redis, subscriber
readiness and process drain state. Existing sockets reconnect and obtain a new
Mongo snapshot after retirement or a Redis subscription gap.

## First adoption

The previous release writes rooms without a Mongo authority token or revision
check. It cannot safely overlap protocol 2 writers. Before adopting protocol 2,
stop admissions, disconnect/reconnect legacy clients in a controlled window,
and wait for all legacy backend processes/workers to exit. Preserve Mongo room
records and Redis timer data; do not restart or erase active matches. Resume
admissions only when the new backend is ready. Rolling overlap is supported only
between releases that enforce this same authority protocol. A rollback to an
unfenced release requires another controlled transition with all protocol 2
writers stopped first.

The added `authorityToken` and `revision` fields are backward-readable. Their
presence alone does not make an old writer safe. Record the previous image
digest and exact source commit before the first adoption.

## Authority and presence

Redis locks renew while work runs. Every room save checks the enclosing leases,
then atomically compares Mongo authority token and revision. Acquiring a room
lock claims a fresh token in Mongo before reading/mutating that room. This
prevents an old paused writer from overwriting a successor even if its delayed
Mongo request arrives after Redis lease expiry. The single-process fallback
also waits for the prior operation; it never silently starts concurrent work
because a wait took 15 seconds.

Each socket gets its own Redis presence lease. Disconnect removes only that
lease; a process crash expires it. Snapshots, tournament readiness and guest
abandon decisions read shared presence instead of local socket counts. A Redis
subscription gap closes existing sockets, requiring the client's normal
reconnect and authoritative snapshot flow. The health endpoint remains unready
until the subscriber has restored its subscriptions.

A retiring process drains for 20 seconds before closing its sockets. It then
stops admissions, closes its local workers and bounds cleanup. Stopping a local
matchmaking worker does not delete the global repeat schedule. Timed games use
persisted absolute deadlines when scheduling after reconnect.

## Verification

Build the server, then run `node scripts/test-rolling.mjs` from the repository.
The fixture requires local Docker with `redis:7-alpine` and a local `mongod`.
It creates synthetic accounts in a fresh database, starts two production server
processes on checked high loopback ports, and removes its containers/processes
and database files afterward. It does not read provider credentials or contact
production. Small logs and the result JSON stay in its temporary evidence
folder.

The proof exercises real authentication and sockets, shared presence, remote
move delivery, lease renewal/loss, Mongo stale-writer fencing, Redis recovery,
active-match handoff, HTTP readiness and preservation of the shared sweep job.
The live Coolify rollout and installed clients remain separate release gates.
Tournament-wide and matchmaking ownership need their own overlap proof before
this entire application is certified for rolling release.
