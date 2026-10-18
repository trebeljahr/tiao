import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DESKTOP_SPA_PARAM_VALUE } from "@/lib/desktopPathParam";
import { NO_INDEX_FOLLOW_ROBOTS, placeholderRouteMetadata } from "@/lib/metadata";
import { MultiplayerGamePage } from "@/views/MultiplayerGamePage";

type Props = { params: Promise<{ locale: string }> };

/**
 * Every build is a static export (web, desktop, mobile), so this route
 * is pre-rendered once with the placeholder param `__spa__`. The host
 * serves that page for every /game/<X> URL (the web's `_redirects`,
 * the native route mappers), and the view reads the real gameId from
 * the URL at runtime (see `resolveDynamicParam`). `next dev` still
 * renders any other id on demand.
 */
export function generateStaticParams() {
  return [{ gameId: DESKTOP_SPA_PARAM_VALUE }];
}

/** One page serves every game, so the metadata names no game. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "og" });
  return placeholderRouteMetadata({
    title: t("gameTitle", { gameId: "" }).trim(),
    description: t("siteDescription"),
    robots: NO_INDEX_FOLLOW_ROBOTS,
  });
}

export default function Page() {
  return <MultiplayerGamePage />;
}
