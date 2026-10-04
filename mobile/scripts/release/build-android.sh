#!/usr/bin/env bash
# Build, sign and verify the Play bundle (AAB) and a sideload APK.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=SCRIPTDIR/../android-env.sh
source scripts/android-env.sh
: "${RELEASE_BUILD_NUMBER:?Set a build number above the highest version code already uploaded to Play.}"
unset CAP_DEV_URL
pnpm run mobile:version
pnpm run build:client
pnpm exec cap sync android
(
  cd android
  ./gradlew --no-daemon --max-workers=2 bundleRelease assembleRelease
)
bash scripts/release/verify-android.sh
