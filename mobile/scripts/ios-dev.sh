#!/usr/bin/env bash
#
# Tiao — one-command iOS dev loop with hot reload.
#
# Mirror of scripts/android-dev.sh for iOS Simulator. Capacitor's
# `server.url` config picks up CAP_DEV_URL at sync time, so the
# WebView loads directly from the Next.js dev server and edits to
# client/src hot-reload in ~500ms — no rebuild per change.
#
# What this does:
#   1. Boot the iOS Simulator if no device is booted (defaults to a
#      light profile, iPhone SE 3rd gen).
#   2. Start Next dev on 0.0.0.0 so the simulator can reach it.
#   3. cap sync ios with CAP_DEV_URL set.
#   4. cap run ios — builds and launches on the booted simulator.
#
# Env overrides:
#   SIM=<device name>   simulator (default: iPhone SE (3rd generation))
#   NEXT_PORT=<n>       Next dev port (default: 3100)
#   LAN_IP=<ip>         override auto-detected LAN IP
#
# NOTE: physical iOS devices need an Apple Developer / Xcode signing
# identity. Simulators don't. This script targets simulators only —
# use `cap run ios --target <udid>` for tethered devices.

set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
CLIENT="$(cd "$REPO/../client" && pwd)"

SIM_NAME="${SIM:-iPhone SE (3rd generation)}"
NEXT_PORT="${NEXT_PORT:-3100}"

# The iOS Simulator shares the Mac's network namespace, so localhost
# works — no LAN hop, no firewall prompt, works offline. For a real
# iPhone over Wi-Fi pass LAN_IP=... and connect the devices to the
# same Wi-Fi network.
DEV_HOST="${LAN_IP:-localhost}"

NEXT_PID=""

cleanup() {
  echo ""
  echo "🧹 Stopping Next dev server"
  if [ -n "$NEXT_PID" ]; then
    kill -TERM "$NEXT_PID" 2>/dev/null || true
  fi
  # Only the PID we spawned — no port sweep that could hit the user's
  # main worktree on 3000. (Workflow rule: never kill arbitrary procs.)
  wait 2>/dev/null || true
  echo "   (simulator left running — next dev:ios is instant)"
}
trap cleanup EXIT INT TERM

# ── 1. Simulator ──────────────────────────────────────────
if xcrun simctl list devices | grep -q "Booted"; then
  BOOTED_NAME=$(xcrun simctl list devices | grep "Booted" | head -1 | sed -E 's/^[[:space:]]+(.*) \([A-F0-9-]+\).*/\1/')
  echo "📱 Simulator already booted: $BOOTED_NAME"
else
  echo "🤖 Booting simulator: $SIM_NAME"
  UDID=$(xcrun simctl list devices available \
    | grep -F "$SIM_NAME" \
    | head -1 \
    | sed -E 's/.*\(([A-F0-9-]+)\).*/\1/')
  if [ -z "$UDID" ]; then
    echo "❌ Simulator '$SIM_NAME' not found."
    echo "   Available: xcrun simctl list devices available"
    exit 1
  fi
  xcrun simctl boot "$UDID"
  open -a Simulator
  until xcrun simctl list devices | grep -F "$UDID" | grep -q "Booted"; do
    sleep 1
  done
  echo "✅ Simulator ready"
fi

# ── 2. Fallback bundle ─────────────────────────────────────
if [ ! -d "$CLIENT/.next-mobile" ] || [ ! -d "$REPO/ios/App/App/public" ]; then
  echo "📦 Building fallback bundle (first run)..."
  (cd "$REPO" && pnpm run build:client)
fi

# ── 3. Next dev server ─────────────────────────────────────
CAP_DEV_URL="http://$DEV_HOST:$NEXT_PORT"
echo "🔥 Starting Next dev at $CAP_DEV_URL (host:port the WebView will hit)"
(cd "$CLIENT" && NEXT_PUBLIC_PLATFORM=mobile \
   NEXT_PUBLIC_MOBILE_API_URL="${NEXT_PUBLIC_MOBILE_API_URL:-http://$DEV_HOST:5005}" \
   pnpm dev -- --hostname 0.0.0.0 --port "$NEXT_PORT") &
NEXT_PID=$!

echo "   waiting for Next to answer..."
READY_TIMEOUT=60
SECS=0
until curl -s -o /dev/null "http://localhost:$NEXT_PORT"; do
  sleep 0.5
  SECS=$((SECS + 1))
  if [ $SECS -ge $((READY_TIMEOUT * 2)) ]; then
    echo "❌ Next dev didn't start in ${READY_TIMEOUT}s."
    exit 1
  fi
done
echo "✅ Next dev ready"

# ── 4. Capacitor sync + deploy ─────────────────────────────
echo "📦 Syncing Capacitor config (server.url = $CAP_DEV_URL)"
export CAP_DEV_URL
(cd "$REPO" && ./node_modules/.bin/cap sync ios)

SIM_UDID=$(xcrun simctl list devices | grep "Booted" | head -1 | sed -E 's/.*\(([A-F0-9-]+)\).*/\1/')
if [ -z "$SIM_UDID" ]; then
  echo "❌ No booted simulator found — should not happen after the boot wait above."
  exit 1
fi

echo "🚀 Building + launching on $SIM_UDID..."
(cd "$REPO" && ./node_modules/.bin/cap run ios --target "$SIM_UDID")

echo ""
echo "✨ Live-reload active."
echo "   Edit client/src/ and the simulator hot-reloads in ~500ms."
echo "   Ctrl+C to stop (simulator stays running)."
wait "$NEXT_PID"
