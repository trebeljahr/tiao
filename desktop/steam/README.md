# SteamPipe build configuration

Everything needed to push a Tiao build to Steam, minus the credentials
and the appid.

## Why these are templates

The `.vdf` files here are templates with `${...}` placeholders rather
than finished config. Steam's depot IDs are assigned per-app by Valve
and are not knowable until the Partner Portal entry exists, and the app
currently builds against Valve's public Spacewar test appid (`480`).
Committing a half-real appid invites someone to run an upload against
the wrong app, so `scripts/steam-upload.sh` renders these at upload time
from environment variables and refuses to run against the placeholder.

## Depot layout

Steam wants one depot per platform, each containing an unpacked game
directory — not an installer. electron-builder already emits those
directories as a byproduct of every target, so nothing extra gets built:

| Depot          | Content root                  | Default ID   |
| -------------- | ----------------------------- | ------------ |
| Windows x64    | `dist/win-unpacked/`          | `<appid>+1`  |
| macOS universal| `dist/mac-universal/Tiao.app` | `<appid>+2`  |
| Linux x64      | `dist/linux-unpacked/`        | `<appid>+3`  |

`appid+N` is the convention Valve's own docs use and what the Partner
Portal assigns by default, but it is only a convention — override with
`TIAO_STEAM_DEPOT_WINDOWS` / `_MAC` / `_LINUX` if the portal assigned
something else. The upload script prints the IDs it resolved before
doing anything, so a mismatch is visible rather than silent.

## Required environment

| Variable                  | Purpose                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `TIAO_STEAM_APPID`        | Real appid from the Partner Portal. Never `480`.                |
| `STEAM_USERNAME`          | Steam account with Edit App Metadata + Publish rights           |
| `STEAM_CONFIG_VDF`        | base64 of a `config.vdf` from an already-2FA'd session          |
| `TIAO_STEAM_BRANCH`       | Branch to set live. Empty (default) uploads without setting live |

### About `STEAM_CONFIG_VDF`

Steam Guard cannot be scripted. The standard approach is to authenticate
`steamcmd` interactively once on a machine, then reuse the session token
it caches:

```bash
steamcmd +login <username> +quit        # complete the Steam Guard prompt
base64 -i ~/Steam/config/config.vdf     # macOS; -w0 on Linux
```

Store that as a secret. It expires — when uploads start failing to
authenticate, redo the interactive login and replace it. Prefer a
dedicated build account over a personal one: the token is a long-lived
credential, and a build account's blast radius is one app.

## Setting a build live

The upload script defaults to **not** setting any branch live. A build
that uploads but stays dark can be promoted from the Partner Portal
after someone has actually run it, which is the right default for a
first release.

Pass `TIAO_STEAM_BRANCH=beta` to publish straight to a branch. Never set
this to `default` from CI — that is the public branch, and it means an
automated push goes straight to players with no human in between.
