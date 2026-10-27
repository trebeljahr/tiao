#!/usr/bin/env bash
# Keep this Mac's selected Xcode; only hosted images use the pinned app path.
set -euo pipefail
if [[ "${RUNNER_ENVIRONMENT:-}" = github-hosted ]]; then
  developer_dir=/Applications/Xcode_26.3.app/Contents/Developer
else
  developer_dir=$(xcode-select -p)
fi
[[ -d "$developer_dir" ]] || { echo "Xcode developer directory missing: $developer_dir" >&2; exit 1; }
printf 'DEVELOPER_DIR=%s\n' "$developer_dir" >> "${GITHUB_ENV:?Run inside GitHub Actions.}"
DEVELOPER_DIR="$developer_dir" xcodebuild -version
