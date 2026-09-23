import type { MetadataRoute } from "next";
import { locales } from "@/i18n/routing";
import { languageAlternates, localizedUrl } from "@/lib/metadata";
import { fetchPublicTournaments } from "@/lib/publicSeoData";

export const revalidate = 300;

const staticRoutes = [
  { pathname: "/", changeFrequency: "daily", priority: 1 },
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

function tournamentChangeFrequency(
  status: string,
): MetadataRoute.Sitemap[number]["changeFrequency"] {
  return status === "registration" || status === "active" ? "daily" : "weekly";
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();
  const tournaments = await fetchPublicTournaments();

  return [
    ...staticRoutes.flatMap((route) =>
      sitemapEntries(route.pathname, lastModified, route.changeFrequency, route.priority),
    ),
    ...tournaments.flatMap((tournament) =>
      sitemapEntries(
        `/tournament/${encodeURIComponent(tournament.tournamentId)}`,
        new Date(tournament.createdAt),
        tournamentChangeFrequency(tournament.status),
        tournament.isFeatured ? 0.75 : 0.65,
      ),
    ),
  ];
}
