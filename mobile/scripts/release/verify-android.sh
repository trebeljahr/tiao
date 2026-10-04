#!/usr/bin/env bash
set -euo pipefail
aab="android/app/build/outputs/bundle/release/app-release.aab"
apk="android/app/build/outputs/apk/release/app-release.apk"
# jarsigner can exit zero for an unsigned archive. Require its positive result.
result="$(jarsigner -J-Duser.language=en -verify "$aab")"
grep -Fq 'jar verified.' <<< "$result" || { echo 'AAB signature verification failed.' >&2; exit 1; }
if grep -Fq 'unsigned entries' <<< "$result"; then
  echo 'AAB contains entries not covered by its signature.' >&2
  exit 1
fi
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
: "${sdk:?Android SDK path is required}"
apksigner="$(node --input-type=module - "$sdk" <<'JS'
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
const root = join(process.argv[2], 'build-tools');
const versions = readdirSync(root).filter((v) => /^\d+\.\d+\.\d+$/.test(v))
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
if (!versions.length) throw new Error('Install Android SDK build-tools.');
console.log(join(root, versions.at(-1), 'apksigner'));
JS
)"
[[ -x "$apksigner" ]] || { echo 'Android apksigner is unavailable.' >&2; exit 1; }
"$apksigner" verify --verbose --print-certs "$apk"
# Prove APK and AAB were signed by the configured upload key, not a debug key.
if [[ -n "${ANDROID_KEYSTORE_PATH:-}" ]]; then
  expected="$(keytool -J-Duser.language=en -list -v -keystore "$ANDROID_KEYSTORE_PATH" -alias "$ANDROID_KEY_ALIAS" -storepass:env ANDROID_KEYSTORE_PASSWORD | sed -n 's/.*SHA256: //p' | tr -d ':' | tr '[:upper:]' '[:lower:]')"
  # SDK versions label certificate lines either "Signer #1" or "V2 Signer:".
  # Require every reported signer digest to match the configured upload key.
  actual="$("$apksigner" verify --print-certs "$apk" | sed -nE 's/^.*certificate SHA-256 digest: ([[:xdigit:]]{64})$/\1/p' | tr '[:upper:]' '[:lower:]' | sort -u)"
  aab_cert="$(keytool -J-Duser.language=en -printcert -jarfile "$aab" | sed -n 's/.*SHA256: //p' | tr -d ':' | tr '[:upper:]' '[:lower:]')"
  [[ -n "$expected" && "$actual" = "$expected" && "$aab_cert" = "$expected" ]] || { echo 'Android signer differs from upload key.' >&2; exit 1; }
fi
