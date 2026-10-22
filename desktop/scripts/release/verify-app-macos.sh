#!/usr/bin/env bash
# Shared signed-app gate for hosted builds and local SteamPipe staging.
set -euo pipefail
verify_app() {
  local app="$1"
  echo "Verifying $app"
  codesign --verify --deep --strict --verbose=2 "$app"
  codesign -dv --verbose=4 "$app" 2>&1 | grep -Fx 'TeamIdentifier=4BHY8H2J25'
  codesign -dv "$app" 2>&1 | grep -Eq 'flags=0x[0-9a-f]*\(runtime\)'
  spctl --assess --type execute --verbose=2 "$app" 2>&1 | grep -F 'source=Notarized Developer ID'
  xcrun stapler validate "$app"
  local archs
  local binary
  binary="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist")"
  archs="$(lipo -archs "$app/Contents/MacOS/$binary")"
  [[ "$archs" == *x86_64* && "$archs" == *arm64* ]] || { echo "Not universal: $archs" >&2; exit 1; }
}
[[ $# -eq 1 ]] || { echo "Usage: verify-app-macos.sh <app>" >&2; exit 1; }
verify_app "$1"
