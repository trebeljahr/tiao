import type { MetadataRoute } from "next";
import { locales } from "@/i18n/routing";
import { SITE_URL } from "@/lib/metadata";

const privatePaths = ["/settings", "/friends", "/matchmaking", "/onboarding", "/reset-password"];
const privateTrees = ["/admin"];

function localizedPrivatePaths(): string[] {
  const paths = [...privatePaths, ...privateTrees];
  const prefixed = locales.flatMap((locale) => paths.map((path) => `/${locale}${path}`));

  return Array.from(new Set([...paths, ...prefixed]));
}

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: localizedPrivatePaths(),
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
