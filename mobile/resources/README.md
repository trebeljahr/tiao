# mobile/resources/

Source masters consumed by `@capacitor/assets` (`pnpm run mobile:assets`).
The generator reads these two files and emits the full icon + splash
matrix for both Android and iOS (drawables, `xcassets`, adaptive icons,
launch storyboards, etc.) into the native projects.

## Required files

Drop both of these here before running `pnpm run mobile:assets`:

| File | Required dimensions | Notes |
| --- | --- | --- |
| `icon.png` | **1024×1024**, square, opaque | Used as the App Store / Play Store icon master. Must be PNG (RGBA OK, but stores reject transparent app icons — keep it opaque). |
| `splash.png` | **2732×2732**, square, opaque | Centered logo on a `#2a1d13` background. Capacitor crops this giant square to every device aspect ratio, so keep the visible logo well inside the central ~1200px so it never gets clipped on tall phones / wide tablets. |

## Why these exact sizes

- **1024×1024 icon** matches the App Store Connect upload requirement.
  Capacitor downsamples to every Android `mipmap-*` density and every
  iOS `AppIcon.appiconset` slot from this single master.
- **2732×2732 splash** matches the largest iPad Pro portrait resolution,
  which is the upper bound `@capacitor/assets` needs to scale down from
  without ever upscaling (upscaling produces visible jaggies).

## Existing Tiao art assets

The largest square Tiao icon in the repo today is **512×512**
(`client/public/tiao-icon.png`, `desktop/assets/icon.png`). That's too
small — store submissions need 1024 minimum and upscaling makes the
gradients ugly.

Re-export from the SVG masters at 1024+:

- `client/public/tiao-icon.svg`
- `docs-site/static/img/tiao-icon.svg`

Suggested commands (requires `librsvg` via Homebrew: `brew install librsvg`):

```bash
rsvg-convert -w 1024 -h 1024 \
  ../client/public/tiao-icon.svg \
  -o resources/icon.png

# Splash: render the SVG centered on a #2a1d13 canvas at 2732×2732.
# Easiest path is to open the SVG in any vector editor (Figma, Affinity,
# Inkscape), place it on a 2732×2732 #2a1d13 background, scale the icon
# to ~30% of the canvas, and export as PNG.
```

## After dropping the files

```bash
pnpm run mobile:assets
```

Generated drawables / appiconsets land inside `android/` and `ios/` and
get committed alongside the rest of those trees. The two source files
in this directory (`icon.png`, `splash.png`) should also be committed —
they're the canonical regeneration input.
