#!/usr/bin/env bash
# write-index-redirect.sh — emit a tiny root index.html that redirects
# into the user's preferred locale folder.
#
# Why this exists: Next.js static export emits `.next-mobile/en/`,
# `.next-mobile/de/`, `.next-mobile/es/` — but NO root entry point,
# because locale negotiation normally happens in middleware on the
# web build, and middleware doesn't run in static exports. The
# Capacitor WebView loads `webDir`'s root and would otherwise hit a
# 404 from the bundled file system.
#
# The redirect HTML picks the locale client-side via
# `navigator.language` against the routing.locales list (en/de/es)
# and `<meta http-equiv=refresh>` to the matching folder. Falls back
# to `/en/` for unsupported browser languages.
#
# Idempotent: rerunning overwrites the file. Safe to call from any
# build script.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="$REPO_ROOT/client/.next-mobile/index.html"

if [ ! -d "$REPO_ROOT/client/.next-mobile" ]; then
  echo "[write-index-redirect] expected $REPO_ROOT/client/.next-mobile to exist." >&2
  echo "[write-index-redirect] run pnpm --dir ../client run build:mobile first." >&2
  exit 1
fi

cat > "$TARGET" <<'HTML'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Tiao</title>
    <style>
      html, body { margin: 0; padding: 0; background: #2a1d13; color: #f3ebe0; height: 100%; }
      body { display: flex; align-items: center; justify-content: center; font-family: system-ui, -apple-system, sans-serif; }
    </style>
  </head>
  <body>
    <noscript>
      <p>Tiao needs JavaScript enabled. <a style="color:#f3ebe0" href="./en/">Open in English</a>.</p>
    </noscript>
    <script>
      (function () {
        var supported = ["en", "de", "es"];
        var fallback = "en";
        var raw = (navigator.language || navigator.userLanguage || fallback).toLowerCase();
        var primary = raw.split("-")[0];
        var locale = supported.indexOf(primary) >= 0 ? primary : fallback;
        location.replace("./" + locale + "/");
      })();
    </script>
  </body>
</html>
HTML

echo "[write-index-redirect] wrote $TARGET"
