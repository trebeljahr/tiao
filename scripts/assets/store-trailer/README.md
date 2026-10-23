# Trailer build recipe

The current local selection and its checksum are recorded in `scripts/store-trailer-current.json`. The Steam upload state belongs to that exact export. A local selection does not change the uploaded trailer.

`pnpm store:trailer` renders the 50.3-second rules / friends / tournament edit from `build/store-trailer-v2/raw/`. The result is `build/store-trailer-v2/tiao-rules-and-friends.mp4`. The selected copy has a stable local path at `build/store-trailer/tiao-gameplay-current.mp4`.

## Inputs

- `edit.json`: 18 shots, source in/out points, crop windows, captions and sound cues.
- `raw/`: original 1920×1080 UI recordings and stills from the project vault archive named in the current-selection JSON.
- `scripts/assets/tiao-icon.svg` and `tiao-wordmark.svg`: existing outlined brand assets.
- `client/public/move.mp3`: the existing game sound. Other sound cues are quiet sine accents produced by the editor.

Requires Node 24+, FFmpeg and Sharp. Set `SHARP_MODULE` to an absolute installed Sharp module path if it is supplied by a separate runtime. Render one job at a time; the script limits Sharp and FFmpeg threads. Captions remain sufficient with sound off.

To rebuild from the archive without copying raw recordings back into the checkout:

```sh
SHARP_MODULE=/absolute/path/to/sharp node scripts/store-trailer.mjs /absolute/path/to/trailer-bundle
```

The editor creates `graphics/`, `cut/`, audio and a candidate MP4 in the supplied folder. It does not select or upload that candidate. Preserve the prior selected export and verify checksums before replacing it.

## Capture

`store-trailer-preview.mjs /absolute/path/to/client/out` serves an existing web export on a random local port. It does not run a backend.

Open an isolated Playwright CLI session named `tiao-trailer`. Set `PLAYWRIGHT_CLI` to its installed JavaScript entry point. Run `store-trailer-capture.mjs <phase> <local-url> [capture-root]` with phases, in order: `setup`, `rules`, `prepare-chain`, `chain`, `prepare-win`, `win`, `friends`, `tournament`, `winner`, `badges`, `achievements`. Close the browser and preview server after capture.

Gameplay is clicked through the real local game UI. Every move in the recorded match is independently replayed through the shared engine. Social, tournament and account screens use existing sample players and isolated API responses. Non-local browser requests are blocked. No real friend invitations, tournament results or account changes are made.

`store-trailer-replay.mjs` preserves the old 30-second replay encoder. Its default output folder is separate from the current selection. `previous-current.json` records that earlier export and its saved Steam upload.

The project vault preserves the raw recordings, first edit, selected export, QA sheets and SHA-256 inventory. Generated media remains local-only; recipes and selection metadata are tracked.
