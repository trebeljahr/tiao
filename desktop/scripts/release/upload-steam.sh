#!/usr/bin/env bash
# Runs SteamCMD against artifacts/steam-build.vdf (written by publish-desktop.mjs steam).
# Ported from Raptor Runner, including its Linux-runner fixes. Success is the
# "Successfully finished AppID 5035580" line, never the exit code alone, and raw
# SteamCMD output is never printed: it can contain authentication data.
set -euo pipefail
: "${STEAM_USERNAME:?Missing Steam build account}"
: "${STEAM_CONFIG_VDF:?Missing authorized SteamCMD session}"
: "${RUNNER_TEMP:?Missing RUNNER_TEMP}"
steam_dir="$RUNNER_TEMP/tiao-steamcmd"
umask 077
mkdir -p "$steam_dir"
config_path=''
config_staged=0
cleanup() {
  if (( config_staged )); then
    if [[ -f "$steam_dir/config-before.vdf" ]]; then
      cp "$steam_dir/config-before.vdf" "$config_path"
    else
      rm -f "$config_path"
    fi
  fi
  rm -rf "$steam_dir"
}
trap cleanup EXIT
curl --fail --location --retry 3 https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz -o "$steam_dir/steamcmd.tar.gz"
tar -xzf "$steam_dir/steamcmd.tar.gz" -C "$steam_dir"
# Bootstrap before staging credentials: SteamCMD may use a data directory separate
# from its executable, and its first update initializes that configuration.
if ! "$steam_dir/steamcmd.sh" +quit < /dev/null > "$steam_dir/bootstrap.log" 2>&1; then
  echo 'SteamCMD initialization failed before authentication.' >&2
  exit 1
fi
# Linux SteamCMD quotes this path: Logging directory: '/home/runner/Steam/logs'
steam_log_dir=$(tr -d '\r' < "$steam_dir/bootstrap.log" | sed -n "s/^Logging directory: '\{0,1\}\([^']*\)'\{0,1\}$/\1/p" | tail -n 1)
if [[ "$steam_log_dir" != "$RUNNER_TEMP/"* && "$steam_log_dir" != "$HOME/"* ]] || [[ "$steam_log_dir" == *'/../'* || "$steam_log_dir" != */logs ]]; then
  printf 'SteamCMD did not report an expected private data directory (got: %q).\n' "$steam_log_dir" >&2
  exit 1
fi
echo "SteamCMD data directory: ${steam_log_dir%/logs}"
config_path="${steam_log_dir%/logs}/config/config.vdf"
mkdir -p "$(dirname "$config_path")"
printf '%s' "$STEAM_CONFIG_VDF" | base64 --decode > "$steam_dir/session.vdf"
if [[ -f "$config_path" ]]; then
  cp "$config_path" "$steam_dir/config-before.vdf"
fi
config_staged=1
cp "$steam_dir/session.vdf" "$config_path"
chmod 600 "$config_path"
# Session config contains refresh credentials. Keep all Steam logs out of artifacts.
steam_status=0
"$steam_dir/steamcmd.sh" +login "$STEAM_USERNAME" +run_app_build "$PWD/artifacts/steam-build.vdf" +quit < /dev/null > "$steam_dir/upload.log" 2>&1 || steam_status=$?
success='Successfully finished AppID 5035580 build \(BuildID [0-9]+\)'
if (( steam_status != 0 )) || ! grep -Eq "$success" "$steam_dir/upload.log"; then
  printf 'Steam upload failed (SteamCMD exit code %s). No successful upload was confirmed.\n' "$steam_status" >&2
  # Emit only fixed diagnoses; raw log lines can contain authentication data.
  if grep -Eqi 'Invalid Password|No cached credentials' "$steam_dir/upload.log"; then
    echo 'Steam rejected the saved login. Export the session from Linux x86_64 SteamCMD with its matching Steam Guard machine record.' >&2
  elif grep -Eqi 'License expired|Expired' "$steam_dir/upload.log"; then
    echo 'The Steam session expired. Renew SteamCMD authentication and update the CI session secret.' >&2
  elif grep -Eqi 'RateLimitExceeded|Rate limit|Too many login' "$steam_dir/upload.log"; then
    echo 'Steam is limiting login attempts. Wait before trying again.' >&2
  elif grep -Eqi 'Access Denied|InvalidPermission|Permission Denied|Insufficient privilege' "$steam_dir/upload.log"; then
    echo 'Steam denied access. Check app permissions and depot ownership.' >&2
  elif grep -Eqi 'Steam Guard|two-factor|authenticator' "$steam_dir/upload.log"; then
    echo 'Steam requires authentication approval. Renew the SteamCMD session.' >&2
  fi
  exit 1
fi
grep -Eo "$success" "$steam_dir/upload.log"
