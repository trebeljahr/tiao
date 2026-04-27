import { OG_IMAGES } from "@/lib/metadata";
import { GamesPage } from "@/views/GamesPage";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "og" });

  return {
    title: t("gamesTitle"),
    description: t("gamesDescription"),
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
