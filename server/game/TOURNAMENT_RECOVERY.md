# Tournament recovery across replicas

Every tournament mutation holds its Redis lease. Lease acquisition writes a fresh
Mongo authority token, then the mutation reads the document. Saves and deletion
compare both token and revision; missing legacy revisions count as zero. Creator
quota checks use a separate creator lease. Production startup requires Redis.

The first deployment of these writers requires retiring all older tournament
writers before accepting mutations: the previous unconditional Mongo updates do
not honor fencing. After that adoption boundary, replicas can overlap and recover
from worker retirement using the same database and Redis service.

## Commit and recovery boundaries

- Starting a bracket commits the active tournament before inserting rooms. Each
  room uses the stable tournament/match identity. A failed link write is retried
  against that room; the link commits before match-ready notifications.
- Finished game documents are the completion journal. A bounded recovery scan
  reads active tournaments, applies only previously unfinished match results,
  and commits each bracket transition under the tournament lease. Lost callbacks
  are recovered on startup or subsequent scans. Callback work starts outside the
  completed game's lease context.
- Cancellation commits before unlinking games. Cancelled records remain cleanup
  tombstones. User deletion hides a tombstone from ordinary reads and lists, but
  preserves recovery of delayed room inserts that arrive after the first cleanup.
  Deletion clears the name, description, creator, participants, bracket and invite
  code from the retained record.
  Tombstones must not be purged while delayed writers can still act; this version
  deliberately has no automatic tombstone retention cutoff.
- Champion achievements use their unique database key. Companion badges use an
  idempotent add-to-set so recovery also repairs a crash between those writes.
  The pending completion marker clears only after these writes succeed. Analytics,
  WebSocket notifications, and Discord messages remain best effort, without an
  exactly-once delivery guarantee.
- Group and round-robin draws are completed results. Elimination draws require an
  administrator to select the existing forfeit resolution; recovery does not
  invent a winner or advance an empty bracket slot.

Call `startRecovery()` after Mongo connects and tournament indexes are ready.
Call `close()` before closing game/database/Redis resources; it stops scan
admission, rejects new mutations, and waits for accepted work. The process-level
shutdown deadline still bounds a dependency that stops answering.

## Validation

Build the server, then run `server/dist/server/tests/tournamentRecovery.test.js`
with Node's test runner and `NODE_ENV=test`. Existing tournament service tests
also cover normal brackets, registration, and cancellation.

Run `node scripts/test-tournament-rolling.mjs` after building for an isolated real
Mongo/Redis proof. It uses an empty temporary working directory, synthetic
identities, a 256 MB Mongo cache and a 96 MB Redis container, and cleans up its
owned processes. It checks two service instances, failed room-link commits, lost
completion callbacks, award repair, Mongo/Redis stale-writer refusal, and
cancellation/deletion recovery. It requires local `mongod` and Docker and never
uses the project's environment files or production data.
