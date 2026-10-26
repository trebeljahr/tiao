# Bundle size

The desktop app includes Electron (Chromium and Node), the static Next.js
client, desktop dependencies, and Steam's native libraries. The universal Mac
build includes both Intel and Apple Silicon machine code. Its installed size
is much larger than the browser's download of one page. Steam's compressed
download size also differs from installed size.

## Size reductions

Measured on the local Mac Steam demo on 2026-10-26, counting regular file
bytes once and excluding symlinks:

| Component | Before | After |
| --- | ---: | ---: |
| Installed app | 546.6 MB | 470.5 MB |
| Static client | 39.2 MB | 9.8 MB |
| Electron framework resources | 62.2 MB | 21.0 MB |
| Unpacked native dependencies | 8.6 MB | 4.1 MB |

The locale client providers import dictionaries in separate lazy chunks.
This avoids serializing the whole dictionary into every HTML document and
RSC payload, while keeping server rendering and loading only the active
language. Keep dictionary imports behind the client-side dynamic imports:
importing all providers in the server layout bundles all languages together.

Packaging retains Chromium's English, German and Spanish locales, including
regional variants. Each OS excludes Steam libraries for the other operating
systems. The universal Mac app keeps both Mac native bindings.

The browser error reporter imports a small re-export module so webpack can
remove unused Sentry exports. Importing the entire SDK namespace through the
lazy getter prevents that pruning.

## Measure after a build

```sh
pnpm --dir client build
pnpm --dir client size
pnpm --dir client build:desktop
pnpm --dir client size .next-desktop
```

The report separates all exported files from the initial HTML and JavaScript
resources for sample pages. Gzip numbers are estimates and exclude requests
made after hydration. A web export can also include carried releases for
safe updates; those count toward deployed disk use, not one page's download.
