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
stops admissions, waits for socket close handlers and accepted lock operations,
then closes its local workers and stores with bounded cleanup. Stopping a local
matchmaking worker does not delete the global repeat schedule. Timed games use
persisted absolute deadlines when scheduling after reconnect.

## Matchmaking handoff

Queue entries carry a connection owner and a separate search attempt ID. Only
that owner may cancel its queued entry. Ownership changes and preemption reach
all replicas through Redis; matchmaking writes compare the live lease token
inside the same Lua command that changes Redis. Expired connection presence is
removed before pairing. Lobby/friend presence uses the same shared leases, with
a 15-second reconnect grace before disconnect callbacks revoke registrations.

The browser uses `matchmaking:enter-v2` and reuses its search ID and original
time control after `lobby:open`. Old servers ignore this new message without
performing a write; clients never fall back to the legacy mutation. Complete the
controlled backend adoption before publishing the new web/desktop client.
Both players' search IDs are stored atomically with the Mongo game room under a
unique sparse index. Startup waits for that index. If a matched reply or Redis
pointer is lost, the next attempt recovers the existing room. Reusing an ID with
changed time control is rejected. A socket close never deletes a matched receipt.
Pending player notifications are stored with the room in the same Mongo insert. The shared sweep replays them
until each player reaches the game, so an opponent on a surviving replica does
not wait forever when the publisher exits before sending its notification.
Opponent selection leaves queue entries in place until room creation succeeds.
Legacy clients without a search ID recover their existing active matchmaking
room; new clients can explicitly start a fresh search with a new ID.

Each search ID also has a Mongo receipt in `matchmakingsearches`. Claiming a
search marks every older active search of the same account as superseded, in
per-account claim order, so a delayed writer cannot retire a newer search. A
superseded ID is refused with `SEARCH_SUPERSEDED` even when the preemption
Pub/Sub notice was lost or Redis restarted; the browser treats this as
preemption. Searches without an ID (legacy clients, server requeue) supersede
all of the account's searches. Receipts expire after 30 days. A socket close or
a queue prune never supersedes a search, so the same ID resumes after reconnect.

The browser saves the search ID, account and time control in tab session
storage before its first send. A full-page reload within 15 minutes resumes the
same ID; account change, logout, match, cancel, preemption or a changed time
control discard it. If storage refuses the write, the search continues in memory
only.

Authentication buffers up to 16 early lobby messages (64 KiB total) and delivers
them only after authentication. This covers browsers sending immediately on
WebSocket open. First-move timeout notifications also use Redis so the worker
need not share a process with the player's connection.

Tournament room creation recovers by tournament/match ID before creating. New
rooms derive a deterministic ID from that pair, so the existing unique room ID
index prevents duplicate creation after a lost linkage save. Unlinking a room
increments its revision so an older room save cannot resurrect the link.

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
It also checks messages sent before auth completes, cross-replica search takeover,
stale socket close, Lua fencing after lease preflight, committed-match recovery
after Redis receipt loss, a superseded search refused after a Redis restart, and
a queued search surviving Redis/server retirement.
The live Coolify rollout and installed clients remain separate release gates.
Tournament recovery starts only after its Mongo index is ready and stops before
the game service or database close. Its separate real Mongo/Redis fault-injection
proof is `node scripts/test-tournament-rolling.mjs`; it covers missed completion
callbacks, duplicate room linkage, award replay, stale writers, cancellation and
registration absence grace continued by a survivor after worker retirement.

Tournament registration absence is persisted on the tournament. The lobby
disconnect callback is only a shortcut: the recovery scan rechecks shared lobby
presence every few seconds, records when a registered player was first seen
absent, clears it on reconnect through any replica, and unregisters after 15
seconds. A failed presence read neither records absence nor removes anyone.
## Web client across releases

A browser tab keeps running the JavaScript of the release that served its
document. CI copies the previous `tiao-client:main` image's `/_next/static` and
the releases that image carried into the new image (two releases in total,
`client/scripts/carry-release-static.mjs`); the Docker build refuses a hashed
path with different bytes. Builds can be pushed without being deployed, so the
repository variable `TIAO_CLIENT_SERVING_IMAGE` (an image digest reference)
names the image actually serving traffic; when set, it is carried first.
`client/release-assets.mjs` serves those files when
the running build has no file at that path, so old tabs keep loading their lazy
chunks after a deploy. Assets are about 3 MB per carried release.

The full commit SHA is Next's `deploymentId` (`BUILD_COMMIT`). Router and action
requests carrying another release's `x-deployment-id` get 409; the Next router
then loads one complete document from the current release. The service worker
never caches flight data, so an old payload cannot reach a newer page.

A tab whose chunks are no longer anywhere (older than two releases, or a new
document that reached the old container during overlap) reloads once. An inline
script handles failed initial chunks; `ReleaseRecovery` and the error boundaries
handle lazy ones. A 30-second guard stops loops. Hot-seat and computer games are
saved in tab session storage and restored after any reload of the same URL;
leaving the page inside the app discards them. Online state is server-owned and
matchmaking keeps its saved search id.

After draining, the frontend gives open connections 8 seconds, then exits 0,
inside a 30-second container stop. `/health` reports `build` and the carried
releases.

`node scripts/test-client-releases.mjs` builds two real clients (B, and C with a
changed lazily loaded module that carries B), runs both production servers
behind a routing proxy and drives Chromium: B's document running entirely on
chunks served by C, a refused foreign router request followed by exactly one
full navigation, recovery from missing initial chunks, hot-seat restore after a
reload, and a clean drain. Set `CHROMIUM_PATH` to use an installed Chromium.

The first deploy of this code carries the live image's assets but that image has
no recovery code; old tabs only gain carried chunks, not the 409 path. Client
proxy retirement remains a separate release gate.
