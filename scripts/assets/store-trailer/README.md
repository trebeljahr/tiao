# Trailer build recipe

The current local selection and checksum are in `scripts/store-trailer-current.json`. A local selection does not change the uploaded trailer.

`pnpm store:trailer` renders the 50.2-second energetic edit from `build/store-trailer-v5/raw/` to `build/store-trailer-v5/tiao-custom-piano.mp4`. The selected stable copy is `build/store-trailer/tiao-gameplay-current.mp4`; the distinct review copy is `build/store-trailer/tiao-custom-piano.mp4`.

## Inputs and rebuild

- `edit.json`: 33 shots, source ranges, playback speeds, crops, full-screen cards and audio cues.
- `raw/`: 1920×1080 real UI recordings from the vault bundle named in the current-selection JSON.
- `scripts/assets/tiao-icon.svg`, `tiao-wordmark.svg`: original brand assets.
- `client/public/move.mp3`: game taps. `audio/` contains the original Next Move piano, earlier Meydän/Beethoven sources and Raptor Runner transition effects. `audio/credits.json` records licences and SHA-256 hashes.

Requires Node 24+, FFmpeg and Sharp. Set `SHARP_MODULE` to an installed Sharp module path when supplied separately. Render one job at a time; FFmpeg and Sharp thread counts are capped.

```sh
SHARP_MODULE=/absolute/path/to/sharp node scripts/store-trailer.mjs /absolute/path/to/trailer-bundle
```

The editor creates graphics, shot encodes, stems, a mix report and candidate MP4. `--edit=/absolute/path/to/edit.json` selects archived edit decisions. `--audio-only` remixes an existing picture; `--shot=N` replaces one existing shot then reassembles/remixes. Neither selects or uploads the result. Archive and checksum the prior selection before replacing it.

## Structure and sound

Rules first, friends at 20s, tournament bracket/final at 25s, badges/achievements/themes at 29.5s, then the goal card. From 38.7s the legal match accelerates through shrinking shots, the four-hop winning chain and Black’s victory. Only the two-second logo follows.

“Next Move” is an original 99.585 BPM piano composition in D major, made for this exact cut. Eighth-note figures carry the rules/feature sections; an upper-register variation adds motion from 38.56s and the final D-major ninth lands at 48.2s. It was composed as explicit MIDI notes and rendered locally with the installed Apple Yamaha piano multisamples. No text-to-audio service or stock loop was used. `audio/credits.json` records its method and instrument licence. Apple sample-library files stay installed locally and are not redistributed.

The performance has deterministic timing/velocity variation, pedal releases at harmonic changes and a short dark room. The 54-second lossless performance is archived; the tracked 320 kbps MP3 is the production input, trimmed/faded to 50.2s. The MIDI and score JSON are tracked under `music/`.

```sh
node scripts/compose-trailer-piano.mjs build/store-trailer-v5
python3 scripts/render-trailer-piano.py build/store-trailer-v5/piano-score.json build/store-trailer-v5/audio/next-move-original.wav
```

The Python renderer requires NumPy, SciPy, FFmpeg and the installed sample directory named in the score. It selects nearby soft/medium velocity samples, resamples pitch by at most four semitones and renders the completed arrangement offline. It never opens a speaker device. Regenerating the production MP3 uses `libmp3lame -b:a 320k`; preserve the full lossless render in the vault.

Music ducks by 10 dB at transitions; swooshes normalize to −7 dBFS peak before final mastering, with their peak aligned to the cut. The mix report checks each cue’s effect/music contrast and every second of the music for unexpected silence. Master target is −16 LUFS / −2 dBFS true peak, with static gain constrained by peaks. Verify the encoded AAC, not just the stems. The original in-key piano cadence replaces the stock closing impact. The previous Meydän credit is removed from the new closing card; it remains in the previous export/archive.

## Capture and provenance

`store-trailer-preview.mjs /absolute/path/to/client/out` serves an existing export on a random loopback port. Open an isolated Playwright CLI session named `tiao-trailer`, set `PLAYWRIGHT_CLI`, then run `store-trailer-capture.mjs <phase> <local-url> [capture-root]`.

Original phases: `setup`, `rules`, `prepare-chain`, `chain`, `prepare-win`, `win`, `friends`, `tournament`, `winner`, `badges`, `achievements`. New feature phases: after `setup` and `prepare-chain`, run `themes`; run `achievements-rich`, `badges-rich`, and `winner` separately. Close the owned browser/server after recording.

Gameplay is clicked through the real local game UI. Every move is replayed through the shared engine. Social, tournament and earned-item views use fictional sample accounts with coherent fixture history and owned themes; no live invitations, results, purchases or account changes. External requests are blocked. Zoom and cropping improve presentation without altering shipped UI components. Feature records are illustrative history, not achievements awarded for the four-hop match shown later.

The vault preserves new recordings, reused source references, previous cuts, selected export, QA and checksums. Media remains local-only; recipes, source audio and selection metadata are tracked. `previous-current.json`, `rules-overlay-current.json` `intertitles-piano-current.json` and `energy-finale-current.json` retain earlier selections. `store-trailer-replay.mjs` preserves the original 30-second encoder.
