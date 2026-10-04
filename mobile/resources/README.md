# mobile/resources/

Source masters for `@capacitor/assets` (`pnpm run mobile:assets`), which
writes every Android density, the adaptive icon and the iOS asset catalog
into the native projects.

| File | Size | Content |
| --- | --- | --- |
| `icon-only.png` | 1024×1024, opaque | Store icon: the Tiao icon flattened onto its frame colour `#1C1510`. The stores apply their own corner mask. |
| `icon-foreground.png` | 1024×1024, transparent | Android adaptive foreground. The tool insets it by 16.7% per side; the art has an extra margin so circular masks do not clip the board. |
| `icon-background.png` | 1024×1024 | Android adaptive background, solid `#1C1510`. |
| `splash.png`, `splash-dark.png` | 2732×2732, opaque | 640 px icon centred on the app background `#2a1d13`. |

All five are generated from the 1024 px desktop master
`../desktop/build/icon.png` (rendered from `client/public/tiao-icon.svg`):

```bash
pnpm run mobile:resources   # needs ImageMagick 7
pnpm run mobile:assets
```

Commit the masters and the generated native files together.
