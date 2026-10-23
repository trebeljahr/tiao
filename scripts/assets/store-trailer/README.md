# Trailer build recipe

Current selection, checksum and upload state: `scripts/store-trailer-current.json`. Stable local export: `build/store-trailer/tiao-gameplay-current.mp4`. Distinct review copy: `build/store-trailer/tiao-safe-opening.mp4`. This 50.2-second revision is local and has not been approved or uploaded.

## Rebuild

Requires Node 24+, FFmpeg and Sharp. Supply `SHARP_MODULE` if Sharp lives outside the repo. Run one render at a time; FFmpeg and Sharp concurrency is capped.

```sh
SHARP_MODULE=/absolute/path/to/sharp node scripts/store-trailer.mjs /absolute/path/to/trailer-bundle
```

The bundle's `raw/` contains actual 1920×1080 UI recordings; the current-selection JSON names their archive. `edit.json` contains 28 shots, trim points, speeds, crops, cards and transition cues. Brand assets are `scripts/assets/tiao-icon.svg` and `tiao-wordmark.svg`. Production audio and licence/source hashes are under `audio/`.

The renderer exports shot encodes, picture, graphics, stems, mix measurements and candidate MP4. `--edit=/absolute/path/to/edit.json` selects an archived recipe. `--audio-only` remixes an existing `picture.mp4`; `--shot=N` replaces one shot before reassembly. These commands do not select or upload the result. Preserve and checksum the prior selection first.

## Selected edit

The logo opens for 1.6 seconds, followed by a two-second capture sequence. “Take turns.” introduces two separated friendly pairs. Neither color has an available jump after any placement; `opening-safe.json` and the shared engine regression verify every prefix. The following card introduces a separate diagonal-capture example. Each card contains only its main text; brand cards contain only the logo.

“Play with friends.” begins at 20 seconds, “Win tournaments.” at 25, and badges/achievements/themes at 29.5. The newly recorded badge selection uses its complete panel with uniform contain framing. Theme cuts use native 1920×1080 screenshots with the whole square board visible. The camera scale preserves source proportions, including crops that differ from 16:9. The goal card leads into a newly recorded continuous legal final exchange at 38.7: four placements, White's three-capture chain, then Black's four-hop reply to win 10–9. The camera cuts closer for Black's reply without skipping game state. The leading exchange plays at 0.921×, the reply at 1.04×. This replaces the previous 1.25×–6.5× montage. A settled victory view and logo close the cut.

The original “Next Move” piano remains after Rico's clarification to retain its buildup. The unducked music stem is byte-identical to the prior selection. It is an explicit 99.585 BPM MIDI composition, rendered locally with installed Apple Yamaha piano multisamples; no text-to-audio service. Its D-major ninth resolves on the closing logo at 48.2 seconds. Score, MIDI and composition/render scripts remain tracked; Apple sample-library assets are not redistributed.

The five section accents use the exact Raptor Runner `clean-woosh-8.mp3` bytes, verified by SHA-256. Peak alignment remains source +0.17s, duration 0.9s and tail fade 0.25s. Peaks are −14 dBFS before mastering, 7 dB quieter than the rejected mix. Music ducks 2 dB instead of 10. No transition plays at launch or at the final winning chain. The transition-only stem keeps level reports independent of nearby move clicks; accents are not required to overpower the piano.

`move-events.json` anchors committed source frames. The safe opening contributes four placements, the separate capture example contributes two actions, and the continuous finale contributes thirteen actions. Repeated chain footage brings the selected total to 29 cues. Placement begins when its ghost gives way to the committed animation; jump origins vacate; captured stones disappear on confirmation. Hover arrows, selection, title cards, UI shots and settled holds stay silent in the move stem. The projection helper applies source trim/speed and crop visibility and rejects independent manual taps. Every final cue is audited within one output frame of its visible action.

`moves.wav`, `transitions.wav`, `effects.wav`, `music.wav`, `music-ducked.wav` and `master.wav` support mix review. The encoded AAC measures −16.7 LUFS integrated / −2.0 dBFS true peak. The target is −16 LUFS with static gain constrained by peaks.

## Capture and validation

`store-trailer-preview.mjs /absolute/path/to/client/out` serves an existing export on a random loopback port. Use an isolated muted Playwright CLI session named `tiao-trailer` and set `PLAYWRIGHT_CLI` to its installed entry point.

Run `store-trailer-capture.mjs setup <url> <bundle>`, then `prepare-opening` / `opening-safe`, `prepare-badges` / `badges-framed`, or `prepare-finale` / `finale-continuous`. Setup and preparation happen before recording. The final exchange follows the existing engine-validated legal replay after move 56; its actual UI board is checked against the engine's final 10–9 position. Re-recording changes source-frame anchors: inspect and update the manifest rather than reusing old times. Close the owned browser and server afterward.

Earlier phases still reproduce original rules, chain, friend, tournament and profile footage. Social views use isolated fictional sample accounts. No live invitations or account writes occur. Fixture achievements and tournament history illustrate features independently of the local match shown.

```sh
node --test scripts/store-trailer-move-sounds.test.mjs
python3 scripts/verify-trailer-move-sounds.py /absolute/path/to/trailer-bundle
```

Focused tests also require no available jump after every safe opening placement and full native framing for all four theme cuts. They cover source projection, crop visibility, rejection of preview/manual taps, all late actions, and continuous final source ranges. Visual QA exports before/cue/after sheets for all 29 cues and checks exact move-track silence in logo, preview, UI and settled holds. Final video/audio decode and FFprobe complete export validation.

The vault keeps current and earlier exports, new raw clips, linked prior sources, stems, source-frame evidence and verified checksums. Media is local-only; recipes, production audio, licence records, tests and selection metadata are Git-tracked. `clear-opening-current.json` preserves the immediately previous selection; earlier selection JSONs remain alongside it.
