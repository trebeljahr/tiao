#!/usr/bin/env bash
# Rebuild desktop/build/Assets.car, the compiled macOS app-icon catalog.
#
# macOS 26 draws an app icon from Assets.car (CFBundleIconName "Icon"); without
# one it shrinks icon.icns into a grey placeholder squircle. The catalog is
# compiled here once and committed, so CI runners need no Xcode 26: the
# electron-builder config copies it into Contents/Resources and sets
# CFBundleIconName (package.json build.mac). icon.icns stays for macOS 11-15.
#
# Source: the full-bleed, opaque iOS store icon, so iOS and macOS match.
# Requires Xcode 26 or later (actool with Icon Composer support).
set -euo pipefail
cd "$(dirname "$0")/.."
src=../mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
work=$(mktemp -d "${TMPDIR:-/tmp}/tiao-actool.XXXXXX")

mkdir -p "$work/Icon.icon/Assets" "$work/out"
cp "$src" "$work/Icon.icon/Assets/icon.png"
cat > "$work/Icon.icon/icon.json" <<'JSON'
{
  "groups": [{ "layers": [{ "image-name": "icon.png", "name": "icon" }] }],
  "supported-platforms": { "squares": ["macOS"] }
}
JSON

xcrun actool "$work/Icon.icon" --compile "$work/out" \
  --output-format human-readable-text --notices --warnings \
  --output-partial-info-plist "$work/out/partial.plist" \
  --app-icon Icon --include-all-app-icons \
  --enable-on-demand-resources NO --development-region en \
  --target-device mac --minimum-deployment-target 11.0 --platform macosx

cp "$work/out/Assets.car" build/Assets.car
plutil -p "$work/out/partial.plist"
echo "Wrote build/Assets.car ($(wc -c < build/Assets.car | tr -d ' ') bytes); scratch: $work"
