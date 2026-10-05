# Carried release assets

CI fills this directory before building the client image. It holds the
`/_next/static` files of the previous two releases, taken from the previous
`tiao-client:main` image, plus `releases.json`. The image copies it to
`/app/release-static`, and `release-assets.mjs` serves those files to tabs that
still run an older release. Locally it stays empty, and nothing is carried.
