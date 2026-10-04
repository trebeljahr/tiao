#!/usr/bin/env bash
# Verifies every Developer ID deliverable of the macOS leg: the app inside the
# direct DMG and ZIP, the itch ZIP, and the unpacked apps (Steam depot source).
# A green packaging step proves nothing: codesign --verify alone accepts ad-hoc.
set -euo pipefail
dist_dir="${DIST_DIR:-dist}"
scratch="$(mktemp -d)"
mounted=""
cleanup() {
  if [[ -n "$mounted" ]]; then hdiutil detach "$mounted" -quiet || true; fi
  rm -rf "$scratch"
}
trap cleanup EXIT
verify_app() {
  local app="$1"
  echo "Verifying $app"
  codesign --verify --deep --strict --verbose=2 "$app"
  codesign -dv --verbose=4 "$app" 2>&1 | grep -Fx 'TeamIdentifier=4BHY8H2J25'
  codesign -dv "$app" 2>&1 | grep -Eq 'flags=0x[0-9a-f]*\(runtime\)'
  spctl --assess --type execute --verbose=2 "$app" 2>&1 | grep -F 'source=Notarized Developer ID'
  xcrun stapler validate "$app"
  local archs
  archs="$(lipo -archs "$app/Contents/MacOS/Tiao")"
  [[ "$archs" == *x86_64* && "$archs" == *arm64* ]] || { echo "Not universal: $archs" >&2; exit 1; }
}
expect_one() {
  local label="$1"; shift
  [[ $# -eq 1 && -e "$1" ]] || { echo "Expected exactly one $label." >&2; exit 1; }
}
shopt -s nullglob

dmgs=("$dist_dir"/direct/*.dmg)
expect_one 'direct DMG' "${dmgs[@]}"
mounted="$scratch/mount"
mkdir -p "$mounted"
hdiutil attach "${dmgs[0]}" -nobrowse -readonly -quiet -mountpoint "$mounted"
apps=("$mounted"/*.app)
expect_one 'app in the DMG' "${apps[@]}"
verify_app "${apps[0]}"
hdiutil detach "$mounted" -quiet
mounted=""

for zip in "$dist_dir"/direct/*.zip "$dist_dir"/itch/*.zip; do
  unpacked="$(mktemp -d "$scratch/zip.XXXXXX")"
  ditto -x -k "$zip" "$unpacked"
  apps=("$unpacked"/*.app)
  expect_one "app in $zip" "${apps[@]}"
  verify_app "${apps[0]}"
done
zips=("$dist_dir"/direct/*.zip "$dist_dir"/itch/*.zip)
[[ ${#zips[@]} -eq 2 ]] || { echo 'Expected one direct ZIP and one itch ZIP.' >&2; exit 1; }

for channel in direct itch steam; do
  verify_app "$dist_dir/$channel/mac-universal/Tiao.app"
done
