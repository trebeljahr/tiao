#!/usr/bin/env bash
# Import the App Store distribution identity into a temporary keychain.
# Only the disposable hosted runner gets a temporary signing keychain.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" = true && "${RUNNER_ENVIRONMENT:-}" = github-hosted ]] || {
  echo 'CI signing setup requires a disposable GitHub-hosted runner.' >&2
  exit 1
}
cd "$(dirname "$0")/../.."
umask 077
keychain="$RUNNER_TEMP/tiao-signing.keychain-db"
profile="$HOME/Library/MobileDevice/Provisioning Profiles/tiao-release.mobileprovision"
if [[ "${1:-}" = cleanup ]]; then
  if [[ -f "$keychain" ]]; then security delete-keychain "$keychain"; fi
  rm -f "$RUNNER_TEMP/tiao-cert.p12" "$RUNNER_TEMP/tiao-profile.plist" \
    "$RUNNER_TEMP/ExportOptions.plist" "$profile"
  exit
fi
# Fails by name before any decode: an unset secret would decode to an empty file.
node scripts/release/plan.mjs credentials ios
printf '%s' "$APPLE_CERTIFICATE_BASE64" | base64 --decode > "$RUNNER_TEMP/tiao-cert.p12"
mkdir -p "$(dirname "$profile")"
printf '%s' "$APPLE_PROVISIONING_PROFILE_BASE64" | base64 --decode > "$profile"
security cms -D -i "$profile" > "$RUNNER_TEMP/tiao-profile.plist"
python3 scripts/release/ios-profile.py "$RUNNER_TEMP/tiao-profile.plist" "$RUNNER_TEMP/ExportOptions.plist"
keychain_password="$(openssl rand -hex 32)"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$RUNNER_TEMP/tiao-cert.p12" -k "$keychain" -P "$APPLE_CERTIFICATE_PASSWORD" \
  -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple: -s -k "$keychain_password" "$keychain" >/dev/null
security list-keychains -d user -s "$keychain" "$HOME/Library/Keychains/login.keychain-db"
security find-identity -v -p codesigning "$keychain" | grep -F 'Apple Distribution:'
# A profile can contain the wrong distribution certificate even on the same team.
python3 - "$RUNNER_TEMP/tiao-profile.plist" "$keychain" <<'PY'
import hashlib, plistlib, subprocess, sys
with open(sys.argv[1], "rb") as stream:
    profile = plistlib.load(stream)
identities = subprocess.check_output(["security", "find-identity", "-v", "-p", "codesigning", sys.argv[2]], text=True)
if not any(hashlib.sha1(cert).hexdigest().upper() in identities for cert in profile["DeveloperCertificates"]):
    raise SystemExit("The installed private key does not match the profile's distribution certificate.")
PY
rm -f "$RUNNER_TEMP/tiao-cert.p12"
