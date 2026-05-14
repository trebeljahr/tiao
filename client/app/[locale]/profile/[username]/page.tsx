import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DESKTOP_SPA_PARAM_VALUE } from "@/lib/desktopPathParam";
import { localizedAlternates, localizedOpenGraphImage } from "@/lib/metadata";
import { fetchPublicProfile } from "@/lib/publicSeoData";
import { PublicProfilePage } from "@/views/PublicProfilePage";

type Props = { params: Promise<{ locale: string; username: string }> };

// See the matching constant in /app/[locale]/game/[gameId]/page.tsx —
// controls the web/desktop split for the shareable dynamic routes.
const IS_DESKTOP_BUILD = process.env.NEXT_PUBLIC_PLATFORM === "desktop";

/** See the twin function in /app/[locale]/game/[gameId]/page.tsx. */
export function generateStaticParams() {
  if (IS_DESKTOP_BUILD) return [{ username: DESKTOP_SPA_PARAM_VALUE }];
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, username } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "og" });
  const pathname = `/profile/${encodeURIComponent(username)}`;
  const routeImages = [localizedOpenGraphImage(locale, pathname, "Tiao public profile preview")];

  // Desktop static export: static fallback metadata only. See the
  // matching /game/[gameId]/page.tsx branch for the reasoning.
  if (IS_DESKTOP_BUILD) {
    const title = t("publicProfileTitle", { name: "" }).trim() || "Tiao";
    const description = t("siteDescription");
    return {
      title,
      description,
      alternates: localizedAlternates(locale, pathname),
      openGraph: { title, description, images: routeImages },
      twitter: { card: "summary_large_image", title, description, images: [routeImages[0].url] },
    };
  }

  const profile = await fetchPublicProfile(username);

  const name = profile?.displayName ?? username;
  const title = t("publicProfileTitle", { name });
  const description = t("publicProfileDescription", { name });

  return {
    title,
    description,
    alternates: localizedAlternates(locale, pathname),
    openGraph: { title, description, images: routeImages },
    twitter: { card: "summary_large_image", title, description, images: [routeImages[0].url] },
  };
}

export default function Page() {
  return <PublicProfilePage />;
}
