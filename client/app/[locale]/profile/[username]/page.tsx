import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DESKTOP_SPA_PARAM_VALUE } from "@/lib/desktopPathParam";
import { NO_INDEX_FOLLOW_ROBOTS, placeholderRouteMetadata } from "@/lib/metadata";
import { PublicProfilePage } from "@/views/PublicProfilePage";

type Props = { params: Promise<{ locale: string }> };

/** Placeholder-baked like /game/[gameId]; see that page. */
export function generateStaticParams() {
  return [{ username: DESKTOP_SPA_PARAM_VALUE }];
}

/** One page serves every profile, so the metadata names no player. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "og" });
  return placeholderRouteMetadata({
    title: t("playerProfileTitle"),
    description: t("siteDescription"),
    robots: NO_INDEX_FOLLOW_ROBOTS,
  });
}

export default function Page() {
  return <PublicProfilePage />;
}
