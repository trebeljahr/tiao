import createNextIntlPlugin from "next-intl/plugin";
import withSerwistInit from "@serwist/next";
import path from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";

// Desktop Electron static-export build is selected via the env var.
// Next.js 16 has no --config CLI option, so we branch inside this one
// config file: `NEXT_PUBLIC_PLATFORM=desktop next build --webpack`
// switches output mode, distDir, image optimization, trailing slashes,
// and disables Serwist (which can't precache from a file:// / app://
// origin and is redundant when the bundle already lives on disk).
const IS_DESKTOP_BUILD = process.env.NEXT_PUBLIC_PLATFORM === "desktop";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // Disable the service worker in development (stale caches while
  // iterating) and in the desktop Electron build (the bundle is
  // already on disk, SW precaching is redundant and interferes with
  // the `app://` protocol handler).
  disable: process.env.NODE_ENV === "development" || IS_DESKTOP_BUILD,
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
  if (process.env.APP_VERSION) return (_cachedVersion = process.env.APP_VERSION);
  const pkgPath = path.resolve(__dirname, "../package.json");
  if (!existsSync(pkgPath)) return (_cachedVersion = "0.0.0");
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

  // Desktop static export overrides.  These keys are only present
  // when NEXT_PUBLIC_PLATFORM=desktop is set at build time.  See
  // the comment at the top of the file for the full rationale.
  ...(IS_DESKTOP_BUILD && {
    // Full static export — produces HTML/JS/CSS on disk with no
    // Node runtime required to serve them.  The Electron `app://`
    // protocol handler reads files directly from the bundled dir.
    output: "export",
    // Keep web and desktop build outputs separate so back-to-back
    // invocations don't stomp on each other.
    distDir: ".next-desktop",
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
  },
  // Parallel dev mode (DEV_PARALLEL=1, set by scripts/dev.mjs): two settings
  // need to flip so multiple Next 16 dev servers can run against the same
  // project dir.
  //
  // 1. lockDistDir off — Next 16 normally takes an exclusive lockfile at
  //    .next/dev/lock and refuses any second dev server in the same project,
  //    regardless of port.
  // 2. turbopackFileSystemCacheForDev off — Next 16.1+ enables Turbopack's
  //    cross-session persistent build cache by default. The on-disk cache
  //    database can only be opened by one Turbopack instance at a time; two
  //    sharing the same .next/dev/cache crash with "Failed to open database".
  //    Turning it off costs us the warm-cache speedup across restarts but
  //    leaves HMR and the font cache (which lives elsewhere, at
  //    .next/dev/internal/font/) intact — so concurrent Google Fonts
  //    downloads still hit a single shared cache and don't race each other.
  experimental: {
    lockDistDir: process.env.DEV_PARALLEL !== "1",
    turbopackFileSystemCacheForDev: process.env.DEV_PARALLEL !== "1",
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
    config.module.rules.forEach((rule) => {
      if (rule.oneOf) {
        rule.oneOf.forEach((oneOfRule) => {
          if (oneOfRule.test?.toString().includes("tsx|ts") && oneOfRule.include) {
            if (Array.isArray(oneOfRule.include)) {
              oneOfRule.include.push(sharedDir);
            } else {
              oneOfRule.include = [oneOfRule.include, sharedDir];
            }
          }
        });
      }
    });

    // Suppress next-intl dynamic import parsing warning (cosmetic, no functional impact)
    config.ignoreWarnings = [...(config.ignoreWarnings || []), { module: /next-intl/ }];

    return config;
  },
};

export default withSerwist(withNextIntl(nextConfig));
