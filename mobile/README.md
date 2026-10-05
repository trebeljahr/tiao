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

## First-time bootstrap (mac)

The native projects (`android/`, `ios/`) are NOT in this commit — they
need a one-time generation on a machine with Android Studio and Xcode
installed. Follow these steps in order:

1. **Add icon + splash masters**: drop a 1024×1024 `icon.png` and a
   2732×2732 `splash.png` into `mobile/resources/`
   (see `resources/README.md` for export instructions from the Tiao
   SVG sources).
2. **Install deps**: `pnpm install`
3. **Build the renderer**: `pnpm run build:client`
   (produces `../client/.next-mobile/`, the static export Capacitor
   bundles into the WebView).
4. **Add native projects** (one time only):
   - `pnpm exec cap add android` — requires Android Studio + SDK
   - `pnpm exec cap add ios` — requires Xcode (mac only)
5. **Generate platform icons + splashes**: `pnpm run mobile:assets`
   (expands the two masters into every Android density + iOS appiconset
   slot inside the freshly-generated native trees).
6. **Generate Android keystore** (one time, keep it safe — losing it
   means you can never push an update to an already-published listing):
   ```bash
   keytool -genkey -v -keystore release.keystore \
     -alias tiao -keyalg RSA -keysize 2048 -validity 10000
   ```
7. **Set signing env** in your shell rc:
   - `TIAO_KEYSTORE_PATH` — absolute path to `release.keystore`
   - `TIAO_KEYSTORE_PASSWORD`
   - `TIAO_KEY_ALIAS` (defaults to `tiao` if unset)
   - `TIAO_KEY_PASSWORD`
8. **Append signing config**: copy the contents of
   `android-signing.gradle.template` into `android/app/build.gradle`
   (merge the `android { signingConfigs { … } buildTypes { … } }`
   blocks with whatever Capacitor scaffolded).
9. **Sync + build**:
   `pnpm exec cap sync android && pnpm run build:android:release`

After that, commit the freshly-generated `android/` and `ios/`
directories — Gradle plugins, AndroidManifest tweaks, signing config,
Info.plist customizations all live inside those trees and need to be
under version control. The `.gitignore` already excludes build outputs
and secrets, so a plain `git add android/ ios/` is safe.

## iOS

1. Open `ios/App/App.xcworkspace` in Xcode.
2. Select your team in **Signing & Capabilities** (uses your Apple
   Developer account).
3. **Product → Archive → Distribute App → App Store Connect**.

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
   App target). The bundle id is `com.ricoslabs.tiao` (from
   `capacitor.config.ts`, shared with the desktop build), registered
   under the Ricos Labs LLC team `4BHY8H2J25`.
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

## Social sign-in (system browser + deep link)

Google refuses OAuth inside embedded WebViews (`disallowed_useragent`),
so the app never runs a provider flow in its own WebView. Tapping
Apple / Google / GitHub / Discord calls `startMobileOAuth()` in
`client/src/lib/mobileAuth.ts`, which:

1. creates a random `state` and a PKCE verifier and keeps them in
   Capacitor Preferences;
2. opens `https://api.playtiao.com/api/auth/desktop/start?provider=…&state=…&code_challenge=…&code_challenge_method=S256`
   with `@capacitor/browser` (SFSafariViewController / Chrome Custom Tab);
3. receives `tiao://auth/complete?state=…&code=…` through
   `@capacitor/app`'s `appUrlOpen` event (or `getLaunchUrl()` after a cold
   start), closes the browser, and POSTs `{state, code, code_verifier}` to
   `/api/auth/desktop/exchange`;
4. stores the returned revocable bearer token in Preferences and sends it
   as `Authorization: Bearer` on every API call and as `?token=` on the
   WebSocket, exactly like the desktop app.

The server side is the desktop bridge plus PKCE: any app can claim the
`tiao://` scheme on a phone, so an intercepted deep link is useless
without the verifier that never leaves this app. Logout calls
`/api/auth/desktop/logout` before the token is forgotten.

The native projects need the `tiao` URL scheme registered. `cap add`
does not do this; add it once after generating `ios/` and `android/`.

**iOS — `ios/App/App/Info.plist`** (inside the top-level `<dict>`):

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key>
    <string>com.ricoslabs.tiao.auth</string>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>tiao</string>
    </array>
  </dict>
</array>
```

Capacitor's generated `AppDelegate.swift` already forwards
`application(_:open:options:)` to `ApplicationDelegateProxy`, which is
what fires `appUrlOpen`. Keep that method if you edit the delegate.

**Android — `android/app/src/main/AndroidManifest.xml`**, inside the
existing `<activity android:name=".MainActivity" …>` (keep its
`android:launchMode="singleTask"` so the callback reaches the running
activity instead of starting a second one):

```xml
<intent-filter android:autoVerify="false">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="tiao" android:host="auth" />
</intent-filter>
```

Then `pnpm run cap:sync` so `@capacitor/browser` is linked into both
projects.

Sign in with Apple uses the same web flow on iOS. That satisfies App
Store guideline 4.8; a native `ASAuthorizationController` button would
need an extra Capacitor plugin and the server already accepts ID tokens
for the bundle ID `com.ricoslabs.tiao` if that is added later.

The token lives in Capacitor Preferences (UserDefaults /
SharedPreferences): sandboxed per app, but not Keychain-encrypted like
the desktop build's `safeStorage`. Moving it to a Keychain / Keystore
plugin is a possible hardening step.

## Why `mobile/` is a sibling of `desktop/`

Same reason: the Capacitor CLI expects `cap sync` to run from the
directory that contains `capacitor.config.ts` and its
`node_modules/@capacitor/*` plugin set. Putting it under `client/` or
`server/` would force every install of those packages to pull
Capacitor too, even for `dev:web` flows that don't touch mobile.

`SKIP_MOBILE=1 pnpm install` in the repo root skips the mobile install
for contributors who only care about web/desktop.
