import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { localizedAlternates, OG_IMAGES } from "@/lib/metadata";
import { GamesPage } from "@/views/GamesPage";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "og" });

  return {
    title: t("gamesTitle"),
    description: t("gamesDescription"),
    alternates: localizedAlternates(locale, "/games"),
    openGraph: {
      title: t("gamesTitle"),
      description: t("gamesDescription"),
      images: OG_IMAGES,
    },
  };
}

export default function Page() {
  return <GamesPage />;
}
