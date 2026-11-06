# scripts/

Helper scripts that live outside the npm workspaces. Run them from the repo
root.

| Script | Purpose |
| --- | --- |
| `db-backup.sh` | Dump MongoDB, upload the archive with rclone, prune old copies. See below. |
| `dev.mjs` / `dev-preview.sh` | Start client, server and infra for development. |
| `dev-desktop.mjs` | Dev orchestrator for the Electron desktop app. |
| `discord-register-commands.ts` | Bulk-register the Tiao slash commands with Discord (`pnpm discord:register`). |
| `discord-setup.ts` | Bootstrap the community Discord server: categories, channels, roles, game-results webhook. Idempotent; `pnpm setup:discord --dry-run` prints the plan. |
| `measure-cold-compile.mjs` | Measure client cold-compile time for a Next.js route. |
| `seed-tournament.mjs` | Dev-only: create bot accounts and drive a tournament. |
| `steam-achievements.mjs` | Turn `shared/src/achievements.ts` into Partner Portal shapes. |
| `export-achievement-artwork.mjs` | Build in-game achievement WebP assets from the selected artwork masters. |
| `steam-achievement-icons.mjs` | Render the achievement icons Steam wants. |
| `store-art.mjs` | Export Steam capsules/library art, Apple header, and Google Play icon/feature graphic to `build/store-media/`. Run `pnpm store:art`. Uses existing board artwork and a recorded legal position; outputs promotional graphics, not screenshots. |
| `app-store-screenshots.mjs` | Capture gameplay and UI, then export a varied ten-image selection with an HTML gallery and checksums under `output/playwright/store-overview/<size>/`. Run `pnpm store:screenshots http://127.0.0.1:<port>` for Apple sizes, or add `--only=steam-1080p` for Steam/press. Local client only; sample API data stays isolated. |
| `marketing/capture-screenshots.mjs` | Run the store pipeline at the Mac and 6.9" iPhone sizes against a client it starts on a free high port, then export the README and press picks to `docs/marketing/screenshots/` with `manifest.json` entries. Run `pnpm marketing:screenshots` (`--export-only` to re-export, `--url` to reuse a running client). |
| `marketing/render-social-preview.mjs` | Render the three GitHub social preview cards from `docs/marketing/social-preview/template.html`. Run `pnpm marketing:social [--review-dir <folder>]`. See `docs/marketing/README.md`. |
| `store-screenshot-selection.mjs` | Defines the store upload order: AI capture chain, tutorial, achievements, developed AI game, computer setup, bracket, friends, themes, replay, victory. Board images require per-capture AI provenance and matching ledger checksums. |
| `generate-screenshot-ai-matches.ts` | Record complete `long` (19×19, first to 20) or `compact` (13×13, first to 15) games between the shipped Intermediate/Hard AIs, with normal search budgets. Run using an installed `tsx --tsconfig client/tsconfig.json`. Every decision, search result and board checksum is retained. |
| `store-ai-scenes.mjs` | Validate complete self-play logs and choose developed positions and whole AI capture turns. All screenshot gameplay, review, theme and history boards use these logs. `node --test scripts/store-ai-scenes.test.mjs` checks replay integrity and rejects altered data. |
| `store-trailer.mjs` | Encode actual replay UI captures into a muted, captioned 30-second H.264 trailer. Run `pnpm store:trailer [capture-folder]`; requires `ffmpeg`, `capture.json` and its original JPEG frames. Removes pauses between takes, plays the replay at 1.75×, and holds the winning frame. The current capture bundle is preserved in the Tiao vault's 2026-10-23 store-readiness materials. |
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

### UI sound audition

Run `node scripts/preview-sound-lab.mjs` for the standalone workbench (uses an
available high loopback port; accepts `PORT`). Or open `/sound-lab` in development.
The route is excluded from production builds.

Choose Click, Success or Error, then select a sound and volume for that category.
The playground uses the production board, local rules engine, setup dialog,
theme picker and input controls. No account, backend or multiplayer actions run.
Border-rule failures play Error; game setup/reset and valid ID checks play Success.
Other enabled controls play Click. The production defaults are Linen, Warm confirm
(the two-tap confirm) and Low double. Each category supports a saved override or
explicit Off; the game mute control silences all audio. The curated cues are
matched to the same 200ms energy window and receive a 1.3× UI output gain.
The original board placement MP3 and playback level remain unchanged.

Use `playUiFeedback("success")` / `playUiFeedback("error")` for action results.
Controls may declare `data-ui-feedback="success"` or `"error"` for immediate,
known outcomes, or `"manual"` when their handler determines the result. These
replace the generic click cue so a single action does not stack two sounds.
Success/error toasts also produce their corresponding cue once; initial toast
history and rerenders are silent. Outcome playback clears pending UI clicks.

Export mono 44.1 kHz PCM WAVs and the one-cue-per-option montage at the calibrated
50% UI mix. Add `--selected` for the three curated production sounds. The
`mix-settings.json` export records gains, peaks and 200ms RMS measurements:

```sh
node --experimental-strip-types scripts/export-ui-clicks.ts /absolute/output/directory --selected
```

Recipes and synthesis live in `client/src/lib/uiClickSynth.ts`. No external
samples or network audio services are used.
