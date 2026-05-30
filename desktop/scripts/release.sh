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
# For signed macOS builds, set (see desktop/README.md "Signing"):
#   CSC_LINK                      — base64 of Developer ID .p12 or file:// path
#   CSC_KEY_PASSWORD              — .p12 keystore password
#   APPLE_ID                      — developer Apple ID email
#   APPLE_APP_SPECIFIC_PASSWORD   — app-specific password (appleid.apple.com)
#   APPLE_TEAM_ID                 — Developer Team ID
#
# For signed Windows builds, set:
#   CSC_LINK                      — base64 of .pfx or file:// path
#   CSC_KEY_PASSWORD              — .pfx keystore password
#
# All of the above are optional — leaving them unset produces an
# unsigned build.  hardenedRuntime is already enabled in package.json
# so signed builds will pass Apple's notary requirements; unsigned
# builds still install (Gatekeeper quarantines them on first launch).
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
