#!/usr/bin/env bash
# release-tag.sh — stamp the current commit with the desktop package's
# version as `desktop-vX.Y.Z`, optionally pushing the tag.
#
# Tags never build or publish anything. The release flow is:
#
#   1. `npm run version:set -- X.Y.Z`, commit, integrate into main.
#   2. Dispatch build-desktop.yml (signed) on main and test its artifacts.
#   3. Tag that exact commit with this script and push the tag.
#   4. Dispatch publish-desktop.yml with the build run ID. The
#      downloads-draft destination refuses a tag at any other commit;
#      itch, Steam, the Mac App Store and the Microsoft Store read the
#      version from the verified build manifests.
#
# See docs/RELEASING-desktop.md.
#
# Tag format: `desktop-vX.Y.Z`. The `desktop-` prefix keeps the tag
# namespace separate from any future tags on the client / server /
# docs packages — the monorepo can ship those independently without
# the tag history colliding.
#
# Usage:
#   ./scripts/release-tag.sh                 # tag desktop/package.json version
#   ./scripts/release-tag.sh --push          # also push the tag to origin

set -euo pipefail

DESKTOP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DESKTOP_ROOT"

# Read version from package.json. Use node so we don't rely on jq/sed
# and so the parsed string matches exactly what npm sees in
# $npm_package_version.
VERSION=$(node -p "require('./package.json').version")
TAG="desktop-v${VERSION}"

if [[ -z "${VERSION}" ]]; then
  echo "release-tag: could not read version from desktop/package.json" >&2
  exit 1
fi

# Refuse to tag a dirty tree — a tag should reference a commit the
# user can actually reproduce. FORCE_DIRTY=1 bypasses for emergencies.
if [[ -z "${FORCE_DIRTY:-}" ]] && ! git diff-index --quiet HEAD --; then
  echo "release-tag: working tree is dirty. Commit or stash first" >&2
  echo "            (or run with FORCE_DIRTY=1 to bypass)" >&2
  exit 2
fi

# Idempotent: if the tag already exists and points at HEAD, no-op. If
# it exists pointing elsewhere, bail — never rewrite published tags;
# bump the patch version instead.
if git rev-parse "$TAG" >/dev/null 2>&1; then
  EXISTING_SHA=$(git rev-list -n 1 "$TAG")
  HEAD_SHA=$(git rev-parse HEAD)
  if [[ "$EXISTING_SHA" == "$HEAD_SHA" ]]; then
    echo "release-tag: tag $TAG already exists at HEAD — nothing to do"
  else
    echo "release-tag: tag $TAG already exists pointing at $EXISTING_SHA" >&2
    echo "            HEAD is at $HEAD_SHA" >&2
    echo "            Bump the patch version in desktop/package.json and retry" >&2
    echo "            (never rewrite a published tag)." >&2
    exit 3
  fi
else
  git tag -a "$TAG" -m "Release $TAG"
  echo "release-tag: tagged HEAD as $TAG"
fi

if [[ "${1:-}" == "--push" ]]; then
  git push origin "$TAG"
  echo "release-tag: pushed $TAG to origin"
fi

echo ""
echo "Next: dispatch publish-desktop.yml with the signed build run of this commit."
