# Releasing Tiao desktop

Build local artifacts or dispatch `build-desktop.yml` from `main`. Publishing is
separate: `publish-desktop.yml` verifies a successful signed build's provenance
and checksums, then uploads those exact artifacts. Tags do not trigger releases.
Remote dispatches, publishing and uploads require an explicit request.

## Channels

| Channel | Outputs | Updates |
| --- | --- | --- |
| direct | macOS universal app, DMG and ZIP; Windows NSIS and portable EXE; Linux AppImage | Optional Tauri updater |
| itch | macOS/Windows ZIP; Linux AppImage | itch/butler |
| steam | macOS app, Windows executable + SDK, Linux AppDir + launcher | SteamPipe |
| steam-demo | Separate demo app and AppID, same depot layouts | SteamPipe |
| mas | Universal sandboxed macOS app and signed pkg | Mac App Store |
| msstore | Windows AppX with native Store APIs | Microsoft Store |

Tauri replaces Electron. `TIAO_DISTRIBUTION_CHANNEL` is compiled into each
binary; `tiao-build.json` accompanies the app for artifact validation. Steam
AppIDs come from `desktop/steam-apps.json`: 5035580 (full), 5491870 (demo).
The demo uses bundle identifier `com.ricoslabs.tiao.demo` and name `Tiao Demo`.
The renderer retains the `window.electron` compatibility API without shipping
Electron or Node.

## Local builds

Install Rust, Node/pnpm and the platform's Tauri prerequisites. macOS universal
builds require both `aarch64-apple-darwin` and `x86_64-apple-darwin` Rust targets.
Linux needs WebKitGTK 4.1, GTK, OpenSSL, DBus, GStreamer and `patchelf`.

```sh
pnpm --dir desktop install --frozen-lockfile
pnpm --dir desktop package
pnpm --dir desktop package:steam-demo
```

`desktop/dist/<channel>/` contains the result. `TIAO_TARGET` may select a single
Mac architecture for local checks; release legs build universal apps.
`desktop/scripts/release/package.mjs <platform> <signed|smoke>` builds all
channels of one release leg from a prebuilt desktop frontend.

Steam's SDK 1.64 redistributables are selected from a SHA-256-pinned archive.
`STEAM_SDK_ARCHIVE` accepts a cached archive. Store builds never ship the SDK.
The Linux depot extracts an AppImage so Steam needs no FUSE mount; Mesozoic's
runtime dependency validation retains WebKit/font libraries and excludes driver
and platform libraries. Its launcher preserves explicit renderer overrides.

Local Steam workflows stay available through `pnpm steam:local:build`,
`steam:local:stage`, `steam:local:prepare`, and `steam:local:serve`. They never
upload or change Steam client settings. Full and demo builds stay separate.

## Versions and signatures

`pnpm --dir desktop version:set X.Y.Z` updates the root/desktop packages,
Tauri configuration and Cargo package version. `version:check` rejects drift.
Use a new integer `TIAO_BUILD_NUMBER` for each Mac App Store upload.

`TIAO_SIGNED=1` enables platform signing. Apple builds import `CSC_LINK` and
`CSC_KEY_PASSWORD` into an isolated temporary keychain, restore the original
search list and delete temporary material when done. Developer ID builds use
Apple API credentials for notarization. MAS builds additionally need
`MAS_PROVISIONING_PROFILE`, `TIAO_BUILD_NUMBER`, and an installer identity
(`MAS_INSTALLER_IDENTITY`, defaulting to Ricos Labs' installer certificate).
The certificate bundle must contain the corresponding signing identities.
Unsigned builds use ad-hoc signing and never request notarization credentials.

Windows direct/itch/Steam builds keep Azure Artifact Signing through the
existing PowerShell signer. Microsoft Store builds need the reserved identity,
publisher and publisher display name. Partner Center signs the AppX.
Verification scripts check signed app identity, entitlements, architectures,
notarization, timestamps and artifact digests before publication.

## Updates and migration

Self-updates are disabled by default. Only `direct` may compile the updater.
`TIAO_ENABLE_UPDATER=1` additionally requires `TIAO_UPDATER_PUBLIC_KEY` and an
HTTPS `TIAO_UPDATER_ENDPOINT`, plus the Tauri signing key when packaging updater
artifacts. Electron's update feeds and signatures cannot update Tauri builds.
A first Tauri release needs a direct installer handover for existing users.

The new app leaves Electron storage intact. Native sessions use the OS
credential store; Steam sessions remain memory-only and reauthenticate with
fresh native tickets. Players must sign in again on the first Tauri launch.
The server accepts both old Electron origins and Tauri origins during migration;
its native WebSocket exceptions still require a valid bearer token.

## Validation

Run desktop JavaScript/release tests, Rust unit tests, Cargo check, and the
frontend production build. CI builds each native platform and store variant.
Set `TIAO_KEYCHAIN_ACCESS=deny` for tests and automated launches. Unit tests
never access real credentials, buy products or unlock Steam achievements.
A debug-only `TIAO_SMOKE_REPORT=<absolute-path>` launch uses a separate app
identity, hides its window, checks native IPC and bundled routes, writes JSON,
and exits. Set `TIAO_KEYCHAIN_ACCESS=deny` alongside it.

Actual store purchases and signed distribution must be checked in their native
store environments before release; macOS checks do not establish Windows or
Linux runtime behavior. Release workflow dispatches are not part of a local
migration unless explicitly requested.
