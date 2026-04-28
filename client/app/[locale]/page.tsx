import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { OG_IMAGES } from "@/lib/metadata";
import { LobbyPage } from "@/views/LobbyPage";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "og" });

  return {
    title: t("lobbyTitle"),
    description: t("lobbyDescription"),
    openGraph: {
      title: t("lobbyTitle"),
      description: t("lobbyDescription"),
      images: OG_IMAGES,
    },
  };
}

export default function Page() {
  return <LobbyPage />;
}
