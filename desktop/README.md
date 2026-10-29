# Tiao Desktop

Tauri 2 hosts the Next.js static export. Rust handles authentication, native
credentials, deep links, Steam, StoreKit, Microsoft Store purchases and window
controls. Web and Capacitor builds keep their existing frontend.

## Development

Install Rust and the platform's Tauri prerequisites, then:

```sh
pnpm --dir desktop install --frozen-lockfile
pnpm dev:desktop
```

The root command starts a backend on a free port and builds the desktop client.
To use the production API without starting a backend:

```sh
pnpm --dir desktop dev:prod
```

`TIAO_API_URL` is injected before page scripts run. Release binaries require
HTTPS. Debug binaries also accept HTTP on localhost or 127.0.0.1.
`TIAO_DEVTOOLS=1` opens WebView developer tools in debug builds.

The renderer retains `window.electron` as a compatibility API for the shared
frontend. It contains only Tauri command adapters; no Electron or Node runtime
ships in the application. `bridge.js` defines the API and Rust validates callers
and arguments. Remote pages cannot navigate inside the privileged WebView.

## Build and test

Native tests/checks embed the frontend. On a fresh checkout, first run
`pnpm --dir desktop dev:build-client`.

```sh
pnpm --dir desktop test:js
pnpm --dir desktop test:native
pnpm --dir desktop typecheck
pnpm --dir desktop package
pnpm --dir desktop package:steam
pnpm --dir desktop package:steam-demo
```

Packaging builds the frontend and writes `dist/<channel>/`. macOS defaults to
universal Intel + ARM; `TIAO_TARGET=aarch64-apple-darwin` selects a local ARM
build. Windows and Linux builds run on their respective native hosts.
The macOS WebView uses system WebKit; older Macs need Safari 16.4 or newer
for the current Next.js frontend.

Steam and Steam Demo have separate baked AppIDs and bundle identifiers. The
packager downloads only SDK 1.64 redistributables from a SHA-256-pinned archive.
`STEAM_SDK_ARCHIVE` can point to a cached copy. The SDK initializes before the
WebView; the native Metal surface and Wine workarounds follow Mesozoic Protocol.
Linux releases build on Ubuntu 22.04 to keep its glibc 2.35 baseline.
Linux Steam depots contain an extracted AppImage runtime and launcher, including
its WebKit/font dependency closure.

`TIAO_DISTRIBUTION_CHANNEL` is compiled into the binary. Valid channels: `direct`,
`itch`, `steam`, `steam-demo`, `mas`, `msstore`. Changing an environment variable
at launch cannot turn a store build into a direct build.

Steam authentication is memory-only and restores through fresh native tickets.
Other channels use the OS credential store. Tests and automated launches must
set `TIAO_KEYCHAIN_ACCESS=deny`; unit tests never access real credentials.
Existing Electron credential files and browser storage are left intact. The
first Tauri launch requires a new sign-in; Chromium storage is not imported.

Self-updates are off by default. Only direct builds may compile the `updater`
feature. Enabling it also requires `TIAO_ENABLE_UPDATER=1`, a Tauri public key
and HTTPS feed (`TIAO_UPDATER_PUBLIC_KEY`, `TIAO_UPDATER_ENDPOINT`). Electron
update feeds and signatures are incompatible. Store channels own their updates.

Store purchases still require server verification before entitlement grants and
transaction completion. Real purchase, signed distribution and other-platform
runtime checks require their native store environments; unit tests do not buy
products or unlock real Steam achievements.

OAuth uses a PKCE-bound polling fallback as well as `tiao://` callbacks. Steam
account linking stages the verified web account and waits for explicit account
name confirmation before merging it. Signing out and closing a login cancel
pending flows. Invite lobbies are prepared when entering a waiting room.
