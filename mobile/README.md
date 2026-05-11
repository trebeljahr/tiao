# Tiao mobile (Capacitor)

Capacitor wrapper that ships the Tiao Next.js client as native Android
and iOS apps. Sibling to `desktop/` (Electron) — together they're the
non-web distribution targets.

The flow:

1. The Next.js client at `../client` builds a static export under
   `client/.next-mobile/` (set via `NEXT_PUBLIC_PLATFORM=mobile`).
2. `capacitor.config.ts` points `webDir` at that directory.
3. `cap sync` copies the export into the native projects under
   `mobile/android/` and `mobile/ios/`.
4. The native projects build APKs/AABs/IPAs the usual way.

## One-time bootstrap

The native projects (`android/`, `ios/`) are NOT in this commit — they
need a one-time generation on a machine with Android Studio and Xcode
installed.

```bash
cd mobile
pnpm install
pnpm run build:client          # produces ../client/.next-mobile/
pnpm exec cap add android      # creates ./android/
pnpm exec cap add ios          # creates ./ios/  (needs Xcode CLI tools)
pnpm exec cap sync             # copies the static export into both
```

After that, commit the freshly-generated `android/` and `ios/`
directories — Gradle plugins, AndroidManifest tweaks, signing config,
Info.plist customizations all live inside those trees and need to be
under version control.

## Dev loop (HMR)

```bash
# Android — emulator or attached phone
pnpm run dev:android

# iOS — simulator only (physical devices need Apple Dev signing)
pnpm run dev:ios
```

Both scripts:

1. Start the Next.js dev server (`pnpm --dir ../client dev`) bound to
   `0.0.0.0:3100` so the WebView on a different network namespace can
   reach it.
2. Set `CAP_DEV_URL` so `capacitor.config.ts` flips on `server.url`
   and the native WebView loads from the dev server instead of the
   bundled `.next-mobile/` folder.
3. `cap sync` and `cap run` the relevant platform.

Edits to `client/src/...` then hot-reload on the device in ~500ms with
no APK / IPA rebuild between changes.

### Env overrides

| Var | Default | Purpose |
| --- | --- | --- |
| `AVD` | `Medium_Phone_API_35` | Android Studio AVD name to boot |
| `SIM` | `iPhone SE (3rd generation)` | iOS Simulator device name |
| `NEXT_PORT` | `3100` | Next dev server port (matches the worktree's `autoPort` base) |
| `LAN_IP` | `10.0.2.2` on Android, `localhost` on iOS | Host the WebView connects to. Use your Mac's LAN IP for tests on a real phone over Wi-Fi |
| `NEXT_PUBLIC_MOBILE_API_URL` | `http://<DEV_HOST>:5005` | API base URL baked into the dev bundle (production default is `https://api.playtiao.com`, set in `client/next.config.mjs`) |

Workflow rule reminder: these dev scripts only SIGTERM the PIDs they
spawned themselves. They never `lsof | xargs kill` a port — the user's
main worktree dev server on `:3000` stays untouched.

## Release builds

### Android (Google Play / itch.io)

```bash
pnpm run build:android:release   # produces android/app/build/outputs/bundle/release/app-release.aab
pnpm run build:android:apk       # produces android/app/build/outputs/apk/release/app-release.apk
pnpm run itch:push:android       # pushes the APK to itch.io (needs $ITCH_USER, $ITCH_GAME, butler logged in)
```

Both reuse the env from `scripts/android-env.sh`, so you don't have to
launch Android Studio for a release build.

Signing config is configured directly inside `android/app/build.gradle`
once the native project is generated (`signingConfigs.release`). The
keystore itself stays out of git — `~/.gradle/gradle.properties` is the
canonical home for the storePassword / keyAlias / keyPassword secrets
(see `android/build.gradle`'s comments after bootstrap).

### iOS (App Store / TestFlight)

```bash
pnpm run build:ios:release   # opens Xcode pointing at the synced project
```

iOS release builds require:

1. An Apple Developer Program membership.
2. A Team ID configured in Xcode (Signing & Capabilities tab of the
   App target).
3. A distribution certificate + provisioning profile in your keychain.

Once those are in place, use Xcode's **Product → Archive** to produce
an `.ipa` and upload via the Organizer window. There's no headless
flow short of `xcodebuild archive` invoked from a CI runner with the
secrets pre-installed in its keychain — that's a future addition.

## App icons + splash

```bash
pnpm run mobile:assets
```

Generates the full icon + splash matrix from `resources/icon.png` and
`resources/splash.png` (1024×1024 source images). Drop those two files
into `mobile/resources/` before the first run.

## Background colour

`#2a1d13` — matches the existing tiao client shell brown. Defined in
`capacitor.config.ts` (`backgroundColor` + splash plugin) so the
launch transition from splash → app doesn't flash a different hue.

## API URL

Capacitor has no preload bridge equivalent to Electron's
`window.electron.config.apiUrl`. The API URL is therefore baked in at
build time via `NEXT_PUBLIC_MOBILE_API_URL` (see
`client/next.config.mjs`, default `https://api.playtiao.com`). Override
for dev/staging by exporting the var before `pnpm run build:client`.

## Why `mobile/` is a sibling of `desktop/`

Same reason: the Capacitor CLI expects `cap sync` to run from the
directory that contains `capacitor.config.ts` and its
`node_modules/@capacitor/*` plugin set. Putting it under `client/` or
`server/` would force every install of those packages to pull
Capacitor too, even for `dev:web` flows that don't touch mobile.

`SKIP_MOBILE=1 pnpm install` in the repo root skips the mobile install
for contributors who only care about web/desktop.
