import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { TutorialPage } from "@/views/TutorialPage";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "og" });

  return {
    title: t("tutorialTitle"),
    description: t("tutorialDescription"),
    openGraph: {
      title: t("tutorialTitle"),
      description: t("tutorialDescription"),
    },
  };
}

export default function Page() {
  return <TutorialPage />;
}
