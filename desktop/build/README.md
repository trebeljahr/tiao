# desktop/build/

electron-builder's `buildResources` directory. Holds the per-platform icon
masters and the macOS entitlements file used during signing/notarization.
electron-builder picks these up automatically when packaging (mac → `icon.icns`,
win → `icon.ico`, linux → `icon.png`).

## Files

| File                      | Purpose                                                                 |
| ------------------------- | ----------------------------------------------------------------------- |
| `icon.png`                | 1024×1024 master, used by Linux AppImage and as the conversion source.  |
| `icon.icns`               | macOS app icon, multi-resolution container (16 → 1024 @ 1x/2x).         |
| `icon.ico`                | Windows app icon, multi-resolution container (16, 32, 48, 64, 128, 256).|
| `icon.iconset/`           | Intermediate folder used by `iconutil` to produce `icon.icns`.          |
| `entitlements.mac.plist`  | macOS hardened-runtime entitlements (JIT, library validation, network). |

## Regenerating the icons

The masters were rendered from `client/public/tiao-icon.svg` at 1024×1024.
If the brand mark changes, re-run from the monorepo root:

```bash
# 1. Render a 1024×1024 master from the SVG.
rsvg-convert -w 1024 -h 1024 client/public/tiao-icon.svg -o /tmp/icon-1024.png

# 2. Build the macOS .iconset and convert it to .icns.
SRC=/tmp/icon-1024.png
DST=desktop/build
ICONSET="$DST/icon.iconset"
mkdir -p "$ICONSET"
sips -z 16 16   "$SRC" --out "$ICONSET/icon_16x16.png"
sips -z 32 32   "$SRC" --out "$ICONSET/icon_16x16@2x.png"
sips -z 32 32   "$SRC" --out "$ICONSET/icon_32x32.png"
sips -z 64 64   "$SRC" --out "$ICONSET/icon_32x32@2x.png"
sips -z 128 128 "$SRC" --out "$ICONSET/icon_128x128.png"
sips -z 256 256 "$SRC" --out "$ICONSET/icon_128x128@2x.png"
sips -z 256 256 "$SRC" --out "$ICONSET/icon_256x256.png"
sips -z 512 512 "$SRC" --out "$ICONSET/icon_256x256@2x.png"
sips -z 512 512 "$SRC" --out "$ICONSET/icon_512x512.png"
cp "$SRC" "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o "$DST/icon.icns"

# 3. Build the Windows .ico (needs ImageMagick).
TMP=$(mktemp -d)
for SIZE in 16 32 48 64 128 256; do
  sips -z $SIZE $SIZE "$SRC" --out "$TMP/icon_${SIZE}.png"
done
magick "$TMP/icon_16.png" "$TMP/icon_32.png" "$TMP/icon_48.png" \
       "$TMP/icon_64.png" "$TMP/icon_128.png" "$TMP/icon_256.png" \
       "$DST/icon.ico"

# 4. Update the 1024 master used by Linux.
cp "$SRC" "$DST/icon.png"
```

> Never upscale 512 → 1024 to "make a master" — re-render from the SVG instead.
> The 512×512 PNGs under `client/public/` and `docs-site/static/img/` are
> already downscales of the same SVG; upscaling them again degrades quality.

## Entitlements

`entitlements.mac.plist` enables the hardened-runtime relaxations Electron
needs (V8 JIT, unsigned executable memory) plus the
`disable-library-validation` flag that lets `steamworks.js` load its
unsigned native dylibs. Network client/server entitlements are required
because the renderer makes HTTPS requests to `api.playtiao.com` and the
auth bridge listens on a loopback port during the OAuth handshake.

Apple's notary service will reject builds whose entitlements don't cover
the actual runtime behavior — keep this file in sync if a new native
dependency is added.
