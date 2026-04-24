import { AchievementsPage } from "@/views/AchievementsPage";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "og" });

  return {
    title: t("achievementsTitle"),
    description: t("achievementsDescription"),
    openGraph: {
      title: t("achievementsTitle"),
      description: t("achievementsDescription"),
    },
  };
}

export default function Page() {
  return <AchievementsPage />;
}
