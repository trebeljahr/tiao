# Tiao mobile (Capacitor)

Capacitor wrapper that ships the Tiao Next.js client as native Android and
iOS apps. Sibling to `desktop/` (Electron).

How it fits together:

1. `pnpm run build:client` builds a static export of `../client` into
   `client/.next-mobile/` (`NEXT_PUBLIC_PLATFORM=mobile`) and writes a root
   `index.html` that redirects to the device locale.
2. `capacitor.config.ts` points `webDir` at that directory.
3. `cap sync` copies the export into the committed native projects in
   `android/` and `ios/`.
4. Gradle and Xcode build the apps. Store builds run in GitHub Actions.

Releases, secrets and store setup: [docs/releasing-mobile.md](../docs/releasing-mobile.md).

## Setup

```bash
pnpm --dir ../client install
pnpm install
pnpm run build:client
pnpm exec cap sync
```

Toolchains: Xcode 26 for iOS (Swift Package Manager, no CocoaPods), and
Android Studio or a JDK 21 plus the Android SDK (platform 36) for Android.
`scripts/android-env.sh` points Gradle at Android Studio's bundled JDK and
the default SDK path when `JAVA_HOME` / `ANDROID_HOME` are unset.

## Dev loop (live reload)

```bash
pnpm run dev:android   # emulator or attached phone
pnpm run dev:ios       # simulator
```

Both scripts start the Next.js dev server on `0.0.0.0:3100`, set
`CAP_DEV_URL` so the WebView loads from it, then `cap sync` and `cap run`.
They stop only the processes they started.

| Var | Default | Purpose |
| --- | --- | --- |
| `AVD` | `Medium_Phone_API_35` | Android Studio AVD to boot |
| `SIM` | `iPhone SE (3rd generation)` | iOS Simulator device |
| `NEXT_PORT` | `3100` | Next dev server port |
| `LAN_IP` | `10.0.2.2` on Android, `localhost` on iOS | Host the WebView connects to; use the Mac's LAN IP for a real phone |
| `NEXT_PUBLIC_MOBILE_API_URL` | `http://<DEV_HOST>:5005` | API URL baked into the dev bundle (production default `https://api.playtiao.com`) |

## Scripts

| Script | What it does |
| --- | --- |
| `build:client` | Static export of the client plus the locale redirect |
| `cap:sync` | `mobile:version`, `build:client`, `cap sync` |
| `mobile:version` | Writes `package.json` `version` (and `RELEASE_BUILD_NUMBER` if set) into the Xcode project. Android reads them in Gradle. |
| `build:android:release` | Signed AAB + APK, verified against the upload key. Needs `RELEASE_BUILD_NUMBER` and signing config. |
| `mobile:resources` | Regenerates the icon and splash masters in `resources/` from `../desktop/build/icon.png` (ImageMagick) |
| `mobile:assets` | Expands the masters into every Android density and the iOS asset catalog |
| `test:release` | Release tooling tests (Node and Python) |

## Native settings worth knowing

- Bundle ID / package `com.ricoslabs.tiao`, display name **Tiao**, team
  `4BHY8H2J25`.
- Version: `package.json` `version`. Build number: the CI `build_number`
  input (Android `versionCode`, iOS `CFBundleVersion`).
- Android: compile/target SDK 36, min SDK 24, R8 on release, no `AD_ID`,
  backup and device transfer off. Local release signing uses
  `android/keystore.properties` (copy the `.example`, git-ignored) or the
  `ANDROID_KEYSTORE_*` environment variables.
- iOS: `ITSAppUsesNonExemptEncryption = false` and `PrivacyInfo.xcprivacy`;
  both are checked by the release verifier.
- Deep link `tiao://auth/complete` is registered on both platforms for the
  OAuth return.
- Splash hides itself after 1 s. Background colour `#2a1d13` everywhere.
- The mobile build hides the Stripe shop (store payment rules).

`scripts/release/native-config.test.mjs` fails if a `cap` regeneration drops
any of the settings above.

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

The Capacitor CLI runs `cap sync` from the directory that holds
`capacitor.config.ts` and its `node_modules/@capacitor/*` plugins. Keeping
it out of `client/` stops every client install from pulling Capacitor.
`SKIP_MOBILE=1 pnpm install` at the repo root skips the mobile install.
