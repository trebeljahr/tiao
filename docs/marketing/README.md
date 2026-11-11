# Tiao marketing assets

Real screenshots of the shipped game and the GitHub social preview cards, with
the scripts that regenerate them. `manifest.json` lists every file with its
purpose, pixel size, bytes, SHA-256, source and date.

No mock UI and no generated imagery. Boards come from complete self-play games
of the shipped AI, replayed through the real game UI. Names, avatars and
tournament data are sample data served inside the browser; no production
account appears.

## Screenshots (`screenshots/`)

| File | Pixels | Shows | Used in |
| --- | --- | --- | --- |
| `desktop-capture-chain.jpg` | 2880×1800 | A white stone's four-jump chain on a 13×13 board, before the capture is confirmed | README hero, social preview A and B |
| `desktop-tutorial-chain.jpg` | 2880×1800 | The tutorial's chain-jump lesson | README rules section |
| `desktop-game-review.jpg` | 2880×1800 | A finished online game in review, with replay controls and move history | README rules section, social preview C |
| `desktop-computer-setup.jpg` | 2880×1800 | The computer game setup: difficulty, colour, board size, captures to win | Press and posts |
| `mobile-capture-chain.jpg` | 1320×2868 | The capture chain on a phone | README apps section, social preview C |
| `mobile-game-review.jpg` | 1320×2868 | The game review on a phone | Press and posts |

Desktop shots are 1440×900 CSS pixels at 2×, the Mac App Store size. Phone
shots are 440×956 CSS pixels at 3×, the 6.9" iPhone size. Both are JPEG q84.
All six were captured on 2026-11-06.

Regenerate:

```sh
pnpm --dir client install            # once; the capture runs the Next.js dev client
pnpm marketing:screenshots           # starts a client on a free high port, captures, exports
pnpm marketing:screenshots --export-only   # re-export the last captures only
```

`scripts/marketing/capture-screenshots.mjs` runs the store pipeline
(`scripts/app-store-screenshots.mjs --only=mac,iphone-69`) and re-encodes the
picks listed at the top of the script. Raw captures stay in the ignored
`output/playwright/store-*/<size>/` folders. Set `CHROMIUM_PATH` to reuse a
cached Chromium when Playwright's own build is missing.

## Social preview (`social-preview/`)

| File | Pixels | Composition |
| --- | --- | --- |
| `social-preview-a.png` | 1280×640 | Screenshot-led: icon and wordmark, headline, board crop of the capture chain on cream |
| `social-preview-b.png` | 1280×640 | Brand-led: large icon and wordmark, the rules in one line, tilted board crop fading in |
| `social-preview-c.png` | 1280×640 | Dark: brand on the night palette, a desktop game review and the phone capture chain |

All three come from `social-preview/template.html` (`?variant=a|b|c`). It uses
the website's fonts (`client/app/fonts/`, Zen Old Mincho and Zen Kaku Gothic
New) and the approved icon and wordmark (`scripts/assets/`). Key content stays
inside a 64 px margin, and each PNG is under 1 MB, as GitHub requires. All
three were rendered on 2026-11-06.

```sh
pnpm marketing:social                       # renders a, b and c
pnpm marketing:social --review-dir <folder> # also writes copies and a labelled review-sheet.jpg
```

Upload the chosen card in the repository's Settings → Social preview.

## og:image cards (`social-preview/`)

| File | Pixels | Composition |
| --- | --- | --- |
| `og-wordmark.png` | 1200×630 | Variant B laid out at 1.91:1: only the icon and wordmark, centred on the left, over the tilted board crop. No headline, rules line or URL |
| `og-clean.png` | 1200×630 | No text: the whole tilted board of variant B, centred on cream |

The Open Graph size. The same script renders them from `template.html?variant=b`
laid out at 1280×672 (the same shape as 1200×630), shot at 2× and scaled to
exactly 1200×630 with ImageMagick, which must be installed (`magick`).
`manifest.json` lists them under `ogImage`.

```sh
pnpm marketing:social --og   # only the two og:image cards
```

## Other Tiao media in this repository

Reuse these before making new ones.

| Where | What |
| --- | --- |
| [`output/playwright/store-overview/steam-1080p/`](../../output/playwright/store-overview/steam-1080p/) | Ten 1920×1080 PNG screenshots for Steam and press, with `selection.json` provenance. `pnpm store:screenshots http://127.0.0.1:<port> --only=steam-1080p` |
| [`scripts/assets/store-art/`](../../scripts/assets/store-art/) | Approved store artwork (Steam capsules, Play feature graphic, App Store header) as SVG masters. `pnpm store:art` renders PNGs into `build/store-media/` |
| [`scripts/assets/tiao-icon.svg`](../../scripts/assets/tiao-icon.svg), [`tiao-wordmark.svg`](../../scripts/assets/tiao-wordmark.svg) | App icon and the wordmark outlined from Zen Old Mincho |
| [`scripts/assets/store-trailer/`](../../scripts/assets/store-trailer/) | Trailer edit decisions, match logs and audio with [credits](../../scripts/assets/store-trailer/audio/credits.json). `pnpm store:trailer` |
| [`docs/images/board.png`](../images/board.png) | 1600×1000 live multiplayer board, made by `scripts/board-screenshot.mjs` (needs MongoDB) |
| [`docs-site/static/img/social-card.png`](../../docs-site/static/img/social-card.png) | 1200×630 card for the Docusaurus site |
| `client/app/opengraph-image.tsx` | The website's own Open Graph image, generated by Next.js |
