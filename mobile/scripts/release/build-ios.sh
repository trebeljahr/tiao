#!/usr/bin/env bash
# Archive, export and verify a signed App Store IPA. Needs ios-signing.sh first.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${RELEASE_BUILD_NUMBER:?Set a build number above existing TestFlight builds.}"
: "${APPLE_PROVISIONING_PROFILE_NAME:?Install an App Store profile and set its name.}"
: "${IOS_EXPORT_OPTIONS:?Set the path to the rendered export options plist.}"
unset CAP_DEV_URL
pnpm run mobile:version
pnpm run build:client
pnpm exec cap sync ios
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' \
  -archivePath "$PWD/ios/App/build/App.xcarchive" \
  DEVELOPMENT_TEAM=4BHY8H2J25 CODE_SIGN_STYLE=Manual \
  PROVISIONING_PROFILE_SPECIFIER="$APPLE_PROVISIONING_PROFILE_NAME" \
  CODE_SIGN_IDENTITY="Apple Distribution" archive
xcodebuild -exportArchive -archivePath "$PWD/ios/App/build/App.xcarchive" \
  -exportPath "$PWD/ios/App/build/ipa" -exportOptionsPlist "$IOS_EXPORT_OPTIONS"
bash scripts/release/verify-ios.sh
