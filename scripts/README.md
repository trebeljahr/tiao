# scripts/

Helper scripts that live outside the npm workspaces. Run them from the repo
root.

| Script | Purpose |
| --- | --- |
| `db-backup.sh` | Dump MongoDB, upload the archive with rclone, prune old copies. See below. |
| `dev.mjs` / `dev-preview.sh` | Start client, server and infra for development. |
| `dev-desktop.mjs` | Dev orchestrator for the Electron desktop app. |
| `measure-cold-compile.mjs` | Measure client cold-compile time for a Next.js route. |
| `seed-tournament.mjs` | Dev-only: create bot accounts and drive a tournament. |
| `steam-achievements.mjs` | Turn `shared/src/achievements.ts` into Partner Portal shapes. |
| `steam-achievement-icons.mjs` | Render the achievement icons Steam wants. |
| `wait-for-port.mjs` | Block until a TCP port accepts connections. |

## Database backups: `db-backup.sh`

Dumps the database behind `MONGODB_URI` with `mongodump --archive --gzip`,
checks the archive with `gzip -t`, uploads it to an rclone remote, verifies the
upload with `rclone check`, then deletes remote copies older than
`BACKUP_KEEP_DAYS`. The local temp directory is removed on every exit path.

Archive names are `<BACKUP_PREFIX>-<UTC timestamp>.archive.gz`, for example
`tiao-20260923T031500Z.archive.gz`.

### Requirements on the host

- `bash`, `gzip`
- `mongodump` from
  [mongodb-database-tools](https://www.mongodb.com/docs/database-tools/installation/installation/)
  (version 100.x; the script passes the URI through `--config` so the password
  stays out of the process list)
- [`rclone`](https://rclone.org/install/) with the destination remote already
  configured (`rclone config`), for example a Backblaze B2 bucket
  (`b2:tiao-backups`) or Hetzner Object Storage via the S3 backend
  (`hetzner:tiao-backups`)

### Environment variables

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `MONGODB_URI` | yes | – | Connection string for `mongodump`. Same value the server uses. |
| `BACKUP_REMOTE` | yes | – | rclone destination `<remote>:<bucket>[/<path>]`. |
| `BACKUP_KEEP_DAYS` | no | `30` | Delete remote archives older than N days. `0` disables pruning. |
| `BACKUP_PREFIX` | no | `tiao` | Archive name prefix. Pruning only matches `<prefix>-*.archive.gz`. |
| `BACKUP_TMP_DIR` | no | system temp | Parent directory for the temporary dump. |

The same variables are documented in `server/.env.example`.

### Manual invocation

```bash
MONGODB_URI='mongodb://user:pass@mongo:27017/tiao?authSource=admin' \
BACKUP_REMOTE='b2:tiao-backups' \
BACKUP_KEEP_DAYS=30 \
scripts/db-backup.sh
```

Rehearse without touching the remote:

```bash
MONGODB_URI='mongodb://127.0.0.1:27017/tiao' BACKUP_REMOTE='b2:tiao-backups' scripts/db-backup.sh --dry-run
```

`--dry-run` still runs `mongodump` (local, side-effect free) when
`MONGODB_URI` is set, and passes `--dry-run` to every rclone call. With no
environment at all it prints the commands it would run and exits 0, so it also
works as a smoke test on a machine without the tools installed.

To test the whole pipeline against a local directory instead of a cloud remote,
use rclone's on-the-fly local backend:

```bash
MONGODB_URI='mongodb://127.0.0.1:27017/tiao' BACKUP_REMOTE=':local:/tmp/tiao-backups' scripts/db-backup.sh
```

### Scheduling (Coolify)

Deployment wiring is intentionally not part of the repo. Suggested setup in
Coolify: add a **Scheduled Task** on the server resource (or a small
`mongodb-database-tools` + `rclone` sidecar) with the env vars above, and a
command such as:

```
0 3 * * *  /app/scripts/db-backup.sh
```

For a plain crontab on the host, redirect output to a log file so failures are
visible:

```
0 3 * * *  cd /opt/tiao && MONGODB_URI=... BACKUP_REMOTE=b2:tiao-backups scripts/db-backup.sh >> /var/log/tiao-backup.log 2>&1
```

The script exits non-zero on any failure (`set -euo pipefail`), so a cron
mailer or Coolify's task status will flag a broken run.

### Restoring a backup

1. List and fetch the archive you want:

   ```bash
   rclone lsl b2:tiao-backups
   rclone copy b2:tiao-backups/tiao-20260923T031500Z.archive.gz /tmp/
   ```

2. Restore it. `--drop` replaces existing collections with the archived
   versions. Omit it to merge, which keeps documents that only exist in the
   live database.

   ```bash
   mongorestore --gzip --archive=/tmp/tiao-20260923T031500Z.archive.gz --uri='mongodb://user:pass@mongo:27017/?authSource=admin' --drop
   ```

3. To restore into a different database first (for inspection or a partial
   recovery), remap the namespace:

   ```bash
   mongorestore --gzip --archive=/tmp/tiao-20260923T031500Z.archive.gz --nsFrom='tiao.*' --nsTo='tiao_restore.*' --drop
   ```

Check the result with `mongosh <uri> --eval 'db.getCollectionNames()'` before
pointing the server at it.
