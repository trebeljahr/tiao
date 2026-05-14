import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { localizedAlternates, OG_IMAGES } from "@/lib/metadata";
import { TutorialPage } from "@/views/TutorialPage";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "og" });

  return {
    title: t("tutorialTitle"),
    description: t("tutorialDescription"),
    alternates: localizedAlternates(locale, "/tutorial"),
    openGraph: {
      title: t("tutorialTitle"),
      description: t("tutorialDescription"),
      images: OG_IMAGES,
    },
  };
}

export default function Page() {
  return <TutorialPage />;
}
