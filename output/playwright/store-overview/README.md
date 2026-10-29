# Current screenshot selection

[Desktop gallery](steam-1080p/index.html) · [Contact sheet](steam-1080p/contact-sheet.jpg)

Local device galleries: [iPhone](iphone-69/index.html), [iPad](ipad-13/index.html),
[Mac](mac/index.html).

Ten images, in upload order: capture chain, tutorial, achievements, opening play,
computer setup, tournament bracket, friends, board themes, replay controls, victory.
Match history and border-rule examples remain in the raw `store-ui` captures.

The desktop selection is tracked. Device exports are local, ignored, and generated
by `pnpm store:screenshots http://127.0.0.1:<port>`. Add `--only=steam-1080p` for
desktop, or `--select-only` to rebuild the selection from existing captures.
Each size has its own `selection.json` with source paths, dimensions, and SHA-256
checksums. Copy the ten numbered images for upload; the HTML and contact sheet are
review aids. These are local selections, with no publication or upload implied.

Gameplay comes from legal moves checked by the shared engine and replayed through
the real UI. Account, achievement, friend, and tournament screens use isolated
sample data. Tutorial and setup controls are operated through the shipped UI.
