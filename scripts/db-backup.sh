#!/usr/bin/env bash
#
# db-backup.sh — dump the tiao MongoDB database, compress it, upload it with
# rclone and prune old copies on the remote.
#
# Usage:
#   scripts/db-backup.sh [--dry-run] [--help]
#
# What it does:
#   1. mongodump --archive --gzip  → <tmp>/tiao-<UTC timestamp>.archive.gz
#   2. gzip -t on the archive (integrity check)
#   3. rclone copy <archive> $BACKUP_REMOTE, then rclone check to verify
#   4. rclone delete $BACKUP_REMOTE --min-age ${BACKUP_KEEP_DAYS}d  (optional)
#   5. remove the local temp directory (always, via trap)
#
# Environment variables:
#   MONGODB_URI       required  Connection string for mongodump, e.g.
#                               mongodb://user:pass@host:27017/tiao?authSource=admin
#                               Passed to mongodump via a temp config file so the
#                               password never shows up in `ps`.
#   BACKUP_REMOTE     required  rclone destination, "<remote>:<bucket>[/<path>]",
#                               e.g. b2:tiao-backups or hetzner:tiao-backups/db.
#                               The remote must already exist in `rclone config`.
#   BACKUP_KEEP_DAYS  optional  Delete remote backups older than N days after a
#                               successful upload. Default 30. Set 0 to disable
#                               pruning.
#   BACKUP_PREFIX     optional  Archive file name prefix. Default "tiao". Pruning
#                               only touches files matching <prefix>-*.archive.gz.
#   BACKUP_TMP_DIR    optional  Parent directory for the temporary dump. Default
#                               is the system temp dir (mktemp -d).
#
# --dry-run:
#   * mongodump still runs when MONGODB_URI is set (the dump is local and
#     side-effect free), and is skipped with a message when it is unset.
#   * rclone copy / rclone delete run with --dry-run, so nothing is uploaded
#     or deleted; if BACKUP_REMOTE is unset the rclone steps are only printed.
#   * mongodump / rclone binaries are not required in dry-run mode.
#
# Restore: see scripts/README.md ("Restoring a backup").
#
# Exit codes: 0 ok, 1 usage / configuration error, otherwise the failing
# command's exit code (set -e).

set -euo pipefail

DRY_RUN=0

usage() {
  sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "db-backup: unknown argument: $arg" >&2
      echo "usage: $0 [--dry-run]" >&2
      exit 1
      ;;
  esac
done

log() {
  printf '[db-backup] %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

die() {
  echo "[db-backup] ERROR: $*" >&2
  exit 1
}

# --- configuration ----------------------------------------------------------

MONGODB_URI="${MONGODB_URI:-}"
BACKUP_REMOTE="${BACKUP_REMOTE:-}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
BACKUP_PREFIX="${BACKUP_PREFIX:-tiao}"
BACKUP_TMP_DIR="${BACKUP_TMP_DIR:-}"

if [[ "$DRY_RUN" -eq 0 ]]; then
  [[ -n "$MONGODB_URI" ]] || die "MONGODB_URI is not set"
  [[ -n "$BACKUP_REMOTE" ]] || die "BACKUP_REMOTE is not set (e.g. b2:tiao-backups)"
  command -v mongodump >/dev/null 2>&1 || die "mongodump not found in PATH (install mongodb-database-tools)"
  command -v rclone >/dev/null 2>&1 || die "rclone not found in PATH"
fi

[[ "$BACKUP_KEEP_DAYS" =~ ^[0-9]+$ ]] || die "BACKUP_KEEP_DAYS must be a non-negative integer, got '$BACKUP_KEEP_DAYS'"
[[ "$BACKUP_PREFIX" =~ ^[A-Za-z0-9._-]+$ ]] || die "BACKUP_PREFIX may only contain letters, digits, '.', '_' and '-'"
[[ -z "$BACKUP_REMOTE" || "$BACKUP_REMOTE" == *:* ]] || die "BACKUP_REMOTE must look like <remote>:<bucket>[/<path>], got '$BACKUP_REMOTE'"

# Strip any password from the URI before it reaches the log.
redact_uri() {
  sed -E 's#(//[^:/@]+):[^@]*@#\1:***@#' <<<"$1"
}

have() {
  command -v "$1" >/dev/null 2>&1
}

# --- temp dir + cleanup -----------------------------------------------------

if [[ -n "$BACKUP_TMP_DIR" ]]; then
  mkdir -p "$BACKUP_TMP_DIR"
  WORK_DIR="$(mktemp -d "${BACKUP_TMP_DIR%/}/db-backup.XXXXXX")"
else
  WORK_DIR="$(mktemp -d -t db-backup)"
fi

cleanup() {
  local rc=$?
  # WORK_DIR is always a fresh mktemp directory owned by this run.
  rm -rf -- "$WORK_DIR"
  exit "$rc"
}
trap cleanup EXIT

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE_NAME="${BACKUP_PREFIX}-${TIMESTAMP}.archive.gz"
ARCHIVE_PATH="${WORK_DIR}/${ARCHIVE_NAME}"

if [[ "$DRY_RUN" -eq 1 ]]; then
  log "DRY RUN — nothing will be uploaded or deleted"
fi
log "archive: $ARCHIVE_NAME"
log "remote:  ${BACKUP_REMOTE:-<unset>}"
log "keep:    ${BACKUP_KEEP_DAYS} days"

# --- 1. mongodump -----------------------------------------------------------

if [[ -n "$MONGODB_URI" ]] && have mongodump; then
  log "mongodump from $(redact_uri "$MONGODB_URI")"
  # The URI goes through a config file (mode 600) instead of --uri so the
  # password is not visible in the process list.
  MONGO_CONFIG="${WORK_DIR}/mongodump.yaml"
  (
    umask 077
    printf 'uri: "%s"\n' "$MONGODB_URI" >"$MONGO_CONFIG"
  )
  mongodump --config="$MONGO_CONFIG" --archive="$ARCHIVE_PATH" --gzip --quiet
  rm -f -- "$MONGO_CONFIG"

  # --- 2. integrity check ---------------------------------------------------
  gzip -t "$ARCHIVE_PATH"
  ARCHIVE_SIZE="$(du -h "$ARCHIVE_PATH" | cut -f1)"
  log "dump ok: ${ARCHIVE_SIZE} ${ARCHIVE_PATH}"
else
  # Only reachable in dry-run mode: the non-dry-run preflight above dies when
  # MONGODB_URI or mongodump is missing.
  if [[ -z "$MONGODB_URI" ]]; then
    log "would run: mongodump --uri=\$MONGODB_URI --archive=$ARCHIVE_PATH --gzip (skipped: MONGODB_URI unset)"
  else
    log "would run: mongodump --uri=$(redact_uri "$MONGODB_URI") --archive=$ARCHIVE_PATH --gzip (skipped: mongodump not installed)"
  fi
  log "would run: gzip -t $ARCHIVE_PATH"
fi

# --- 3. upload --------------------------------------------------------------

# bash 3.2 (macOS) treats an empty array as unset under `set -u`, so the
# expansions below use the ${arr[@]+"${arr[@]}"} idiom.
RCLONE_FLAGS=()
RCLONE_FLAGS_LABEL=""
if [[ "$DRY_RUN" -eq 1 ]]; then
  RCLONE_FLAGS+=(--dry-run)
  RCLONE_FLAGS_LABEL="--dry-run "
fi

if [[ -n "$BACKUP_REMOTE" ]] && have rclone && [[ -f "$ARCHIVE_PATH" ]]; then
  log "rclone copy ${RCLONE_FLAGS_LABEL}$ARCHIVE_NAME -> $BACKUP_REMOTE"
  rclone copy ${RCLONE_FLAGS[@]+"${RCLONE_FLAGS[@]}"} "$ARCHIVE_PATH" "$BACKUP_REMOTE"
  if [[ "$DRY_RUN" -eq 0 ]]; then
    rclone check --one-way "$WORK_DIR" "$BACKUP_REMOTE" --include "$ARCHIVE_NAME" >/dev/null 2>&1 \
      || die "upload verification failed for $ARCHIVE_NAME on $BACKUP_REMOTE"
    log "upload verified on $BACKUP_REMOTE"
  fi
else
  # Dry-run without a remote, without rclone, or without a dump to hand over.
  log "would run: rclone copy --dry-run $ARCHIVE_PATH ${BACKUP_REMOTE:-\$BACKUP_REMOTE}"
fi

# --- 4. prune old remote backups --------------------------------------------

if [[ "$BACKUP_KEEP_DAYS" -eq 0 ]]; then
  log "pruning disabled (BACKUP_KEEP_DAYS=0)"
elif [[ -n "$BACKUP_REMOTE" ]] && have rclone; then
  log "rclone delete ${RCLONE_FLAGS_LABEL}$BACKUP_REMOTE --min-age ${BACKUP_KEEP_DAYS}d --include '${BACKUP_PREFIX}-*.archive.gz'"
  rclone delete ${RCLONE_FLAGS[@]+"${RCLONE_FLAGS[@]}"} "$BACKUP_REMOTE" \
    --min-age "${BACKUP_KEEP_DAYS}d" \
    --include "${BACKUP_PREFIX}-*.archive.gz"
else
  log "would run: rclone delete --dry-run ${BACKUP_REMOTE:-\$BACKUP_REMOTE} --min-age ${BACKUP_KEEP_DAYS}d --include '${BACKUP_PREFIX}-*.archive.gz'"
fi

# --- 5. local cleanup happens in the EXIT trap ------------------------------

log "done"
