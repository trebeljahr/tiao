# Current screenshot selection

[Desktop gallery](steam-1080p/index.html) · [Contact sheet](steam-1080p/contact-sheet.jpg)

[AI gameplay comparison](steam-1080p/ai-gameplay-contact.jpg)

Local device galleries: [iPhone](iphone-69/index.html), [iPad](ipad-13/index.html),
[Mac](mac/index.html).

Ten images, in upload order: AI capture chain, tutorial, achievements, developed AI game,
computer setup, tournament bracket, friends, board themes, replay controls, victory.
Match history and border-rule examples remain in the raw `store-ui` captures.

The desktop selection is tracked. Device exports are local, ignored, and generated
by `pnpm store:screenshots http://127.0.0.1:<port>`. Add `--only=steam-1080p` for
desktop, or `--select-only` to rebuild the selection from existing captures.
Each size has its own `selection.json` with source paths, dimensions, and SHA-256
checksums. Copy the ten numbered images for upload; the HTML and contact sheet are
review aids. These are local selections, with no publication or upload implied.

Every gameplay board, including replay and theme views, comes from complete
shipped-AI self-play logs. Both AIs start at an empty board and use normal search
budgets. Every decision is retained and validated through the rules before UI replay.
Each board capture records its ledger checksum, engine source checksum, turn,
settings, score and board checksum in `capture-provenance.json`; selected image
metadata includes that proof. Account and tournament details are sample data.
Tutorial boards are authored teaching examples. Setup controls use the shipped UI.

`scripts/generate-screenshot-ai-matches.ts long|compact` regenerates the two new
match logs with `tsx --tsconfig client/tsconfig.json`. Exporting screenshots uses
the recorded decisions. The third match is the preserved trailer self-play log.
The older `store-gameplay/legal-replays.json` supports a legacy trailer capture
recipe and is not a screenshot source.
