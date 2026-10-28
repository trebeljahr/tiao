# Steam achievement icon sources

Selected open-line artwork with Tiao's bronze, silver, gold and cyan palette. `masters/` holds the 30 selected PNG source crops. These are Steam artwork sources; the web app's SVG renderer is separate.

Run `node scripts/steam-achievement-icons.mjs` from the repository root to rebuild the upload assets. ImageMagick is required. The exporter validates all IDs and source checksums before rendering.

- `build/steam-achievement-icons/bulk/`: 60 files named `<API_NAME>_ACHIEVED.png` and `<API_NAME>_UNACHIEVED.png`, sized 256x256 for Steam's bulk editor.
- `256x256/` and `64x64/`: unlocked and grayscale locked PNG/JPG exports with the existing filename convention.
- `--source app --svg`: export the legacy in-game SVG artwork instead.

Steam's bulk editor accepts the achieved files and can generate grayscale unachieved icons automatically. When supplying both states, turn that option off so the explicit files are used.

`manifest.json` maps every source crop to its unchanged achievement ID/API name and records SHA-256 provenance. Original generated panels, exact prompts, rejected iterations, design comparisons and upload evidence are retained in the Tiao project vault under `assets/design-history/2026-10-29/achievement-line-set/`.
