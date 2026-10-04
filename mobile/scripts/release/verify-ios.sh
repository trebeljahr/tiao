#!/usr/bin/env bash
# Prove the exported IPA is the App Store build we meant to ship.
set -euo pipefail
cd "$(dirname "$0")/../.."
shopt -s nullglob
ipas=(ios/App/build/ipa/*.ipa)
[[ ${#ipas[@]} -eq 1 ]] || { echo 'Expected exactly one IPA.' >&2; exit 1; }
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
ditto -x -k "${ipas[0]}" "$scratch"
apps=("$scratch"/Payload/*.app)
[[ ${#apps[@]} -eq 1 ]] || { echo 'Expected exactly one exported app.' >&2; exit 1; }
app="${apps[0]}"
codesign --verify --deep --strict "$app"
codesign -dv --verbose=4 "$app" 2>&1 | grep -Fx 'TeamIdentifier=4BHY8H2J25'
codesign -dv --verbose=4 "$app" 2>&1 | grep -F 'Authority=Apple Distribution:'
plist() { plutil -extract "$1" raw -o - "$app/Info.plist"; }
[[ "$(plist CFBundleIdentifier)" = com.ricoslabs.tiao ]]
[[ "$(plist CFBundleDisplayName)" = Tiao ]]
[[ "$(plist CFBundleVersion)" = "$RELEASE_BUILD_NUMBER" ]]
[[ "$(plist CFBundleShortVersionString)" = "$(node -p "require('./package.json').version")" ]]
[[ "$(plist ITSAppUsesNonExemptEncryption)" = false ]]
[[ "$(plist CFBundleURLTypes.0.CFBundleURLSchemes.0)" = tiao ]]
plutil -lint "$app/PrivacyInfo.xcprivacy"
[[ -f "$app/public/index.html" ]] || { echo 'Bundled web app is missing.' >&2; exit 1; }
security cms -D -i "$app/embedded.mobileprovision" > "$scratch/profile.plist"
python3 scripts/release/ios-profile.py "$scratch/profile.plist"
