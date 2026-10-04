#!/usr/bin/env bash
set -euo pipefail

# Local build wrapper for the Tiao desktop app (host platform, direct channel).
#
# Release builds come from CI: .github/workflows/build-desktop.yml signs,
# notarizes and verifies every channel, and publish-desktop.yml uploads a
# tested run. See docs/RELEASING-desktop.md. This script is for local
# packaging only and never publishes.
#
# Sources optional overrides from `desktop/.env.release` (git-ignored), e.g.
#   TIAO_DISTRIBUTION_CHANNEL   direct | itch | steam | mas | msstore
#   TIAO_SIGNED=1               sign with identities from your keychain
#   APPLE_KEYCHAIN_PROFILE      notarytool profile for a signed local Mac build
#
# Usage:
#   ./scripts/release.sh                 # host platform only
#   ./scripts/release.sh --all           # macOS + Windows + Linux (needs a Mac host)

cd "$(dirname "$0")/.."

if [ -f .env.release ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.release
  set +a
fi

if [ "${TIAO_SIGNED:-0}" != "1" ]; then
  # Unsigned: keep electron-builder away from any identity in the keychain.
  export CSC_IDENTITY_AUTO_DISCOVERY=false
fi

echo "[release] building tiao-desktop v$(node -p "require('./package.json').version") (${TIAO_DISTRIBUTION_CHANNEL:-direct})"

# Ensure the client static export is fresh.
npm run dev:build-client

if [ "${1:-}" = "--all" ]; then
  npm run package:all
else
  npm run package
fi

echo "[release] done — artifacts in desktop/dist/${TIAO_DISTRIBUTION_CHANNEL:-direct}/"
