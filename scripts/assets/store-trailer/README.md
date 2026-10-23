# Trailer build recipe

`scripts/store-trailer-current.json` records the selected local export, checksum, archive and upload state. Stable export: `build/store-trailer/tiao-gameplay-current.mp4`; distinct review copy: `build/store-trailer/tiao-ai-match.mp4`. The new revision is local review only.

## Rebuild

Requires Node 24+, FFmpeg, Sharp and the archived raw recordings. Set `SHARP_MODULE` when Sharp is installed separately. Run one heavy job at a time; the renderer caps FFmpeg/Sharp threads.

```sh
SHARP_MODULE=/absolute/path/to/sharp node scripts/store-trailer.mjs /absolute/path/to/trailer-bundle
```

`edit.json` contains all title cards, crops, speeds and sound settings. The bundle's `raw/` contains actual app recordings and screenshots. `--edit=<archived-edit.json>` selects an earlier recipe, `--audio-only` remixes an existing picture, and `--shot=N` replaces one shot before reassembly. None selects or uploads the candidate. Preserve the previous selection first.

## Actual AI match

`ai-match.json` is the complete recorded decision ledger: White runs the shipped Intermediate engine (level 2), Black runs Hard (level 3), both at their normal search settings. They start from an empty 19×19 board with the normal ten-capture goal. There are no seeded positions or chosen/suppressed moves. The log preserves every search depth, node count, elapsed time, score change and board hash, plus the engine source hash. White wins 13–5 after a five-capture chain; capture chains can exceed the target when confirmed.

`generate-trailer-ai-match.ts` regenerates a match using the client engine. Run it with an installed `tsx` and `--tsconfig client/tsconfig.json`. Runtime search budgets can affect the resulting decisions; the committed ledger reproduces this exact match without rerunning search. Every generated decision is validated through public `placePiece`, `jumpPiece` and `confirmPendingJump` rules. The replay test independently reconstructs all 45 turns and verifies every board hash and the final result.

The full match is clicked through the actual UI, and its final board is checked against the ledger. The opening teaser comes from Black's real three-capture comeback; the placement example uses the match's first four decisions. After the goal card at 29.7 seconds, all 45 turns appear in order from 31.2–46.8. Six contiguous source ranges accelerate from about 1.1× to 3.5×. The board framing stays fixed, and no turn is skipped or replaced. The genuine settled result holds before the logo at 48.2.

The separate rules recording illustrates Black's legal double capture, immediately after “Jump to capture.” White's preceding single capture establishes that position before the excerpt. This instructional example is composed legal play; it is not attributed to the AI match. The chain intertitle and the older composed final-game fixture are absent from this cut.

## UI and camera

“Play with friends.” begins at 12.5 seconds, “Win tournaments.” at 17.5, and “Make it yours.” at 22. The badge picker now occupies a full-width settings row above account management, with inline selection feedback and accessible pressed states. Theme previews use three columns inside the drawer and explicit square SVG dimensions. These are actual client fixes, rebuilt and recaptured; the trailer does not substitute mock controls.

All footage uses static framing. Fill and contain modes preserve source proportions. Tournament shots have no sinusoidal pan or animated camera crop. Matching full-frame theme screenshots show the actual AI position after Black's comeback, with all four board edges visible. Desktop/mobile browser QA checks picker bounds, square previews, badge wrapping and mobile drawer scrolling.

## Sound and QA

The original Next Move piano and 48.2-second cadence remain. Its MIDI, score and production MP3 are tracked; the installed Apple Yamaha samples are not redistributed. Five restrained Raptor Runner swooshes retain −14 dBFS pre-master peaks and 2 dB music ducks.

`move-events.json` records source-frame placements, jump-origin vacancy and captured-stone removal. There are 63 actual actions in the full AI replay; the teaser, opening reuse and Black double example bring the cut to 74 cues. The projection helper applies each shot's trim, speed and crop, rejecting unrelated manual taps. No click pulse is synthesized. Stems include moves, transitions, effects, music, ducked music and the master.

```sh
node --test scripts/store-trailer-ai-match.test.mjs scripts/store-trailer-move-sounds.test.mjs
python3 scripts/verify-trailer-move-sounds.py /absolute/path/to/trailer-bundle
```

The visual verifier exports before/cue/after sheets, checks frame offsets and verifies silence between cues. Its geometry matches fixed fill/contain framing. Inspect the final encoded AAC, full decode and FFprobe metadata as well as stems. Master target is −16 LUFS, constrained by −2 dBFS true peak.

## Capture and preservation

Serve the built/finalized client export with `store-trailer-preview.mjs <client/out>` on an ephemeral loopback port. Use an isolated muted Playwright CLI session named `tiao-trailer` and set `PLAYWRIGHT_CLI` to its installed entry point. Capture phases include `setup`, `prepare-opening` → `ai-match`, `ai-result` → `ai-result-hold`, `prepare-counter` → `counter`, `prepare-customization` → `customization`, and `prepare-ai-theme` → `themes`. Re-recording changes native frame anchors; inspect them again rather than reusing old times. Close the browser and server afterward.

Social/tournament/profile footage uses isolated fictional accounts and owned-item fixtures. No live invitation or account write occurs. Runtime gameplay and UI recordings, all useful prior iterations, recipes, visual/frame QA, source logs, stems and checksums are preserved in the project vault. Production audio, licences, selected edit, AI ledger, generator, tests and selection metadata are tracked in Tiao. `safe-opening-current.json` retains the preceding selection. Large vault media is ignored/local-only and requires the normal vault backup; Git alone cannot reproduce it.
