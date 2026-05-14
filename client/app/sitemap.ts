import type { MetadataRoute } from "next";
import { locales } from "@/i18n/routing";
import { languageAlternates, localizedUrl } from "@/lib/metadata";

const staticRoutes = [
  { pathname: "/", changeFrequency: "daily", priority: 1 },
  { pathname: "/games", changeFrequency: "weekly", priority: 0.9 },
  { pathname: "/tutorial", changeFrequency: "monthly", priority: 0.9 },
  { pathname: "/computer", changeFrequency: "monthly", priority: 0.8 },
  { pathname: "/local", changeFrequency: "monthly", priority: 0.8 },
  { pathname: "/tournaments", changeFrequency: "daily", priority: 0.8 },
  { pathname: "/achievements", changeFrequency: "monthly", priority: 0.7 },
  { pathname: "/shop", changeFrequency: "monthly", priority: 0.7 },
  { pathname: "/creators/andreas", changeFrequency: "yearly", priority: 0.6 },
  { pathname: "/creators/rico", changeFrequency: "yearly", priority: 0.6 },
  { pathname: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { pathname: "/impressum", changeFrequency: "yearly", priority: 0.3 },
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return staticRoutes.flatMap((route) =>
    locales.map((locale) => ({
      url: localizedUrl(locale, route.pathname),
      lastModified,
      changeFrequency: route.changeFrequency,
      priority: route.priority,
      alternates: {
        languages: languageAlternates(route.pathname),
      },
    })),
  );
}
