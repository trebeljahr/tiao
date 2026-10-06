import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import withSerwistInit from "@serwist/next";
import createNextIntlPlugin from "next-intl/plugin";

// Desktop Electron static-export build is selected via the env var.
// Next.js 16 has no --config CLI option, so we branch inside this one
// config file: `NEXT_PUBLIC_PLATFORM=desktop next build --webpack`
// switches output mode, distDir, image optimization, trailing slashes,
// and disables Serwist (which can't precache from a file:// / app://
// origin and is redundant when the bundle already lives on disk).
const IS_DESKTOP_BUILD = process.env.NEXT_PUBLIC_PLATFORM === "desktop";

// Capacitor Android / iOS build. Same static-export shape as desktop
// — the WebView reads files directly off disk — but with a separate
// distDir (.next-mobile) and a different default API URL pulled from
// NEXT_PUBLIC_MOBILE_API_URL. The mobile app has no preload bridge,
// so the API URL must be baked in at build time (no Electron-style
// runtime config injection).
const IS_MOBILE_BUILD = process.env.NEXT_PUBLIC_PLATFORM === "mobile";

// Either standalone-asset build shares the same output: "export"
// settings (no Node runtime to serve from, image optimizer is off,
// trailing slashes for index.html-per-dir layout). The only thing
// that differs is the distDir.
const IS_STATIC_EXPORT = IS_DESKTOP_BUILD || IS_MOBILE_BUILD;

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // Disable the service worker in development (stale caches while
  // iterating) and in any static-export build — the bundle is already
  // on disk (Electron app://, Capacitor capacitor://), SW precaching
  // is redundant and the custom schemes don't allow SW registration
  // in the first place.
  disable: process.env.NODE_ENV === "development" || IS_STATIC_EXPORT,
  reloadOnOnline: true,
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sharedDir = path.resolve(__dirname, "../shared/src");

// Build version: prefer APP_VERSION env var (set by CI/Docker), then try git,
// then fall back to the bare package version. Result is cached so git commands
// only run once per process (not on every HMR config re-eval).
let _cachedVersion;
function getAppVersion() {
  if (_cachedVersion) return _cachedVersion;
  if (process.env.APP_VERSION) {
    _cachedVersion = process.env.APP_VERSION;
    return _cachedVersion;
  }
  const pkgPath = path.resolve(__dirname, "../package.json");
  if (!existsSync(pkgPath)) {
    _cachedVersion = "0.0.0";
    return _cachedVersion;
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  try {
    const commitCount = execSync("git rev-list --count HEAD", { encoding: "utf-8" }).trim();
    const shortHash = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
    _cachedVersion = `${pkg.version}-build.${commitCount}+${shortHash}`;
  } catch {
    _cachedVersion = pkg.version;
  }
  return _cachedVersion;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["192.168.0.*", "192.168.1.*", "localhost", "127.0.0.1"],
  outputFileTracingRoot: path.resolve(__dirname, ".."),

  // `*.web.ts(x)` files under app/ are web-only routes: OG/Twitter
  // images, robots.txt and the sitemap. They render per request on the
  // web server, which a static export cannot do, and the desktop and
  // mobile apps have no use for them. Static exports drop the `web.*`
  // extensions so those files are not routes there.
  pageExtensions: IS_STATIC_EXPORT
    ? ["tsx", "ts", "jsx", "js"]
    : ["web.tsx", "web.ts", "tsx", "ts", "jsx", "js"],

  // Emit browser-side source maps when EMIT_SOURCE_MAPS=1 is set at build
  // time. The root `test:e2e` script flips this on so that when a playwright
  // test surfaces a runtime error, the stack trace points at real source
  // files instead of minified bundle chunks. Stays OFF by default because
  // source maps roughly double .next/ output size and production deploys
  // don't want them shipped to end users.
  productionBrowserSourceMaps: process.env.EMIT_SOURCE_MAPS === "1",

  // Release identity for the web image: Next sends it as x-deployment-id on
  // router requests, and server.mjs refuses flight data across releases so
  // an old tab loads one complete document instead (see release-assets.mjs).
  ...(process.env.BUILD_COMMIT && !IS_STATIC_EXPORT
    ? { deploymentId: process.env.BUILD_COMMIT }
    : {}),

  // Static-export overrides for the Electron (desktop) and Capacitor
  // (mobile) bundles. Both targets serve files from disk with no Node
  // runtime, so they share output mode, image-optimizer disablement,
  // and index.html-per-dir layout. Only the distDir differs so the
  // two outputs don't stomp on each other.
  ...(IS_STATIC_EXPORT && {
    // Full static export — produces HTML/JS/CSS on disk with no
    // Node runtime required to serve them. The Electron `app://`
    // protocol handler and the Capacitor `capacitor://` WebView both
    // read files directly off disk.
    output: "export",
    distDir: IS_MOBILE_BUILD ? ".next-mobile" : ".next-desktop",
    // Static export can't use Next.js's built-in image optimizer
    // (which needs a runtime). Assets in public/ are served raw.
    images: { unoptimized: true },
    // Emit `index.html` in each route directory instead of bare
    // `<route>.html` — simplifies the protocol handler's path
    // resolution and matches conventional static-hosting layouts.
    trailingSlash: true,
  }),

  env: {
    APP_VERSION: getAppVersion(),
    ...(IS_DESKTOP_BUILD && {
      // NEXT_PUBLIC_* vars are inlined into both client and server
      // bundles at build time.  The platform + API URL are read by
      // client/src/lib/api.ts and AuthContext to switch to the
      // bearer-token auth path when running in Electron.
      NEXT_PUBLIC_PLATFORM: "desktop",
      NEXT_PUBLIC_DESKTOP_API_URL:
        process.env.NEXT_PUBLIC_DESKTOP_API_URL || "https://api.playtiao.com",
    }),
    ...(IS_MOBILE_BUILD && {
      // Capacitor has no preload bridge to inject the API URL at
      // runtime, so the value must be baked in here. Defaults to
      // production; override with NEXT_PUBLIC_MOBILE_API_URL for
      // dev/staging builds. The Android/iOS WebView reads the same
      // bearer-token path as Electron (handled in client/src/lib/api.ts).
      NEXT_PUBLIC_PLATFORM: "mobile",
      NEXT_PUBLIC_MOBILE_API_URL:
        process.env.NEXT_PUBLIC_MOBILE_API_URL || "https://api.playtiao.com",
    }),
  },
  // Parallel dev mode (DEV_PARALLEL=1, set by scripts/dev.mjs):
  //
  // Each parallel instance uses its OWN `distDir` (.next-<PORT>) so that
  // Turbopack's persistent cache DB at <distDir>/dev/cache/turbopack/ is
  // per-instance — no SQLite collision between two instances opening the
  // same cache file. This lets us keep `turbopackFileSystemCacheForDev`
  // enabled in parallel mode too, so cold compiles hit the warm per-port
  // cache on subsequent restarts instead of paying the full ~50s cost
  // every time.
  //
  // Gotcha: Turbopack's Google Fonts fetcher has no retry — if two
  // instances request the same font URL concurrently on a fresh cache,
  // one of them loses a rate-limiting race and fails to load the font.
  // scripts/dev.mjs mitigates by staggering the instance startup with a
  // short delay so the first instance populates its cache before the
  // second one starts its cold compile.
  //
  // `lockDistDir` stays off in parallel mode because Next 16 otherwise
  // refuses any second dev server in the same project dir, even with
  // distinct distDirs.
  ...(process.env.DEV_PARALLEL === "1" && process.env.PORT
    ? { distDir: `.next-${process.env.PORT}` }
    : {}),
  experimental: {
    // The locale segment owns the root layout; unmatched routes need their own document.
    globalNotFound: true,
    lockDistDir: process.env.DEV_PARALLEL !== "1",
    // Tell Turbopack/webpack these packages are side-effect-free so
    // named imports can be rewritten as per-module paths and the rest
    // tree-shaken. Next 16's default list covers react-icons/*,
    // lucide-react, @headlessui/react, @heroicons/*, @mui/*, etc. —
    // these additions cover the heavy deps in our critical path that
    // aren't in the default list. Primarily helps production builds;
    // dev also benefits wherever we use named barrel imports.
    //
    // Note: @sentry/browser is lazy-imported in src/lib/glitchtip.ts so
    // it never enters the dev critical path in the first place — listing
    // it here is purely for the production build.
    optimizePackageImports: [
      "@sentry/browser",
      "better-auth",
      "better-auth/react",
      "better-auth/client/plugins",
      "framer-motion",
      "sonner",
    ],
  },
  // Turbopack config (default bundler in Next.js 16 dev)
  turbopack: {
    resolveAlias: {
      "@shared": "../shared/src",
      "@shared/*": ["../shared/src/*"],
    },
  },
  // Webpack config (used for production builds via `next build --webpack`)
  webpack: (config) => {
    config.resolve.alias["@shared"] = sharedDir;

    // Include shared dir in Next.js TS loader (no shared/package.json needed)
    for (const rule of config.module.rules) {
      if (rule.oneOf) {
        for (const oneOfRule of rule.oneOf) {
          if (oneOfRule.test?.toString().includes("tsx|ts") && oneOfRule.include) {
            if (Array.isArray(oneOfRule.include)) {
              oneOfRule.include.push(sharedDir);
            } else {
              oneOfRule.include = [oneOfRule.include, sharedDir];
            }
          }
        }
      }
    }

    // Suppress next-intl dynamic import parsing warning (cosmetic, no functional impact)
    config.ignoreWarnings = [...(config.ignoreWarnings || []), { module: /next-intl/ }];

    return config;
  },
};

export default withSerwist(withNextIntl(nextConfig));
