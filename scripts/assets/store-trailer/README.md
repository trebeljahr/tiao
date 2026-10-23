# Trailer build recipe

The current local selection and its checksum are recorded in `scripts/store-trailer-current.json`. The Steam upload state belongs to that exact export. A local selection does not change the uploaded trailer.

`pnpm store:trailer` renders the 57.1-second intertitle / piano edit from `build/store-trailer-v3/raw/`. The result is `build/store-trailer-v3/tiao-intertitles-and-piano.mp4`. The selected copy has a stable local path at `build/store-trailer/tiao-gameplay-current.mp4`.

## Inputs

- `edit.json`: 25 shots, source in/out points, crop windows, full-screen intertitles and sound cues.
- `raw/`: original 1920×1080 UI recordings and stills from the project vault archive named in the current-selection JSON.
- `scripts/assets/tiao-icon.svg` and `tiao-wordmark.svg`: existing outlined brand assets.
- `client/public/move.mp3`: the existing game sound. `audio/` contains the selected Collection of Beauty piano excerpt and the Raptor Runner transition effects; `audio/credits.json` records sources, licences and hashes.

Requires Node 24+, FFmpeg and Sharp. Set `SHARP_MODULE` to an absolute installed Sharp module path if it is supplied by a separate runtime. Render one job at a time; the script limits Sharp and FFmpeg threads. Full-screen rule cards remain sufficient with sound off. Gameplay has no editorial text overlays.

To rebuild from the archive without copying raw recordings back into the checkout:

```sh
SHARP_MODULE=/absolute/path/to/sharp node scripts/store-trailer.mjs /absolute/path/to/trailer-bundle
```

The editor creates `graphics/`, `cut/`, audio stems, a measured mix report and a candidate MP4 in the supplied folder. `--audio-only` remixes an existing assembled picture without rendering video again. It does not select or upload that candidate. Preserve the prior selected export and verify checksums before replacing it.

## Capture

`store-trailer-preview.mjs /absolute/path/to/client/out` serves an existing web export on a random local port. It does not run a backend.

Open an isolated Playwright CLI session named `tiao-trailer`. Set `PLAYWRIGHT_CLI` to its installed JavaScript entry point. Run `store-trailer-capture.mjs <phase> <local-url> [capture-root]` with phases, in order: `setup`, `rules`, `prepare-chain`, `chain`, `prepare-win`, `win`, `friends`, `tournament`, `winner`, `badges`, `achievements`. Close the browser and preview server after capture.

Gameplay is clicked through the real local game UI. Every move in the recorded match is independently replayed through the shared engine. Social, tournament and account screens use existing sample players and isolated API responses. Non-local browser requests are blocked. No real friend invitations, tournament results or account changes are made.

`store-trailer-replay.mjs` preserves the old 30-second replay encoder. Its default output folder is separate from the current selection. `previous-current.json` records that earlier export and its saved Steam upload.

Intertitles use warm near-black, the original outlined Tiao wordmark, cream serif text and a muted green accent. Cards fade in/out over 0.16 seconds; transition whooshes peak at the cut. Music is one continuous original-speed Pathétique excerpt with static gain and a final peak limiter. The end card has a quiet piano-hit accent.

The project vault preserves the raw recordings, previous edits, selected export, QA sheets and SHA-256 inventory. The previous 50.3-second selection is recorded in `rules-overlay-current.json`; its raw clips are reused without changes. Generated media remains local-only; recipes and selection metadata are tracked.
