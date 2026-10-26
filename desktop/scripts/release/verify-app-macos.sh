#!/usr/bin/env bash
# Shared signed-app gate for hosted builds and local SteamPipe staging.
set -euo pipefail
validate_staple() {
  local app="$1" attempt=1 output status
  while true; do
    if output="$(xcrun stapler validate "$app" 2>&1)"; then
      printf '%s\n' "$output"
      return 0
    else
      status=$?
    fi
    printf '%s\n' "$output" >&2
    # Ticket validation contacts Apple even for an already stapled app.
    # Retry transport failures only; invalid tickets fail immediately.
    if [[ "$attempt" -ge 3 ]] || ! grep -Eq 'NSURLErrorDomain Code=-(1001|1004|1005|1009)|network connection was lost|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN' <<< "$output"; then
      return "$status"
    fi
    attempt=$((attempt + 1))
    echo "Temporary Apple ticket lookup failure; retry $attempt/3 in 20 seconds." >&2
    sleep 20
  done
}
verify_app() {
  local app="$1"
  echo "Verifying $app"
  codesign --verify --deep --strict --verbose=2 "$app"
  local signature
  local assessment
  # Capture complete reports before grep: a quiet match can otherwise close
  # the pipe early and turn a valid codesign result into SIGPIPE under pipefail.
  signature="$(codesign -dv --verbose=4 "$app" 2>&1)"
  grep -Fx 'TeamIdentifier=4BHY8H2J25' <<< "$signature"
  grep -Eq 'flags=0x[0-9a-f]*\(runtime\)' <<< "$signature"
  assessment="$(spctl --assess --type execute --verbose=2 "$app" 2>&1)"
  grep -F 'source=Notarized Developer ID' <<< "$assessment"
  validate_staple "$app"
  local archs
  local binary
  binary="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist")"
  archs="$(lipo -archs "$app/Contents/MacOS/$binary")"
  [[ "$archs" == *x86_64* && "$archs" == *arm64* ]] || { echo "Not universal: $archs" >&2; exit 1; }
  # The Steam channels use a dedicated entitlement set. Verify the actual
  # signed artifact and unpacked native surface, rather than just its config.
  local steam
  steam="$(node --input-type=module - "$app/Contents/Resources/app.asar" "$(dirname "$0")/lib.mjs" <<'JS'
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { readAsarFile } = await import(pathToFileURL(resolve(process.argv[3])));
const meta = JSON.parse(readAsarFile(process.argv[2], 'package.json'));
console.log(meta.steamBuild === true);
JS
)"
  if [[ "$steam" == true ]]; then
    local entitlements
    entitlements="$(codesign -d --entitlements - --xml "$app" 2>/dev/null)"
    for key in allow-dyld-environment-variables disable-library-validation; do
      [[ "$(plutil -extract "com\\.apple\\.security\\.cs\\.$key" raw -o - - <<< "$entitlements")" == true ]] || {
        echo "Missing Steam entitlement: $key" >&2; exit 1;
      }
    done
    local presenter="$app/Contents/Resources/app.asar.unpacked/src/steamOverlayMac.node"
    [[ -f "$presenter" ]] || { echo 'Missing Steam Metal presenter.' >&2; exit 1; }
    lipo "$presenter" -verify_arch arm64 x86_64
    codesign --verify --strict "$presenter"
  fi
}
[[ $# -eq 1 ]] || { echo "Usage: verify-app-macos.sh <app>" >&2; exit 1; }
verify_app "$1"
