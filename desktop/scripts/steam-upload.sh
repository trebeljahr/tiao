#!/usr/bin/env bash
set -euo pipefail

# Upload the packaged Tiao desktop build to Steam via SteamPipe.
#
# Renders desktop/steam/*.vdf.template with the current environment,
# then hands the result to steamcmd. See desktop/steam/README.md for
# the credential setup (particularly STEAM_CONFIG_VDF, which is how
# Steam Guard gets out of the way in CI).
#
# Usage:
#   ./scripts/steam-upload.sh                 # upload every platform present
#   ./scripts/steam-upload.sh --preview       # dry run, transfers nothing
#   ./scripts/steam-upload.sh --only windows  # single depot
#
# Expects `npm run package:steam` to have run first. Uploads whichever
# unpacked directories exist, so a macOS host that only built mac
# artifacts uploads only the mac depot — that is normal for a local
# run, and CI is what produces a complete three-platform build.

cd "$(dirname "$0")/.."

if [ -f .env.release ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.release
  set +a
fi

PREVIEW=0
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --preview) PREVIEW=1 ;;
    --only) ONLY="${2:-}"; shift ;;
    *) echo "[steam] unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

# ── Guards ────────────────────────────────────────────────────────────
#
# Every one of these is a failure that would otherwise surface as a
# confusing steamcmd error, or worse, as a successful upload to the
# wrong place.

APPID="${TIAO_STEAM_APPID:-}"

if [ -z "$APPID" ]; then
  echo "[steam] TIAO_STEAM_APPID is not set." >&2
  echo "[steam] This is the appid from the Steam Partner Portal." >&2
  exit 1
fi

if [ "$APPID" = "480" ]; then
  # 480 is Valve's public Spacewar test app. It is genuinely useful for
  # verifying that the SDK loads locally, and genuinely catastrophic as
  # an upload target — it is not ours, and the credentials would not
  # have rights to it anyway. Failing here beats failing halfway
  # through a transfer.
  echo "[steam] Refusing to upload against appid 480 (Valve's Spacewar test app)." >&2
  echo "[steam] Set TIAO_STEAM_APPID to the real Tiao appid first." >&2
  exit 1
fi

if [ -z "${STEAM_USERNAME:-}" ]; then
  echo "[steam] STEAM_USERNAME is not set." >&2
  exit 1
fi

if ! command -v steamcmd >/dev/null 2>&1; then
  echo "[steam] steamcmd not found on PATH." >&2
  echo "[steam] Install it from https://partner.steamgames.com/doc/sdk/uploading" >&2
  exit 1
fi

if ! command -v envsubst >/dev/null 2>&1; then
  echo "[steam] envsubst not found (part of gettext)." >&2
  echo "[steam] macOS: brew install gettext && brew link --force gettext" >&2
  exit 1
fi

# Depot IDs default to the appid+N convention the Partner Portal uses,
# but the portal can assign anything — allow an override per platform.
DEPOT_WINDOWS="${TIAO_STEAM_DEPOT_WINDOWS:-$((APPID + 1))}"
DEPOT_MAC="${TIAO_STEAM_DEPOT_MAC:-$((APPID + 2))}"
DEPOT_LINUX="${TIAO_STEAM_DEPOT_LINUX:-$((APPID + 3))}"

VERSION="${TIAO_DESKTOP_VERSION:-$(node -p "require('./package.json').version")}"
BRANCH="${TIAO_STEAM_BRANCH:-}"

STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

# ── Depot selection ───────────────────────────────────────────────────
#
# Only upload platforms that actually got built. electron-builder emits
# these unpacked directories alongside the installers.

DEPOT_ENTRIES=""
UPLOADED=""

add_depot() {
  local name="$1" depot_id="$2" content="$3"

  if [ -n "$ONLY" ] && [ "$ONLY" != "$name" ]; then
    return
  fi
  if [ ! -d "$content" ]; then
    echo "[steam] skipping $name — $content not built"
    return
  fi

  local vdf="depot_${name}.vdf"
  TIAO_STEAM_DEPOT_ID="$depot_id" \
  TIAO_STEAM_DEPOT_CONTENT="$(cd "$content" && pwd)" \
    envsubst < steam/depot_build.vdf.template > "$STAGING/$vdf"

  # Tabs matter here only for readability; the VDF parser is
  # whitespace-insensitive.
  DEPOT_ENTRIES="${DEPOT_ENTRIES}		\"${depot_id}\"	\"${vdf}\"
"
  UPLOADED="${UPLOADED} ${name}(${depot_id})"
  echo "[steam] depot $depot_id  $name  <- $content"
}

add_depot windows "$DEPOT_WINDOWS" "dist/win-unpacked"
add_depot mac     "$DEPOT_MAC"     "dist/mac-universal/Tiao.app"
add_depot linux   "$DEPOT_LINUX"   "dist/linux-unpacked"

if [ -z "$DEPOT_ENTRIES" ]; then
  echo "[steam] No built content found. Run \`npm run package:steam\` first." >&2
  exit 1
fi

# ── Render the app build script ───────────────────────────────────────

TIAO_STEAM_APPID="$APPID" \
TIAO_STEAM_BUILD_DESC="Tiao ${VERSION}" \
TIAO_STEAM_BUILD_OUTPUT="$STAGING/output" \
TIAO_STEAM_CONTENT_ROOT="$(pwd)" \
TIAO_STEAM_BRANCH="$BRANCH" \
TIAO_STEAM_PREVIEW="$PREVIEW" \
TIAO_STEAM_DEPOT_ENTRIES="$DEPOT_ENTRIES" \
  envsubst < steam/app_build.vdf.template > "$STAGING/app_build.vdf"

mkdir -p "$STAGING/output"

echo "[steam] appid      $APPID"
echo "[steam] version    $VERSION"
echo "[steam] depots     ${UPLOADED# }"
if [ -n "$BRANCH" ]; then
  echo "[steam] setlive    $BRANCH"
else
  echo "[steam] setlive    (none — promote from the Partner Portal)"
fi
[ "$PREVIEW" = "1" ] && echo "[steam] PREVIEW — nothing will be transferred"

# ── Steam Guard ───────────────────────────────────────────────────────
#
# steamcmd reads a cached session from its own config directory. In CI
# there is no interactive login to produce one, so we materialise it
# from a base64 secret captured after a one-time manual 2FA login.

if [ -n "${STEAM_CONFIG_VDF:-}" ]; then
  STEAM_CONFIG_DIR="${HOME}/Steam/config"
  mkdir -p "$STEAM_CONFIG_DIR"
  echo "$STEAM_CONFIG_VDF" | base64 --decode > "$STEAM_CONFIG_DIR/config.vdf"
  chmod 600 "$STEAM_CONFIG_DIR/config.vdf"
  echo "[steam] restored cached Steam session"
fi

# `+login` without a password relies on that cached session. If it has
# expired, steamcmd fails with a login error rather than hanging on a
# prompt — redo the interactive login and refresh STEAM_CONFIG_VDF.
steamcmd \
  +login "$STEAM_USERNAME" \
  +run_app_build "$STAGING/app_build.vdf" \
  +quit

echo "[steam] done"
if [ -z "$BRANCH" ] && [ "$PREVIEW" = "0" ]; then
  echo "[steam] Build uploaded but NOT live. Set it live in the Partner Portal:"
  echo "[steam]   https://partner.steamgames.com/apps/builds/$APPID"
fi
