# Achievement icon sources

Selected open-line artwork with Tiao's bronze, silver, gold and cyan palette. `masters/` holds the 30 selected PNG source crops. These masters supply both Steam and the in-game achievement UI.

Run `node scripts/export-achievement-artwork.mjs` to rebuild the checked-in 128px WebP runtime assets and ID mapping. The mapping uses content-hashed filenames so artwork updates invalidate cached icons. Locked states use grayscale; unrevealed secrets keep their lock placeholder.

Run `node scripts/steam-achievement-icons.mjs` from the repository root to rebuild the upload assets. ImageMagick is required. The exporter validates all IDs and source checksums before rendering.

- `build/steam-achievement-icons/bulk/`: 60 files named `<API_NAME>_ACHIEVED.png` and `<API_NAME>_UNACHIEVED.png`, sized 256x256 for Steam's bulk editor.
- `256x256/` and `64x64/`: unlocked and grayscale locked PNG/JPG exports with the existing filename convention.
- `--source app --svg`: export the legacy in-game SVG artwork instead.

Steam's bulk editor accepts the achieved files and can generate grayscale unachieved icons automatically. When supplying both states, turn that option off so the explicit files are used.

For the established achievement-row editor, upload the 256x256 JPG pair. Save the existing row, reopen Edit, upload each state separately, wait for its success response, then Save. Verify the resulting CDN filenames against each local JPG's SHA-1 before publishing. Both states use the same square white matte; Steam supplies its own frame. Do not round the artwork's tile corners or invert the locked background.

Keep every drawing within its tier's color family. The robot and owl use slate accents; butterfly and rocket use gold accents. Check the actual 64px JPG exports in color and grayscale against white, black and gray surroundings.

`manifest.json` maps every source crop to its unchanged achievement ID/API name and records SHA-256 provenance. Original generated panels, exact prompts, rejected iterations, design comparisons and upload evidence are retained in the Tiao project vault under `assets/design-history/2026-10-29/achievement-line-set/`.
