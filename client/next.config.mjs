import createNextIntlPlugin from "next-intl/plugin";
import path from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import { execSync } from "child_process";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sharedDir = path.resolve(__dirname, "../shared/src");

// Replicate the __APP_VERSION__ define from vite.config.mts
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf-8"));
function getGitVersion(baseVersion) {
  try {
    const commitCount = execSync("git rev-list --count HEAD", { encoding: "utf-8" }).trim();
    const shortHash = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
    return `${baseVersion}-build.${commitCount}+${shortHash}`;
  } catch {
    return baseVersion;
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["192.168.1.0/24", "localhost"],
  env: {
    APP_VERSION: getGitVersion(pkg.version),
  },
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

    return config;
  },
  async rewrites() {
    const apiTarget = process.env.API_URL || `http://127.0.0.1:${process.env.API_PORT || "5005"}`;
    return [
      { source: "/api/:path*", destination: `${apiTarget}/api/:path*` },
      { source: "/ws/:path*", destination: `${apiTarget}/ws/:path*` },
    ];
  },
};

export default withNextIntl(nextConfig);
