# Releasing the mobile apps

Tiao ships to the App Store (via TestFlight) and Google Play from GitHub
Actions. Two manual workflows do the work:

| Workflow | File | What it does |
| --- | --- | --- |
| Build mobile apps | `.github/workflows/build-mobile.yml` | Builds signed store files (or an unsigned smoke build), verifies them, and saves them with a SHA-256 manifest and build provenance. |
| Upload tested mobile build | `.github/workflows/publish-mobile.yml` | Takes the run ID of a successful signed build, checks its provenance and checksums, and uploads the store file to Play or TestFlight. |

Both workflows refuse to sign or upload unless they were dispatched from
`main` in `trebeljahr/tiao`. The pipeline is a port of Raptor Runner's
release tooling.

| Item | Value |
| --- | --- |
| Bundle ID / package | `com.ricoslabs.tiao` |
| Apple team | Ricos Labs LLC, `4BHY8H2J25` |
| Version | `mobile/package.json` `version` (X.Y.Z) |
| Build number | Workflow input `build_number`. One integer for both stores. |
| API | `https://api.playtiao.com`, baked into the static export |

## Release steps

1. Bump `version` in `mobile/package.json` when the release changes the
   user-facing version. Commit it to `main`.
2. Run **Build mobile apps** on `main` with `mode=signed`, the platform, and a
   `build_number` higher than every build already in Play Console and
   TestFlight. The same number becomes the Android `versionCode` and the iOS
   `CFBundleVersion`.
3. Run **Upload tested mobile build** with the build's run ID:
   - `destination=testflight` uploads the IPA to App Store Connect.
   - `destination=play` uploads the AAB and R8 mapping to the chosen track.
     Start with `play_track=internal`, `play_status=draft`. Production
     uploads always stay drafts; roll them out from Play Console.
4. Finish the release in App Store Connect / Play Console (tester groups,
   review, rollout). An upload is not a store submission.

`mode=smoke` needs no secrets. It compiles a debug APK and an unsigned iOS
build to prove the native projects still compile.

## What the build verifies

- Android: the AAB passes `jarsigner -verify` with no unsigned entries. The
  APK passes `apksigner`. Both signer digests match the configured upload
  key, so a debug key can never reach Play.
- iOS: the IPA is signed by an Apple Distribution identity of team
  `4BHY8H2J25`, embeds an App Store profile for `com.ricoslabs.tiao`, and
  carries the expected version, build number, `ITSAppUsesNonExemptEncryption
  = false`, the `tiao` URL scheme and a valid `PrivacyInfo.xcprivacy`.
- The signing step checks the provisioning profile (team, bundle, App Store
  type, expiry) and that the `.p12` private key matches the profile's
  certificate before anything compiles.

## GitHub configuration

### Secrets

Repository secrets used by **Build mobile apps** (`mode=signed`):

| Secret | Content |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -i tiao-upload.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Upload key alias |
| `ANDROID_KEY_PASSWORD` | Upload key password |
| `APPLE_CERTIFICATE_BASE64` | Apple Distribution certificate with private key, as `.p12`, base64 |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` export password |
| `APPLE_PROVISIONING_PROFILE_BASE64` | App Store provisioning profile for `com.ricoslabs.tiao`, base64 |

Environment secrets used by **Upload tested mobile build**:

| Environment | Secret | Content |
| --- | --- | --- |
| `release-play` | `PLAY_SERVICE_ACCOUNT_JSON` | Service account JSON key with release access to the Tiao app in Play Console |
| `release-testflight` | `APPLE_API_KEY_BASE64` | App Store Connect API key (`AuthKey_XXXX.p8`), base64 |
| `release-testflight` | `APPLE_API_KEY_ID` | Key ID |
| `release-testflight` | `APPLE_API_ISSUER_ID` | Issuer ID |

Restrict both environments to the `main` branch and, if wanted, add a
required reviewer. A missing secret fails the job by name before any value
is decoded, because an unset secret would otherwise decode to an empty file.

The team-wide Apple Distribution certificate and API key can be shared with
other Ricos Labs apps. The provisioning profile is per app.

### Variables

| Variable | Purpose |
| --- | --- |
| `MOBILE_OPENPANEL_CLIENT_ID` | OpenPanel client for the apps. Empty disables analytics. The client must allow the origins `capacitor://localhost` (iOS) and `https://localhost` (Android). |

The API URL, OpenPanel API URL, GlitchTip DSN and creator IDs are public
values set in the workflow `env`, matching the web build.

## One-time store setup

### Apple

1. Confirm the App ID `com.ricoslabs.tiao` exists under team `4BHY8H2J25`
   (it is shared with the desktop build).
2. Create an **App Store** provisioning profile for that App ID with the
   team's Apple Distribution certificate. Export the certificate and its
   private key as a `.p12`.
3. Create the app record in App Store Connect if it does not exist yet.
4. Create an App Store Connect API key with the Developer role (upload only).
5. In App Store Connect, answer the App Privacy questions so they match
   `mobile/ios/App/App/PrivacyInfo.xcprivacy` (see below).

### Google Play

1. Create the app with package `com.ricoslabs.tiao` and enroll in Play App
   Signing.
2. Generate an upload key once and back it up outside this repository.
   Losing it requires Google's upload-key reset.

   ```bash
   keytool -genkeypair -v -keystore tiao-upload.keystore -alias tiao \
     -keyalg RSA -keysize 2048 -validity 10000
   ```

3. Create a service account in Google Cloud, invite it in Play Console with
   release permissions for Tiao, and store its JSON key as
   `PLAY_SERVICE_ACCOUNT_JSON`.
4. The very first AAB may need a manual upload in Play Console before the
   API accepts uploads. Complete the store listing, content rating, target
   audience and Data safety form (see below).

## Privacy declarations

The app collects data, so the store forms must say so. The privacy manifest
declares, with no tracking:

| Data | Linked to user | Purpose | Source |
| --- | --- | --- | --- |
| Email address, name | Yes | App functionality, analytics | Account sign-up; OpenPanel `identify` |
| User ID | Yes | App functionality, analytics | Player ID; OpenPanel profile; GlitchTip user |
| Photos | Yes | App functionality | Optional profile picture |
| Gameplay content | Yes | App functionality | Games, moves, ratings, tournaments |
| Product interaction | Yes | Analytics | OpenPanel events, after consent |
| Coarse location | Yes | Analytics | OpenPanel IP geolocation |
| Crash data, diagnostics | Yes | App functionality | GlitchTip |

Required-reason APIs: UserDefaults (`CA92.1`) and file timestamps (`C617.1`).
Update the manifest, the App Privacy answers and the Play Data safety form
together whenever data collection changes.

## Native project notes

- Native projects live in `mobile/android/` and `mobile/ios/` and are
  committed. `cap sync` refreshes the copied web bundle and plugin lists.
- Android: compile/target SDK 36, min SDK 24, R8 minify and resource
  shrinking on release, `AD_ID` permission removed, backup and device
  transfer disabled. Release builds fail without `RELEASE_BUILD_NUMBER` and
  a complete signing set (environment variables or `android/keystore.properties`).
- iOS: Swift Package Manager (no CocoaPods), deployment target 15.0,
  `ITSAppUsesNonExemptEncryption = false`, portrait and landscape.
- The app does not set `viewport-fit=cover`. iOS keeps the page inside the
  safe area, and on Android 15+ Capacitor pads the WebView out of the
  system bars, so content never draws under the status bar.
- Routing: Capacitor would serve the root `index.html` for every page
  path. Native routers (`ios/App/App/TiaoRoutes.swift` via
  `MainViewController`, `android/.../TiaoRoutes.java` via
  `TiaoWebViewClient`) serve each route's own page instead. Paths without
  a locale use `en` (next-intl `as-needed`), and dynamic routes such as
  `/game/<id>/` get the `__spa__` page, whose view reads the real id with
  `useDynamicParam`. The URL keeps the real path, so reloads, back
  navigation and client-side links work. Unknown paths get the root
  shell (`scripts/index-redirect.js`), which redirects to the locale
  home. Both routers are tested against `scripts/routes-cases.txt`
  (`pnpm run test:release`, and `./gradlew testDebugUnitTest`).
- Deep links: `tiao://<path>` and `https://playtiao.com/<path>` open the
  page in the app, including on cold start
  (`client/src/components/NativeDeepLinkHandler.tsx`).
  `tiao://auth/complete` is registered on both platforms for the OAuth
  return; those URLs go to `onAuthDeepLink` in
  `client/src/lib/nativeDeepLinks.ts`, never to navigation.
- The mobile build hides the Stripe shop: store rules require in-app
  purchase for digital goods.

## Local builds

```bash
cd mobile
pnpm run test:release                      # release tooling tests
pnpm run build:client && pnpm exec cap sync # web bundle into both projects
(source scripts/android-env.sh && cd android && ./gradlew assembleDebug)
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build
```

A local signed Android release needs `android/keystore.properties` (copy the
`.example`) or the `ANDROID_KEYSTORE_*` variables, then
`RELEASE_BUILD_NUMBER=<n> pnpm run build:android:release`.
Signed iOS builds run in CI; locally, archive from Xcode with automatic
signing.
