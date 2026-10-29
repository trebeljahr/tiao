# Trailer build recipe

`scripts/store-trailer-current.json` records the selected local export, checksum, archive and upload state. Stable export: `build/store-trailer/tiao-gameplay-current.mp4`; distinct review copy: `build/store-trailer/tiao-original-opening.mp4`. This is a local review cut.

## Rebuild

Requires Node 24+, FFmpeg, Sharp and the archived source recordings. Set `SHARP_MODULE` when installed separately. Run one heavy job at a time; FFmpeg and Sharp use bounded threads.

```sh
SHARP_MODULE=/absolute/path/to/sharp node scripts/store-trailer.mjs /absolute/path/to/bundle
```

`edit.json` contains cards, crops, source dimensions and time maps. `raw/` holds actual UI frames and screenshots. `--edit=<archived-edit.json>` selects another recipe; `--audio-only` remixes an existing picture; `--shot=N[,M]` replaces selected shots before reassembly. None uploads or selects the candidate. Preserve the previous selection first.

The selected 48.1667-second edit uses 22 shots. The opening teaser shows White's first genuine two-capture AI exchange. “Take turns.” gets six alternating decisions over 4.1 seconds. The complete legal instructional example follows “Jump to capture.”: White captures first, then Black captures both Whites. The rule example plays at 1.5× speed over 3.2 seconds.

“Play with friends.” shows an actual long list, a received game invitation, acceptance, and the resulting multiplayer route. These use isolated fictional fixtures and native WebSocket/UI handlers. No live invitation or account write occurs. Tournament stills show the real bracket and completed-result UI with sample data. “Make it yours.” cuts directly among four full native board themes; badge and theme-selector shots are absent.

## Genuine AI match and final cadence

`ai-match.json` preserves all 45 decisions from the shipped Intermediate White engine (level 2) versus Hard Black (level 3), including normal search settings, depths, node counts, scores, board hashes and engine source hash. They start from an empty 19×19 board with the normal ten-capture goal. No moves are selected, suppressed or seeded. White wins 13–5 after a five-capture chain; chains can exceed ten when confirmed together.

`generate-trailer-ai-match.ts` regenerates a match through the client engine. Use an installed `tsx` with `--tsconfig client/tsconfig.json`. Search budgets can affect new decisions; the committed ledger reproduces this exact match without another search. The replay test reconstructs every turn through public rules and verifies all hashes and the result.

The match is clicked through the real UI and the final DOM board is checked against the ledger. Every committed action has an equal 18-frame source interval, including jump selection and confirmation. This removes the extra selection/hover waits around the earlier recording's first capture.

The full replay begins at 29.1 seconds and lasts 14.2667 seconds. A continuous logarithmic time map accelerates from 1.31× to 4.60×, with no step changes or slowing. The last confirmation lands on the piano cadence at 43.3667 seconds. Native victory confetti continues into a 0.6-second crossfade at 44.6667 seconds. The closing card reuses the approved vector Steam artwork with “Free to Play on Steam,” holding through 48.1667 seconds. The original piano opening is preserved. Repeated bars 11–12 are removed later: the source jumps from 24.08 to 28.9 seconds with a 640-sample (13.333 ms) crossfade, shortening it by 4.8333 seconds without changing pitch or tempo. The final chord and tail stay aligned with the win and end card.

## Capture quality and sound

New gameplay, rule, friend and tournament detail sources are lossless 3840×2160 PNG captures at 2× device density. The winning confirmation and confetti use a separate native 1920×1080, 30 fps real-time recording of the same ledger position. No selected crop is smaller than the 1920×1080 output. Theme stills retain their full native 1920×1080 dimensions. This avoids enlarging compressed small UI regions. The final H.264 target is 14 Mbps, with stereo AAC 256 kbps at 48 kHz. Footage cameras remain static; the friend list uses actual page scrolling.

Initialize an isolated muted Playwright CLI session with the archived capture configuration and `store-trailer-capture.mjs setup`. `store-trailer-capture-hq.mjs` steps browser time for the complete AI replay. Record the White/Black rule example with `prepare-counter-real` and `counter-real` in a fresh normal-clock browser context; `store-trailer-capture-friends.mjs` records the list, native invitation update and acceptance. The renderer reads the original PNG sequences directly. AI browser-clock stepping sets move and particle timing; CSS transitions can settle during screenshot capture. Opening source frames 0–143 and the rule demo are recorded in fresh normal-clock contexts to avoid a capture-clock opacity fault. Every active stone is checked after all 63 AI actions, and the encoded cue audit also checks the moving stone is visible. `store-trailer-capture-victory.mjs` replays the same decisions to the pending winning confirmation and validates the DOM before and after recording it. The selected lossless `victory-clean.mkv` omits two non-move frames of the native result-dialog flash; the original `victory-cadence.webm` remains archived. No game position, win effect or UI control is drawn for the trailer.

`store-trailer-frame-manifest.mjs <bundle>` fingerprints every source frame and records committed event anchors. `move-events.json` contains those hashes, measured source grids and action positions. The projection helper uses the same linear/logarithmic time maps as the renderer. Hover and selection previews remain silent. The full match contributes 63 actions; teaser, opening and rule reuse bring the total to 77 cues.

The original Next Move piano, its pitch and tempo remain. MIDI, score, production MP3 and licence are tracked; installed Apple samples are not redistributed. Five restrained Raptor Runner swooshes retain −14 dBFS pre-master peaks and 2 dB music ducking. Stems include moves, transitions, effects, music, ducked music and the master. Master target is −16 LUFS, constrained by −2 dBFS true peak.

```sh
node --test scripts/store-trailer-ai-match.test.mjs scripts/store-trailer-move-sounds.test.mjs
python3 scripts/verify-trailer-move-sounds.py /absolute/path/to/bundle
```

The verifier checks committed pixel changes independently of scheduled inputs, exports every before/cue/after contact sheet, and verifies exact move-track silence between cues. Tests cover continuous acceleration, the final cadence, both rule colors, complete replay, source trims and off-screen cue exclusion. Decode the final video/audio and inspect FFprobe, native theme geometry, invitation acceptance and end-card transition too.

## Preservation

The project vault holds source PNG sequences, capture code/logs and fixtures, selected and prior exports, editable cards, stems, frame QA and checksums. `ai-match-current.json` preserves the preceding selection; older histories remain. Production audio, approved store-art vectors, the ledger, renderer, tests and current metadata remain tracked in Tiao. Large archive media is ignored/local-only and needs normal vault backup. Git alone cannot reproduce the footage. Close the isolated browser and preview server after capture.
