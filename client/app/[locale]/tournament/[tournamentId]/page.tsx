import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DESKTOP_SPA_PARAM_VALUE } from "@/lib/desktopPathParam";
import { placeholderRouteMetadata } from "@/lib/metadata";
import { TournamentPage } from "@/views/TournamentPage";

type Props = { params: Promise<{ locale: string }> };

/** Placeholder-baked like /game/[gameId]; see that page. */
export function generateStaticParams() {
  return [{ tournamentId: DESKTOP_SPA_PARAM_VALUE }];
}

/** One page serves every tournament, so the metadata names none. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "og" });
  return placeholderRouteMetadata({
    title: t("tournamentsTitle"),
    description: t("tournamentsDescription"),
  });
}

export default function Page() {
  return <TournamentPage />;
}
