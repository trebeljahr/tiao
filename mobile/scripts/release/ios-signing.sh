#!/usr/bin/env bash
# Import the App Store distribution identity into a temporary keychain.
# Both runner types use a job-owned keychain and a uniquely named profile.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" = true && ( "${RUNNER_ENVIRONMENT:-}" = github-hosted || "${RUNNER_ENVIRONMENT:-}" = self-hosted ) ]] || {
  echo 'CI signing setup requires a GitHub Actions runner.' >&2
  exit 1
}
cd "$(dirname "$0")/../.."
umask 077
node --input-type=module -e "import { requireMain } from './scripts/release/lib.mjs'; requireMain(process.env)"
state="${RUNNER_TEMP:?Set RUNNER_TEMP}/tiao-ios-signing"
keychain="$state/signing.keychain-db"
cleanup() {
  if [[ -f "$keychain" ]]; then
    python3 scripts/release/ios-keychains.py remove "$keychain"
    security delete-keychain "$keychain"
  fi
  if [[ -f "$state/profile-path" ]]; then
    IFS= read -r profile < "$state/profile-path"
    rm -f "$profile"
  fi
  rm -rf "$state"
}
if [[ "${1:-}" = cleanup ]]; then
  cleanup
  exit
fi
# Fails by name before any decode: an unset secret would decode to an empty file.
node scripts/release/plan.mjs credentials ios
mkdir "$state"
cleanup_on_failure() {
  local result=$?
  if [[ "$result" != 0 ]]; then cleanup; fi
}
trap cleanup_on_failure EXIT
printf '%s' "$APPLE_CERTIFICATE_BASE64" | base64 --decode > "$state/cert.p12"
printf '%s' "$APPLE_PROVISIONING_PROFILE_BASE64" | base64 --decode > "$state/profile.mobileprovision"
security cms -D -i "$state/profile.mobileprovision" > "$state/profile.plist"
python3 scripts/release/ios-profile.py "$state/profile.plist" "$state/ExportOptions.plist"
profile_dir="$HOME/Library/MobileDevice/Provisioning Profiles"
mkdir -p "$profile_dir"
profile=$(python3 - "$profile_dir" <<'PY'
import os, sys, tempfile
fd, path = tempfile.mkstemp(prefix="tiao-ci-", suffix=".mobileprovision", dir=sys.argv[1])
os.close(fd)
print(path)
PY
)
printf '%s\n' "$profile" > "$state/profile-path"
cat "$state/profile.mobileprovision" > "$profile"
keychain_password="$(openssl rand -hex 32)"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$state/cert.p12" -k "$keychain" -P "$APPLE_CERTIFICATE_PASSWORD" \
  -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple: -s -k "$keychain_password" "$keychain" >/dev/null
python3 scripts/release/ios-keychains.py add "$keychain"
security find-identity -v -p codesigning "$keychain" | grep -F 'Apple Distribution:'
# A profile can contain the wrong distribution certificate even on the same team.
python3 - "$state/profile.plist" "$keychain" <<'PY'
import hashlib, plistlib, subprocess, sys
with open(sys.argv[1], "rb") as stream:
    profile = plistlib.load(stream)
identities = subprocess.check_output(["security", "find-identity", "-v", "-p", "codesigning", sys.argv[2]], text=True)
if not any(hashlib.sha1(cert).hexdigest().upper() in identities for cert in profile["DeveloperCertificates"]):
    raise SystemExit("The installed private key does not match the profile's distribution certificate.")
PY
rm -f "$state/cert.p12"
