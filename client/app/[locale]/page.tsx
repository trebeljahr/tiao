import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";
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
    },
  };
}

export default function Page() {
  return <LobbyPage />;
}
