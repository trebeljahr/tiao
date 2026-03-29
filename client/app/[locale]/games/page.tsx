import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { GamesPage } from "@/views/GamesPage";

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
    },
  };
}

export default function Page() {
  return <GamesPage />;
}
