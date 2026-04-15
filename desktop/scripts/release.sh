#!/usr/bin/env bash
set -euo pipefail

# Maintainer release wrapper for the Tiao desktop app.
#
# Sources credentials from `desktop/.env.release` (git-ignored) and
# runs electron-builder to produce installers for the host platform.
#
# .env.release should define:
#
#   TIAO_DESKTOP_VERSION    — version string baked into TiaoDesktop/X UA
#   TIAO_API_URL            — API base URL (defaults to production)
#   TIAO_OPENPANEL_CLIENT_ID      — OpenPanel public client id for the
#                                   main-process analytics wrapper
#   TIAO_OPENPANEL_API_URL        — OpenPanel ingest URL
#
# When macOS code signing is added (follow-up worktree), also:
#   APPLE_ID                      — developer Apple ID email
#   APPLE_APP_SPECIFIC_PASSWORD   — app-specific password
#   APPLE_TEAM_ID                 — Developer Team ID
#
# AND, in the same commit that wires up those secrets, flip these
# fields in package.json's "build.mac" block to true:
#
#   hardenedRuntime: true
#   gatekeeperAssess: true
#
# They are intentionally false in Phase 3a so the unsigned dmgs are
# still installable on Apple Silicon.  Apple's notary service REJECTS
# any app that is signed but doesn't have hardenedRuntime enabled, so
# leaving them false alongside a signing config will fail every build
# at the notarization step with a confusing error.
#
# Usage:
#   ./scripts/release.sh                 # host platform only
#   ./scripts/release.sh --all           # macOS + Windows + Linux (needs the host to be macOS for mac builds)
#
# Does NOT publish to GitHub Releases — that's a separate explicit
# step.  Artifacts land in `desktop/dist/`.

cd "$(dirname "$0")/.."

if [ -f .env.release ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.release
  set +a
else
  echo "[release] .env.release not found — using built-in defaults."
  echo "[release] Copy .env.release.example if one is added in a follow-up."
fi

export TIAO_DESKTOP_VERSION="${TIAO_DESKTOP_VERSION:-$(node -p "require('./package.json').version")}"

echo "[release] building tiao-desktop v${TIAO_DESKTOP_VERSION}"

# Ensure the client static export is fresh.
npm run dev:build-client

if [ "${1:-}" = "--all" ]; then
  npm run package:all
else
  npm run package
fi

echo "[release] done — artifacts in desktop/dist/"
ls -1 dist/ 2>/dev/null || true
