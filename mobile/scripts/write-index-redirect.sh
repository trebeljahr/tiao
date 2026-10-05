#!/usr/bin/env bash
# write-index-redirect.sh — emit the root index.html "shell" of the mobile
# static export.
#
# Why this exists: Next.js static export emits `.next-mobile/en/`,
# `.next-mobile/de/`, `.next-mobile/es/` — but NO root entry point,
# because locale negotiation normally happens in middleware on the web
# build, and middleware doesn't run in static exports.
#
# The native routers (ios/App/App/TiaoRoutes.swift, android/.../TiaoRoutes.java)
# serve this file for "/" and for any path without a matching page. The
# inlined scripts/index-redirect.js picks the device locale (en/de/es,
# fallback en) and replaces the URL with a real page; see that file.
#
# Idempotent: rerunning overwrites the file. Safe to call from any
# build script.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TARGET="$REPO_ROOT/client/.next-mobile/index.html"

if [ ! -d "$REPO_ROOT/client/.next-mobile" ]; then
  echo "[write-index-redirect] expected $REPO_ROOT/client/.next-mobile to exist." >&2
  echo "[write-index-redirect] run pnpm --dir ../client run build:mobile first." >&2
  exit 1
fi

{
  cat <<'HTML'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tiao</title>
    <style>
      html, body { margin: 0; padding: 0; background: #2a1d13; color: #f3ebe0; height: 100%; }
      body { display: flex; align-items: center; justify-content: center; font-family: system-ui, -apple-system, sans-serif; }
    </style>
  </head>
  <body>
    <noscript>
      <p>Tiao needs JavaScript enabled. <a style="color:#f3ebe0" href="/en/">Open in English</a>.</p>
    </noscript>
    <script>
HTML
  cat "$SCRIPT_DIR/index-redirect.js"
  cat <<'HTML'
    </script>
  </body>
</html>
HTML
} > "$TARGET"

echo "[write-index-redirect] wrote $TARGET"
