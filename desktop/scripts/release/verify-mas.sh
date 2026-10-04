#!/usr/bin/env bash
# Verifies the signed Mac App Store build: Apple Distribution signature with the
# sandbox, the team app group, the embedded store profile, no Steam library, and
# a pkg signed by the Mac Installer Distribution identity.
set -euo pipefail
dir="${DIST_DIR:-dist}/mas/mas-universal"
app="$dir/Tiao.app"
[[ -d "$app" ]] || { echo "Missing $app" >&2; exit 1; }
codesign --verify --deep --strict --verbose=2 "$app"
details="$(codesign -dv --verbose=4 "$app" 2>&1)"
grep -Fx 'TeamIdentifier=4BHY8H2J25' <<< "$details"
grep -Eq '^Authority=(Apple Distribution|3rd Party Mac Developer Application): Ricos Labs LLC \(4BHY8H2J25\)$' <<< "$details" ||
  { echo 'The MAS app is not signed with Apple Distribution.' >&2; exit 1; }
entitlements="$(codesign -d --entitlements - --xml "$app" 2>/dev/null)"
for key in com.apple.security.app-sandbox com.apple.security.network.client 4BHY8H2J25.com.ricoslabs.tiao com.apple.application-identifier; do
  grep -Fq "$key" <<< "$entitlements" || { echo "Missing entitlement: $key" >&2; exit 1; }
done
if grep -Fq 'com.apple.security.cs.disable-library-validation' <<< "$entitlements"; then
  echo 'The MAS app carries Developer ID entitlements.' >&2; exit 1
fi
test -f "$app/Contents/embedded.provisionprofile"
if find "$app" -iname '*steam*' | grep -q .; then
  echo 'The MAS app contains Steam files.' >&2; exit 1
fi
archs="$(lipo -archs "$app/Contents/MacOS/Tiao")"
[[ "$archs" == *x86_64* && "$archs" == *arm64* ]] || { echo "Not universal: $archs" >&2; exit 1; }
shopt -s nullglob
pkgs=("$dir"/*.pkg)
[[ ${#pkgs[@]} -eq 1 ]] || { echo 'Expected exactly one MAS pkg.' >&2; exit 1; }
signature="$(pkgutil --check-signature "${pkgs[0]}")"
echo "$signature"
grep -Eq '(3rd Party Mac Developer Installer|Mac Installer Distribution): Ricos Labs LLC \(4BHY8H2J25\)' <<< "$signature" ||
  { echo 'The pkg is not signed with the Mac Installer Distribution identity.' >&2; exit 1; }
