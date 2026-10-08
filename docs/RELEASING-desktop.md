# Releasing the Tiao desktop app

Build once, test the artifacts, then publish that exact workflow run. Every
release workflow is a manual GitHub Actions dispatch on `main`. Tag pushes do
not build, sign or publish anything. The pipeline is a port of Raptor Runner's
proven desktop release flow, plus Mac App Store and Microsoft Store builds.

## Storefronts

| Channel   | Build leg | Outputs                                         | Signing                                   | Updates               |
| --------- | --------- | ----------------------------------------------- | ----------------------------------------- | --------------------- |
| `direct`  | macos, windows, linux | DMG + ZIP (universal), NSIS + portable EXE (x64), AppImage (x64) | Developer ID + notarization; Azure Artifact Signing; GitHub provenance | electron-updater, off unless `TIAO_ENABLE_UPDATER=1` |
| `itch`    | macos, windows, linux | ZIP (mac), ZIP (win), AppImage (linux)          | same as direct                            | butler / itch app     |
| `steam`   | macos, windows, linux | unpacked app depots (`.tar.gz` in the artifact) | same as direct                            | SteamPipe             |
| `mas`     | mas       | `.pkg` (universal, App Sandbox)                 | Apple Distribution + Mac Installer Distribution | Mac App Store   |
| `msstore` | msstore   | `.appx` (x64)                                   | none; Partner Center signs on submission  | Microsoft Store       |

Each channel is a separate electron-builder run with the channel baked into the
packaged `package.json` (`distributionChannel`; the Steam build also bakes
`steamBuild: true` and `steamAppId: 5035580`). The renderer reads it from
`window.electron.config.distributionChannel`. `collect.mjs` reads the baked
metadata out of every `app.asar` and fails the build if a channel, Steam flag
or appid is wrong, or if a store build contains `steamworks.js`.

macOS builds are universal. The Mac App Store takes one binary per build, and
a universal Steam depot needs no architecture launcher script (Raptor Runner
ships split arm64/x64 apps plus a launcher; Tiao does not need to).

Windows and Linux are x64 only: `steamworks.js` ships x64 binaries there.

## Version

`desktop/package.json` `version` is the release version. The repository root
`package.json` mirrors it. Use a stable `X.Y.Z` that no store has seen.

```bash
cd desktop
npm run version:set -- 0.2.0
npm run version:check     # CI runs this in the plan job
```

The Mac App Store version must match the App Store Connect version record
(`1.0.0` for the first release). Each Mac App Store upload also needs a new
`CFBundleVersion`: the `mas` leg writes the workflow's `build_number` input
there, or the run number when the input is empty. A re-upload of the same
version therefore only needs a new build run. The Microsoft Store refuses a
version it already accepted, so bump the version before an msstore re-upload.

## Build: "Build desktop binaries" (build-desktop.yml)

Inputs:

- `platform`: `all` (default), `desktop` (macos + windows + linux), `stores`
  (mas + msstore), or one leg.
- `mode`: `signed` requires `main` and every credential of each selected leg;
  `smoke` builds unsigned artifacts that the publisher never accepts.
- `build_number` (optional): the Mac App Store `CFBundleVersion`. Empty uses
  the run number, which only grows. Set it only to jump above an earlier
  upload.

```sh
gh workflow run build-desktop.yml --ref main -f platform=all -f mode=signed
gh workflow run build-desktop.yml --ref main -f platform=desktop -f mode=signed   # until store identities exist
gh workflow run build-desktop.yml --ref main -f platform=all -f mode=smoke
```

Pull requests touching `desktop/**` run every leg in smoke mode.

The plan job checks the version, runs the release-tool tests and validates the
Steam achievement API names. Each build leg then:

1. builds the desktop static export of `client/` and stages `desktop/client-bundle/`;
2. runs `desktop/scripts/release/package.mjs <leg> <mode>` (one electron-builder run per channel);
3. verifies signatures (signed mode):
   - macOS: `verify-macos.sh` checks team `4BHY8H2J25`, hardened runtime,
     `spctl` "Notarized Developer ID", stapler and universal slices on the app
     in the DMG, both ZIPs and every unpacked app (Steam depot source);
   - Mac App Store: `verify-mas.sh` checks the Apple Distribution signature,
     sandbox + app group + application identifier entitlements, the embedded
     provisioning profile, no Steam files, and `pkgutil --check-signature` on
     the pkg;
   - Windows: `verify-windows-signatures.ps1` checks Ricos Labs LLC
     Authenticode and timestamps on the installer, portable EXE, all unpacked
     apps, the app inside the itch ZIP, and the installed app and uninstaller;
   - Microsoft Store: the AppX identity must match the Partner Center variables;
4. collects the files, a `manifest-<leg>.json` and `SHA256SUMS-<leg>.txt`;
5. signs build provenance (`actions/attest`) and uploads artifact
   `release-<platform>-<arch>` (signed) or `smoke-<platform>-<arch>`, kept 30 days.

Never infer signing success from a green packaging step. The verify steps are
the evidence.

## Publish: "Publish tested desktop build" (publish-desktop.yml)

Inputs: `run_id` (a successful signed build run), `destination`, and
`steam_branch`. The publisher checks the run is a successful `main` dispatch of
build-desktop.yml in `trebeljahr/tiao`, verifies the signed provenance of every
manifest (signer workflow, `main`, exact commit, hosted runners), and re-hashes
every file. It never rebuilds.

```sh
gh workflow run publish-desktop.yml --ref main -f run_id=RUN_ID -f destination=downloads-draft
gh workflow run publish-desktop.yml --ref main -f run_id=RUN_ID -f destination=itch
gh workflow run publish-desktop.yml --ref main -f run_id=RUN_ID -f destination=steam -f steam_branch=beta
gh workflow run publish-desktop.yml --ref main -f run_id=RUN_ID -f destination=mas
gh workflow run publish-desktop.yml --ref main -f run_id=RUN_ID -f destination=msstore
```

| Destination       | Needs legs            | What it does |
| ----------------- | --------------------- | ------------ |
| `downloads-draft` | macos, windows, linux | Requires tag `desktop-vX.Y.Z` at the build commit (`npm run release:tag`, then push the tag). Creates a draft GitHub Release with the direct files, update metadata, manifests and `SHA256SUMS.txt`. Never retags or overwrites. Publish the draft by hand. |
| `itch`            | macos, windows, linux | `butler push` to `ricoslabs/tiao`, channels `osx-universal`, `windows`, `linux`, with `--userversion X.Y.Z`. |
| `steam`           | macos, windows, linux | Unpacks the three depots, writes the app build VDF for app `5035580`, runs SteamCMD. Empty `steam_branch` sets the `STEAM_DEFAULT_BRANCH` variable's branch live (upload only when it is unset); `-` uploads without setting a build live; a beta branch sets that branch live. `default` is refused: promote to default in Steamworks. Success is the `Successfully finished AppID 5035580 build` line, never the exit code. SteamCMD output is never printed. |
| `mas`             | mas                   | macOS runner. `xcrun altool --upload-app -t macos` with the App Store Connect API key. Review, TestFlight and release stay in App Store Connect. |
| `msstore`         | msstore               | With all five Partner Center API values set: `msstore publish --noCommit` creates a draft submission with the AppX. With none set: a notice, and you upload the AppX from the build run in Partner Center. A partial set fails. |

## Configuration

Build credentials are repository secrets (the build job has no environment, see
"Windows signing"). Publisher credentials can be scoped to their environment.
Create the environments `release-downloads-draft`, `release-itch`,
`release-steam`, `release-mas` and `release-msstore`, each with a `main`-only
deployment branch rule and any reviewers you want. The scripts also check
`main` themselves; an environment name alone is not approval protection.

### Repository secrets (build)

| Secret | Leg | Value |
| --- | --- | --- |
| `MAC_CSC_LINK` | macos | base64 `.p12`: Developer ID Application, Ricos Labs LLC (4BHY8H2J25), with private key |
| `MAC_CSC_KEY_PASSWORD` | macos | its password |
| `APPLE_API_KEY_BASE64` | macos (notarize), mas publish | base64 App Store Connect `.p8` API key (team-wide key, App Manager) |
| `APPLE_API_KEY_ID` | macos, mas publish | key ID |
| `APPLE_API_ISSUER_ID` | macos, mas publish | issuer UUID |
| `MAS_CSC_LINK` | mas | base64 `.p12` holding **both** Apple Distribution and Mac Installer Distribution identities (Track Your Time's proven layout; the certificates are team-wide) |
| `MAS_CSC_KEY_PASSWORD` | mas | its password |
| `MAS_PROVISIONING_PROFILE_BASE64` | mas | base64 Mac App Store profile for `com.ricoslabs.tiao`. It must contain the Apple Distribution certificate inside `MAS_CSC_LINK`. |

Build `.p12` files with `/usr/bin/openssl` (LibreSSL) and include the Apple WWDR
intermediate. macOS cannot import an OpenSSL 3 `.p12` ("MAC verification
failed"). Mac App Store signing on electron-builder 26 looks for
"Apple Distribution" and "3rd Party Mac Developer Installer" identities; the
Mac Installer Distribution certificate carries the latter name.

### Repository variables (build)

| Variable | Value |
| --- | --- |
| `WINDOWS_STORE_IDENTITY_NAME` | Partner Center → Tiao → Product identity → Package/Identity/Name |
| `WINDOWS_STORE_PUBLISHER` | Package/Identity/Publisher (`CN=…`) |
| `WINDOWS_STORE_PUBLISHER_DISPLAY_NAME` | Package/Properties/PublisherDisplayName (Ricos Labs LLC) |

A signed `msstore` leg fails without all three. A smoke build uses placeholders.

### Environment secrets and variables (publish)

| Environment | Secrets | Variables |
| --- | --- | --- |
| `release-downloads-draft` | none (uses `GITHUB_TOKEN`) | none |
| `release-itch` | `BUTLER_API_KEY` | `ITCH_USER=ricoslabs`, `ITCH_GAME=tiao` |
| `release-steam` | `STEAM_USERNAME`, `STEAM_CONFIG_VDF` | `STEAM_DEPOT_WINDOWS`, `STEAM_DEPOT_MACOS`, `STEAM_DEPOT_LINUX` (three distinct depot IDs of app 5035580); optional `STEAM_DEFAULT_BRANCH` (`internal`) |
| `release-mas` | `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER_ID` (or rely on the repository secrets) | none |
| `release-msstore` | `MSSTORE_TENANT_ID`, `MSSTORE_CLIENT_ID`, `MSSTORE_CLIENT_SECRET`, `MSSTORE_SELLER_ID` (optional) | `MSSTORE_PRODUCT_ID` (optional; all five or none) |

### Windows signing (Azure Artifact Signing, GitHub OIDC)

| Setting | Value |
| --- | --- |
| Application (client) ID | `3b02aa37-f2ac-45aa-a6c2-112f54f2c189` (`tiao-github-signing`) |
| Tenant | `ce0c906e-8a84-4877-afd9-cdf103ddaacb` |
| Subscription | `4aaef5a5-286b-46a0-b9e4-84622e8fdc4f` |
| Account / profile | `ricoslabs-signing` / `ricoslabs-public` |
| Endpoint | `https://weu.codesigning.azure.net/` |
| Federated subject | `repo:trebeljahr/tiao:ref:refs/heads/main` (credential `tiao-main`) |
| Publisher | Ricos Labs LLC |

These IDs are configuration, not secrets. `azure/login` establishes an Azure
CLI session; electron-builder calls `desktop/scripts/sign-windows.cjs`, which
runs the pinned `ArtifactSigning` 0.1.20 module with only the Azure CLI
credential enabled. Every file, including the embedded NSIS uninstaller, is
checked for a valid, timestamped Ricos Labs LLC signature as it is signed.
electron-builder's native `azureSignOptions` (still in 26.17) installs the old
`TrustedSigning` module and expects `AZURE_*` environment credentials, not the
CLI OIDC session, which is why the hook exists.

The build job deliberately has **no** `environment:`. With an environment the
OIDC subject becomes `repo:trebeljahr/tiao:environment:<name>` and Azure
rejects the login. Add a matching federated credential before adding one.
The `tiao-windows-verification` credential for the old
`codex/windows-signing-verify` branch is no longer needed and can be deleted.

### Steam

App `5035580` (Ricos Labs LLC). In Steamworks:

1. Create three depots (Windows, macOS, Linux), add them to the app's
   packages, set their OS filters, and put their IDs in the `release-steam`
   variables.
2. Launch options:

   | OS | Executable |
   | --- | --- |
   | Windows | `Tiao.exe` |
   | macOS | `Tiao.app` |
   | Linux | `tiao` |

3. The builder account needs Edit App Metadata and Publish App Changes To
   Steam. Valve recommends a dedicated builder account.

**`STEAM_CONFIG_VDF` must come from Linux x86_64 SteamCMD.** A session exported
from macOS SteamCMD fails on the hosted Linux runner with "Invalid Password".
Log in once with Valve's SteamCMD on a Linux x86_64 machine under a throwaway
HOME, then store the base64 `config.vdf`:

```bash
HOME=~/steam-ci ./steamcmd.sh +login ACCOUNT +quit     # complete Steam Guard
ssh HOST 'base64 -w0 ~/steam-ci/Steam/config/config.vdf' | gh secret set STEAM_CONFIG_VDF --env release-steam
```

A reusable Linux session for the shared builder account already exists at
`~/keys/steam-ci-ricotrebeljahr-linux-config.vdf` (Raptor Runner uses it):
`base64 -i ~/keys/steam-ci-ricotrebeljahr-linux-config.vdf | gh secret set STEAM_CONFIG_VDF --env release-steam`.
That account must have the permissions above on app 5035580. The file contains
refresh credentials: never commit it or upload it as an artifact. Renew it when
the upload reports an expired session or Steam Guard asks again. A browser login
does not replace it.

Valve refuses automatic set-live on `default`, so test builds go to a private
`internal` beta branch. Steamworks only offers branch creation once the app has
a build, so the first time:

1. Publish with `-f steam_branch=-` (upload only).
2. In Steamworks → SteamPipe → Builds, create branch `internal` with a password
   or as private, then set the uploaded build live on it.
3. `gh variable set STEAM_DEFAULT_BRANCH --env release-steam --body internal`.

After that an empty `steam_branch` sets every upload live on `internal`.

Verify launch, overlay, achievements, stats and Steam Cloud through a beta
branch install before promoting a build to `default` in Steamworks.

`desktop/steam_appid.txt` (`5035580`) exists for `npm run dev` only. It is not
packaged, and the depot script excludes it.

### Mac App Store

- App ID `com.ricoslabs.tiao`, team `4BHY8H2J25`. Create the macOS app record
  in App Store Connect (category Games → Board) before the first upload.
- Profile: a Mac App Store provisioning profile for `com.ricoslabs.tiao`
  ("Tiao Mac App Store CI", expires 2027-09-23) is at
  `~/keys/tiao-mac-app-store.provisionprofile`. It carries Apple Distribution
  certificate SHA-1 `D509CE2C…1D82` (the CI certificate). `MAS_CSC_LINK` must
  hold that certificate's private key plus a Mac Installer Distribution
  identity.
- Entitlements: `desktop/build/entitlements.mas.plist` (App Sandbox,
  application group `4BHY8H2J25.com.ricoslabs.tiao`, network client,
  user-selected read-only files) and `entitlements.mas.inherit.plist` for helpers.
- Info.plist: `ElectronTeamID`, `ITSAppUsesNonExemptEncryption=false`,
  `LSApplicationCategoryType=public.app-category.board-games`, and the
  `tiao` URL scheme in `CFBundleURLTypes`. OAuth returns through that scheme, so
  sign-in works inside the sandbox; the app does not call
  `setAsDefaultProtocolClient` in a MAS build.
- The MAS build contains no `steamworks.js` and no updater.
- Icon: every macOS build ships `icon.icns` (macOS 11-15) and the compiled
  catalog `desktop/build/Assets.car` with `CFBundleIconName=Icon` (macOS 26
  draws the icon from it). Rebuild the catalog with
  `bash desktop/scripts/make-mac-asset-catalog.sh` (needs Xcode 26) when the
  iOS app icon changes.

### Microsoft Store

- Reserve the name in Partner Center (seller ID 96333960, publisher Ricos Labs
  LLC) and copy the three identity values into the `WINDOWS_STORE_*` variables.
- The AppX uses application ID `Tiao`, languages `en-US`, `de-DE`, `es-ES`,
  tiles from `desktop/build/appx/`, and the `tiao:` protocol from
  electron-builder's `protocols` config. It contains no `steamworks.js` and no
  updater.
- API submission (optional): create an Entra ID app with Partner Center access
  (Account settings → User management → Microsoft Entra applications, Manager
  role) and set the four `MSSTORE_*` secrets plus `MSSTORE_PRODUCT_ID` in
  `release-msstore`. The first submission, the listing, age rating and pricing
  are done in Partner Center by hand.

## Website downloads

Link the website to the published GitHub Release, never to a draft. The
repository is public, so published downloads are publicly downloadable.

## Local checks

```bash
cd desktop
pnpm install --frozen-lockfile
pnpm test            # unit tests + release tool tests
pnpm typecheck
npm run version:check
CSC_IDENTITY_AUTO_DISCOVERY=false node scripts/release/package.mjs macos smoke   # Mac host
CSC_IDENTITY_AUTO_DISCOVERY=false node scripts/release/package.mjs mas smoke
node scripts/release/collect.mjs macos universal smoke
actionlint
shellcheck -x scripts/release/*.sh
```

Local tests use fake credentials and never touch the real keychain. Only a
hosted signed run plus installed-app testing establishes release readiness.

## Known constraints

- electron-builder must stay at or above 26.16.1. Older releases unlock their
  throwaway signing keychain with the `.p12` password instead of the
  keychain's own; macOS 26 checks that and fails with `SecKeychainUnlock …
  passphrase … not correct` (electron-userland/electron-builder#10172).
  `minElectronBuilder` in `scripts/release/lib.mjs` holds the floor, and the
  release tool tests check it against `desktop/pnpm-lock.yaml`. npm's `latest`
  tag for electron-builder still points below the fix, so update with an
  explicit `^26.17.0`-or-newer range.
- The Apple legs still run on `macos-15`. With 26.17 the keychain bug no longer
  blocks `macos-latest` (macOS 26), and Track Your Time signs and notarizes on
  it. Move only after one signed `macos` and `mas` run there passes
  `verify-macos.sh` and `verify-mas.sh`.
- electron-builder drops a `mas.extendInfo` block (still true in 26.17), so the
  store keys live in `mac.extendInfo` (harmless in the Developer ID build).
- A signed Apple leg must keep `CSC_IDENTITY_AUTO_DISCOVERY=true`. With `false`,
  electron-builder skips signing and still produces a normally named,
  ad-hoc-signed app; only the verify scripts catch it.
- The direct updater stays off until `TIAO_ENABLE_UPDATER=1` is baked in
  deliberately; draft releases already carry `latest*.yml` and blockmaps.
