# Carried release assets

CI fills this directory before building the web export. It holds the
`/_next/static` files of the previous two releases plus `releases.json`,
downloaded from the live site's `release-assets.json` by
`scripts/carry-release-static.mjs fetch`. `scripts/finalize-web-export.mjs`
copies them into `out/_next/static`, so tabs that still run an older release
keep loading their chunks from the new Worker version. Locally it stays
empty, and nothing is carried.
