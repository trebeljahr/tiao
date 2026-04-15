# Tiao Desktop

Electron wrapper around the Tiao client, shipped as standalone macOS / Windows / Linux
binaries. The renderer is a Next.js static export served from a custom `app://tiao/`
privileged protocol; the main process handles OAuth via a system-browser bridge,
encrypted token persistence via `safeStorage`, and auto-updates via `electron-updater`.

The web build at [playtiao.com](https://playtiao.com) is unaffected by anything in this
directory.

## Dev workflow

Two commands the first time, then two per iteration:

```bash
# First-time: install deps. Already done if you ran `npm install` at the monorepo root.
cd desktop && npm install

# Build the static client export and stage it into desktop/client-bundle/.
# Slow (~30s) — it's a full Next.js production build. Re-run after changing
# any client/ code. An npm preflight (dev:ensure-bundle) auto-runs this on
# first `npm run dev` if the bundle is missing.
npm run dev:build-client

# Launch the Electron window at app://tiao/en/
npm run dev
```

There is **no HMR for the renderer**. Every UI tweak requires re-running
`npm run dev:build-client` and reloading the Electron window (`Cmd+R`) or
restarting `npm run dev`. The upside: identical code paths in dev and production
— the protocol handler and its SPA rewrite logic are tested every single launch.

### Where logs go

- **Renderer logs** (React `console.log`, network errors, CSP violations) →
  the DevTools Console, which auto-opens in dev (`Cmd+Opt+I` to toggle).
- **Main process logs** (`[main] ...`, `[authBridge] ...`, `[protocol] ...`) →
  the terminal where you ran `npm run dev`, **not** DevTools.

### Iterating on main process code

Main process code (`main.cjs`, `src/*.cjs`) does not hot-reload. Kill the Electron
app with `Cmd+Q` and re-run `npm run dev` after every main-side change.

## HMR dev mode (fast renderer iteration)

The production path has no renderer HMR — every CSS or React change requires a
full `next build` into `client-bundle/` and a reload. For fast UI iteration,
use `dev:hmr`, which points the Electron window at a running Next.js dev server
instead of loading the static bundle via `app://tiao/`:

```bash
# Terminal 1: start the regular tiao client dev server
# (from the monorepo root)
npm run dev   # or `npm run client` for just the client

# Terminal 2: launch Electron against it
cd desktop
npm run dev:hmr   # defaults to http://localhost:3000/en/
```

Override the URL if your dev server runs on a different port (e.g. worktrees
default to 3100 per the tiao workflow):

```bash
TIAO_DEV_RENDERER_URL=http://localhost:3100/en/ npm run dev:hmr
```

You get full Next.js Fast Refresh — edits to React components, Tailwind classes,
and CSS hot-reload in the Electron window without a full rebuild.

### What HMR mode skips

HMR mode **bypasses the entire production rendering path**. That's the whole
point — it's faster because it doesn't go through the `app://` protocol
handler. But it means the following are **NOT** exercised:

- **`app://tiao/` protocol handler** — SPA rewrites for `/game/[id]`,
  `/profile/[username]`, `/tournament/[id]`, and the path-traversal guard.
- **`client-bundle/`** — the static export isn't read, isn't even required to
  exist. The preflight check is skipped in this mode.
- **Bearer-token auth path** — because the renderer loads from
  `http://localhost:*`, same-origin cookies flow through the client's
  `server.mjs` proxy, and `api.ts` falls back to cookie auth. The
  `Authorization: Bearer` code path is dead in HMR mode.
- **OAuth via the IPC bridge** — `handleOAuthSignIn` still routes through
  `window.electron.auth.startOAuth(provider)` because `isElectron === true`,
  but the bridge opens the system browser at whatever `TIAO_API_URL` points
  at. Usually works, but sometimes simpler to use username/password login to
  sidestep the browser round-trip entirely.
- **Relaxed Content-Security-Policy** — Next.js HMR websocket needs `ws:` and
  dev mode uses `'unsafe-eval'`. The HMR CSP permits both; the production
  CSP (used by `npm run dev`) does not.

**Rule of thumb:** use `npm run dev:hmr` for UI iteration, use `npm run dev`
for anything that touches Electron-specific behavior — auth bridge,
safeStorage, deep links, protocol handler, SPA rewrite, packaging concerns.

### HMR startup banner

When HMR mode is active, main.cjs prints a banner at startup:

```
[main] HMR mode: loading renderer from http://localhost:3000/en/
[main] The app:// protocol handler, SPA rewrite, and bundled
[main] client-bundle/ are NOT used in this mode.  Auth/OAuth/
[main] safeStorage behavior may differ from a production build.
```

If you don't see this, you're in the regular `dev` path.

## Runtime API URL

The Tiao API base URL (`TIAO_API_URL`) is resolved at **Electron launch
time**, not baked into `client-bundle/` at static-export time. Switching
between local / staging / production only requires relaunching with a
different env var — no rebuild.

```bash
# Default: localhost:5005 (matches the tiao server dev port)
npm run dev

# Point at production
npm run dev:prod
# ↑ sets TIAO_API_URL=https://api.playtiao.com before launching

# Point at staging or a custom host
TIAO_API_URL=https://staging.example.com npm run dev
```

### How the wiring works

1. **`main.cjs`** reads `TIAO_API_URL` at launch via `resolveApiUrl()`
   in `src/config.cjs`. Default: `http://localhost:5005` for unpackaged
   builds, `https://api.playtiao.com` for packaged builds.
2. **`window.cjs`** passes the resolved URL to the sandboxed preload
   via `webPreferences.additionalArguments: ["--tiao-api-url=..."]`.
   This is the sanctioned Electron channel for main→preload data in
   a sandboxed window — env vars don't cross the sandbox reliably.
3. **`preload.cjs`** reads `--tiao-api-url=` out of `process.argv`,
   freezes it onto `window.electron.config.apiUrl`.
4. **`client/src/lib/api.ts`** reads `window.electron.config.apiUrl`
   synchronously at module load time (preload runs before any
   renderer JS, so it's always populated by then). Falls back to
   `NEXT_PUBLIC_DESKTOP_API_URL` if absent (safety net only).
5. **`authBridge.cjs`** uses the same `resolveApiUrl()` helper for
   the main-process `/api/auth/desktop/*` calls so renderer and main
   never drift.

The `NEXT_PUBLIC_DESKTOP_API_URL` build-time env var is still set by
`next.config.mjs` (default: production URL) but is now a fallback
path. In normal operation it's dead code — the runtime value always
wins.

## Architecture

```
desktop/
├── main.cjs          ← entry: preflight, protocol reg, bootstrap
├── preload.cjs       ← contextBridge: window.electron.{config, auth, analytics}
├── package.json      ← scripts + electron-builder config (all platforms)
└── src/
    ├── config.cjs    ← shared resolveApiUrl() used by main + authBridge
    ├── window.cjs    ← BrowserWindow factory, hardened webPreferences, CSP
    ├── protocol.cjs  ← app://tiao/* handler + SPA rewrite + path traversal guard
    ├── menu.cjs      ← native menu, Mac-aware split
    ├── deepLink.cjs  ← tiao:// URL scheme: open-url + second-instance + cold-start
    ├── authBridge.cjs← OAuth start → exchange → safeStorage persist → IPC broadcast
    ├── analytics.cjs ← OpenPanel main-process events, opt-in, persisted prefs
    └── updater.cjs   ← electron-updater, gated behind TIAO_ENABLE_UPDATER=1
```

### The `app://tiao/` protocol

The renderer never runs against a dev server. It's a Next.js static export baked
to `.next-desktop/` and copied into `desktop/client-bundle/`, which the main
process serves via a custom `app://tiao/*` privileged protocol.

Three dynamic routes (`/game/[id]`, `/profile/[username]`,
`/tournament/[id]`) are baked as a single `__spa__` placeholder HTML file in the
static export. The protocol handler rewrites e.g. `/en/game/ABC123/` to serve
`en/game/__spa__/index.html`, and a runtime helper in
`client/src/lib/desktopPathParam.ts` reads the real segment from
`window.location.pathname` once React hydrates. See `src/protocol.cjs` for the
full rewrite logic and path-traversal guard.

### The OAuth bridge

There are no web cookies — the renderer loads from `app://tiao/`, which has no
domain relationship with the API. Login goes through a three-step bridge:

1. **Renderer → main** (`auth:startOAuth`): generates a UUID state and opens the
   system browser at `https://api.playtiao.com/api/auth/desktop/start?provider=...&state=...`.
2. **System browser → OS → main**: after the user completes OAuth, the API
   redirects to `tiao://auth/complete?state=...&code=...`. macOS dispatches this
   via `open-url`; Windows/Linux via `second-instance`. See `src/deepLink.cjs`
   for the platform dance.
3. **Main → API → renderer** (`auth:complete` IPC broadcast): main POSTs
   `{state, code}` to `/api/auth/desktop/exchange`, persists the returned bearer
   token via `safeStorage` (OS keychain), and broadcasts it to the renderer,
   which refetches the player identity via `Authorization: Bearer`.

See `src/authBridge.cjs` for the full state machine + failure cases.

## Manually testing each piece

Test in this order when something's off:

| Surface                       | How to test                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Window loads**              | `npm run dev`. Home page renders in ~1s.                                                                                                                                             |
| **SPA route rewrite**         | Navigate to a game or profile page. `window.location.pathname` shows the real URL, but the protocol handler silently served the `__spa__` placeholder.                               |
| **External links**            | Click a link that opens in a new tab — it should open in your default browser, not the Electron window (see `setWindowOpenHandler` in `main.cjs`).                                   |
| **OAuth flow**                | Click "Sign in with GitHub". System browser opens → complete flow → `tiao://auth/complete` dispatches back → you're signed in. Requires `TIAO_API_URL` pointed at a working backend. |
| **safeStorage persistence**   | Sign in, `Cmd+Q`, relaunch. Still signed in. Encrypted blob lives at `~/Library/Application Support/Tiao/tiao-desktop-auth.enc`.                                                     |
| **Persistence warning toast** | On Linux without libsecret, or in a sandbox without keychain access, the renderer should show a warning toast on startup (`common.desktopPersistenceWarning`).                       |
| **Auto-updater**              | Off by default in dev (gated by `app.isPackaged && TIAO_ENABLE_UPDATER=1`). Real round-trip needs a signed macOS build.                                                              |

Useful DevTools console prods while debugging:

```js
// Confirm the bridge is exposed
window.electron;
// → { isElectron: true, platform: 'darwin', version: 'dev', auth: {...}, analytics: {...} }

// Force a fresh OAuth flow
await window.electron.auth.startOAuth("github");

// Check the current cached token
await window.electron.auth.getToken();

// Check whether OS encryption is available (false means "will re-sign-in on restart")
await window.electron.auth.getPersistenceStatus();

// Wipe persisted auth state
await window.electron.auth.logout();
```

## Building a real installer

### Local unsigned build (macOS)

```bash
cd desktop
npm run dev:build-client     # ensure client-bundle/ is fresh
npm run package              # → desktop/dist/Tiao-0.1.0.dmg (universal binary)
open dist/Tiao-0.1.0.dmg
# Finder mounts it. Drag Tiao.app → Applications. Eject.
```

First launch triggers **"Tiao is damaged and can't be opened"** from Gatekeeper
because the build is unsigned. Three workarounds for local testing:

```bash
# 1. Right-click the .app in Finder → Open. macOS asks once, then remembers.

# 2. Strip the quarantine xattr (silent, good for distributing to testers)
xattr -d com.apple.quarantine /Applications/Tiao.app

# 3. Run directly from the dist/ folder, bypassing "install" entirely
open desktop/dist/mac-universal/Tiao.app
```

`build.mac.hardenedRuntime` and `build.mac.gatekeeperAssess` are intentionally
`false` in `package.json` — they **must be flipped to `true`** when code signing
lands, otherwise Apple's notary service will reject every build. Pointers in
`scripts/release.sh` and `.github/workflows/desktop-release.yml`.

### All platforms

```bash
npm run package:all          # mac dmg + win nsis + win portable + linux AppImage
```

macOS builds **must be produced on a Mac**. Linux and Windows can be cross-built
from any host. The CI workflow (`.github/workflows/desktop-release.yml`) runs
each platform on its native runner on `workflow_dispatch` or `push: desktop-v*`
tag.

### Release env vars

`scripts/release.sh` sources `desktop/.env.release` (git-ignored). Fields:

| Variable                      | Purpose                                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `TIAO_DESKTOP_VERSION`        | Baked into `TiaoDesktop/X (darwin)` UA for analytics                                                                  |
| `TIAO_API_URL`                | API base URL (read at **runtime**; default: `https://api.playtiao.com` for packaged, `http://localhost:5005` for dev) |
| `TIAO_OPENPANEL_CLIENT_ID`    | OpenPanel public client id for main-process events                                                                    |
| `TIAO_OPENPANEL_API_URL`      | OpenPanel ingest URL                                                                                                  |
| `APPLE_ID`                    | (signing follow-up) Developer Apple ID email                                                                          |
| `APPLE_APP_SPECIFIC_PASSWORD` | (signing follow-up) app-specific password                                                                             |
| `APPLE_TEAM_ID`               | (signing follow-up) Developer Team ID                                                                                 |

## Security posture

Hardened `webPreferences` on the BrowserWindow (explicit, not just relying on
defaults):

- `contextIsolation: true` — preload globals isolated from renderer globals
- `nodeIntegration: false` — no `require` in the renderer
- `sandbox: true` — OS-level renderer sandbox
- `webSecurity: true` — same-origin policy enforced
- `allowRunningInsecureContent: false` — blocks mixed content

Plus a Content-Security-Policy header installed via `session.webRequest` at
window creation time. The CSP allows `'unsafe-inline'` for scripts because the
Next.js static export emits inline hydration scripts, but blocks external script
origins, `<object>`, `<embed>`, and `<iframe>`. See `src/window.cjs` for the
full policy and the rationale.

The actual XSS → RCE barrier is the webPreferences combo; the CSP is
defense-in-depth on top.

## Common gotchas

- **"Tiao couldn't load its app files."** You forgot `npm run dev:build-client`.
  The `dev:ensure-bundle` preflight will auto-build if the bundle is missing,
  but a stale `client-bundle/` (e.g. from a branch switch) won't trigger it —
  run `npm run dev:build-client` explicitly after switching branches.
- **Main process changes don't take effect.** There's no hot reload for main.
  Kill the app and re-run `npm run dev`.
- **Renderer changes don't take effect.** Re-run `npm run dev:build-client` and
  `Cmd+R` in the Electron window.
- **OAuth silently hangs.** Deep-link delivery differs per OS — on macOS it's
  `open-url`, on Windows/Linux it's `second-instance`. If you're running an
  unsigned dev build, the OS protocol registration may be pointing at a stale
  Electron binary; check `src/deepLink.cjs` for the `defaultApp` branch.
- **Main process logs in DevTools.** They're not there — check your terminal.
- **Analytics never fires.** The OpenPanel client id is unset in dev
  (`TIAO_OPENPANEL_CLIENT_ID`), so `track()` short-circuits. Set it in
  `.env.release` to smoke-test.
- **Universal binary is huge.** Yes — one binary containing both arm64 and x64
  code is roughly the sum of the two. If you need a smaller download, change
  `build.mac.target.arch` back to `["arm64", "x64"]` for split builds.
