#!/usr/bin/env bash
#
# Tiao — one-command Android dev loop with hot reload.
#
# Mirrors the Raptor Runner pattern but points at the Next.js dev
# server (port 3100 by default — same as the rest of the tiao
# worktree) instead of Vite. Otherwise the flow is identical:
#
#   1. Source scripts/android-env.sh so JAVA_HOME / ANDROID_HOME
#      are set without touching your shell profile.
#   2. Boot the emulator (or reuse an attached phone) and wait for
#      adb to see it.
#   3. Start `pnpm --dir ../client dev -- --hostname 0.0.0.0` so the
#      emulator (which lives on a different network) can reach Next
#      at your machine's LAN IP.
#   4. cap sync with CAP_DEV_URL set — capacitor.config.ts conditionally
#      injects `server.url` when that env var is present, which tells
#      the WebView to load from the dev server instead of the bundled
#      `.next-mobile/` folder.
#   5. cap run android — installs the APK and launches it.
#
# Result: the WebView loads directly from Next dev. Editing
# client/src/... triggers HMR and the lobby reloads on the emulator
# in ~500ms. No APK rebuild between edits.
#
# Env overrides:
#   AVD=<name>        which AVD to boot (default: Pixel_9_Pro)
#   NEXT_PORT=<n>     Next dev port (default: 3100 — matches the
#                     worktree's autoPort base)
#   LAN_IP=<ip>       override auto-detected LAN IP
#
# On Ctrl+C: Next dev stops, but the emulator keeps running so the
# next invocation is instant. Use `adb emu kill` to shut it down.

set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
CLIENT="$(cd "$REPO/../client" && pwd)"
# shellcheck disable=SC1091
source "$HERE/android-env.sh"

AVD_NAME="${AVD:-Medium_Phone_API_35}"
NEXT_PORT="${NEXT_PORT:-3100}"

# The Android emulator runs inside a QEMU NAT that does NOT route to
# the Mac's real LAN IP. It reserves 10.0.2.2 as "host loopback" —
# any request to that IP hits 127.0.0.1 on the Mac. Reliable + works
# offline so it's the default.
#
# For a real Android phone over Wi-Fi, pass your LAN IP explicitly:
#     LAN_IP=$(ipconfig getifaddr en0) pnpm run dev:android
# Both devices need to be on the same Wi-Fi network.
DEV_HOST="${LAN_IP:-10.0.2.2}"

NEXT_PID=""

cleanup() {
  echo ""
  echo "🧹 Stopping Next dev server"
  if [ -n "$NEXT_PID" ]; then
    kill -TERM "$NEXT_PID" 2>/dev/null || true
  fi
  # Workflow rule reminder: never kill arbitrary processes. The
  # cleanup ONLY targets the PID we spawned ourselves above — no
  # `lsof | xargs kill` sweep — so a stray process on 3100 owned by
  # the user's main worktree is safe from us.
  wait 2>/dev/null || true
  echo "   (emulator/phone left running — next dev:android is instant)"
}
trap cleanup EXIT INT TERM

# ── 0. ADB sanity ──────────────────────────────────────────
# adb's design has a classic race: every adb invocation tries to
# bind port 5037, and when several run concurrently (Capacitor's
# retry loop does this) they all collide. Symptom: 'ADBs is
# unresponsive after 5000ms' x40 before a confusing give-up. Prevent
# the race by putting ONE healthy daemon in place first.
echo "🔧 Resetting adb server (prevents Capacitor retry-race)"
adb kill-server > /dev/null 2>&1 || true
adb start-server > /dev/null 2>&1

# ── 1. Device selection (physical phone OR emulator) ────────
ATTACHED_DEVICES=$(adb devices | awk 'NR>1 && $2 == "device" { print $1 }')
if [ -n "$ATTACHED_DEVICES" ]; then
  echo "📱 Using attached device(s):"
  echo "$ATTACHED_DEVICES" | sed 's/^/   /'
  if echo "$ATTACHED_DEVICES" | grep -qvE '^emulator-'; then
    if [ "$DEV_HOST" = "10.0.2.2" ]; then
      echo ""
      echo "⚠️  Physical device detected but DEV_HOST=10.0.2.2 (emulator-only)."
      echo "   Real phones can't reach 10.0.2.2 — that's an emulator NAT alias."
      echo "   Re-run with: LAN_IP=\$(ipconfig getifaddr en0) pnpm run dev:android"
      exit 1
    fi
  fi
elif adb devices | awk 'NR>1 && $2 == "unauthorized" { found=1 } END { exit !found }'; then
  echo "❌ Phone shows 'unauthorized' in adb devices."
  echo "   Tap 'Allow' on the USB debugging prompt on the phone."
  exit 1
else
  echo "🤖 No device attached — booting emulator: $AVD_NAME"
  nohup emulator -avd "$AVD_NAME" \
      -no-boot-anim \
      -memory 2048 \
      -gpu host \
      -netdelay none -netspeed full \
    > /tmp/tiao-mobile-emulator.log 2>&1 &
  disown
  echo "   waiting for adb..."
  adb wait-for-device
  echo "   waiting for Android boot..."
  BOOT_TIMEOUT=120
  SECS=0
  until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
    sleep 1
    SECS=$((SECS + 1))
    if [ $SECS -ge $BOOT_TIMEOUT ]; then
      echo "❌ Emulator didn't finish booting in ${BOOT_TIMEOUT}s."
      echo "   Log: /tmp/tiao-mobile-emulator.log"
      exit 1
    fi
  done
  echo "✅ Emulator ready"
fi

# ── 2. Next dev server ─────────────────────────────────────
CAP_DEV_URL="http://$DEV_HOST:$NEXT_PORT"
echo "🔥 Starting Next dev at $CAP_DEV_URL (host:port the WebView will hit)"
# Force NEXT_PUBLIC_PLATFORM=mobile so client/src/lib/api.ts hits the
# mobile API URL path even in dev. The dev server itself binds 0.0.0.0
# so the emulator NAT can reach it.
(cd "$CLIENT" && NEXT_PUBLIC_PLATFORM=mobile \
   NEXT_PUBLIC_MOBILE_API_URL="${NEXT_PUBLIC_MOBILE_API_URL:-http://$DEV_HOST:5005}" \
   pnpm dev -- --hostname 0.0.0.0 --port "$NEXT_PORT") &
NEXT_PID=$!

# Wait until Next is actually answering before we tell the app to
# load from it. Otherwise the WebView shows a scary error page.
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

# ── 3. Fallback bundle ─────────────────────────────────────
# `cap sync` writes android/app/src/main/assets/capacitor.config.json.
# When server.url is set, it skips copying webDir — but the write
# still requires the assets/ dir to exist. A fresh checkout has no
# assets/, so build once to populate `.next-mobile/` and let sync
# create the tree. Second benefit: if the player ever loses the dev-
# server connection (Wi-Fi drops, Mac sleeps), the WebView falls back
# to the bundled assets instead of showing a connection error.
if [ ! -d "$REPO/android/app/src/main/assets" ] || [ ! -d "$CLIENT/.next-mobile" ]; then
  echo "📦 Building fallback bundle (first run)..."
  (cd "$REPO" && pnpm run build:client)
fi

# ── 4. Capacitor sync + deploy ─────────────────────────────
echo "📦 Syncing Capacitor config (server.url = $CAP_DEV_URL)"
export CAP_DEV_URL
(cd "$REPO" && ./node_modules/.bin/cap sync android)

TARGET_SERIAL=$(adb devices | awk 'NR>1 && $2 == "device" { print $1; exit }')
if [ -z "$TARGET_SERIAL" ]; then
  echo "❌ No device visible to adb — should not happen after boot wait."
  exit 1
fi

echo "🚀 Installing + launching on $TARGET_SERIAL..."
(cd "$REPO" && ./node_modules/.bin/cap run android --target "$TARGET_SERIAL")

echo ""
echo "✨ Live-reload active."
echo "   Edit client/src/ and the WebView hot-reloads in ~500ms."
echo "   Ctrl+C to stop (emulator stays running)."
wait "$NEXT_PID"
