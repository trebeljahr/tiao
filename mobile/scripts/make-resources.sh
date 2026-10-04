#!/usr/bin/env bash
# Rebuild the @capacitor/assets source masters in mobile/resources/ from the
# 1024 px desktop icon. Requires ImageMagick 7 (`brew install imagemagick`).
# Then run `pnpm run mobile:assets` to expand them into the native projects.
set -euo pipefail
cd "$(dirname "$0")/.."
src=../desktop/build/icon.png
out=resources
frame='#1C1510' # outer frame colour of the Tiao icon
brand='#2a1d13' # app background colour (capacitor.config.ts)

# Opaque, full-bleed store icon: the stores apply their own corner mask.
magick "$src" -background "$frame" -alpha remove -alpha off -strip "PNG24:$out/icon-only.png"
# Android adaptive icon over a solid frame colour. @capacitor/assets insets
# the foreground by 16.7% per side; the extra 10% margin keeps the board's
# corners inside a circular launcher mask.
magick -size 1024x1024 xc:none \( "$src" -resize 820x820 \) -gravity center -composite \
  -strip "PNG32:$out/icon-foreground.png"
magick -size 1024x1024 "xc:$frame" -strip "PNG24:$out/icon-background.png"
# Splash: icon well inside the central area so no aspect-ratio crop clips it.
magick -size 2732x2732 "xc:$brand" \( "$src" -resize 640x640 \) -gravity center -composite \
  -alpha off -strip "PNG24:$out/splash.png"
cp "$out/splash.png" "$out/splash-dark.png"
