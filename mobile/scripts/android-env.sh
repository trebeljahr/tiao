#!/usr/bin/env bash
#
# Source-this helper that sets the env vars Gradle + Capacitor need
# to build Android without Android Studio being open.
#
#   - JAVA_HOME: points at Android Studio's bundled JetBrains Runtime
#     so we don't need a system-wide JDK. Same path Android Studio
#     itself uses for Gradle — no mismatch risk.
#   - ANDROID_HOME: the SDK root. Android Studio installs here on Mac
#     by default.
#
# Usage from an npm script:
#     source scripts/android-env.sh && <command>
#
# The paths are Mac-specific (Intel and Apple Silicon share them).
# If Android Studio was installed somewhere non-standard, override
# via your shell profile before running npm.

if [ -z "$JAVA_HOME" ]; then
  export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
fi
if [ -z "$ANDROID_HOME" ]; then
  export ANDROID_HOME="$HOME/Library/Android/sdk"
fi
if [ -z "$ANDROID_SDK_ROOT" ]; then
  export ANDROID_SDK_ROOT="$ANDROID_HOME"
fi

# Put emulator + platform-tools on PATH so children can call adb and
# emulator by short name without hardcoding.
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
