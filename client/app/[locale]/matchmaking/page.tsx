import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { NO_INDEX_ROBOTS, OG_IMAGES } from "@/lib/metadata";
import { MatchmakingPage } from "@/views/MatchmakingPage";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "og" });

  return {
    title: t("matchmakingTitle"),
    description: t("matchmakingDescription"),
    robots: NO_INDEX_ROBOTS,
    openGraph: {
      title: t("matchmakingTitle"),
      description: t("matchmakingDescription"),
      images: OG_IMAGES,
    },
  };
}

export default function Page() {
  return (
    <Suspense>
      <MatchmakingPage />
    </Suspense>
  );
}
