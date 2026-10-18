import type { MetadataRoute } from "next";
import { locales } from "@/i18n/routing";
import { languageAlternates, localizedUrl } from "@/lib/metadata";

// Written once at build time: the web client is a static export.
export const dynamic = "force-static";

const staticRoutes = [
  { pathname: "/", changeFrequency: "daily", priority: 1 },
  { pathname: "/play", changeFrequency: "daily", priority: 0.9 },
  { pathname: "/rules", changeFrequency: "monthly", priority: 0.9 },
  { pathname: "/games", changeFrequency: "weekly", priority: 0.9 },
  { pathname: "/tutorial", changeFrequency: "monthly", priority: 0.9 },
  { pathname: "/computer", changeFrequency: "monthly", priority: 0.8 },
  { pathname: "/local", changeFrequency: "monthly", priority: 0.8 },
  { pathname: "/tournaments", changeFrequency: "daily", priority: 0.8 },
  { pathname: "/achievements", changeFrequency: "monthly", priority: 0.7 },
  { pathname: "/about", changeFrequency: "monthly", priority: 0.7 },
  { pathname: "/shop", changeFrequency: "monthly", priority: 0.7 },
  { pathname: "/creators/andreas", changeFrequency: "yearly", priority: 0.6 },
  { pathname: "/creators/rico", changeFrequency: "yearly", priority: 0.6 },
  { pathname: "/press", changeFrequency: "monthly", priority: 0.5 },
  { pathname: "/support", changeFrequency: "yearly", priority: 0.4 },
  { pathname: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { pathname: "/impressum", changeFrequency: "yearly", priority: 0.3 },
] as const satisfies Array<{
  pathname: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
}>;

function sitemapEntries(
  pathname: string,
  lastModified: Date,
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"],
  priority: number,
): MetadataRoute.Sitemap {
  return locales.map((locale) => ({
    url: localizedUrl(locale, pathname),
    lastModified,
    changeFrequency,
    priority,
    alternates: {
      languages: languageAlternates(pathname),
    },
  }));
}

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return staticRoutes.flatMap((route) =>
    sitemapEntries(route.pathname, lastModified, route.changeFrequency, route.priority),
  );
}
