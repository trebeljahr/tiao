import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { localizedAlternates, OG_IMAGES } from "@/lib/metadata";
import { LocalGamePage } from "@/views/LocalGamePage";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "og" });

  return {
    title: t("localTitle"),
    description: t("localDescription"),
    alternates: localizedAlternates(locale, "/local"),
    openGraph: {
      title: t("localTitle"),
      description: t("localDescription"),
      images: OG_IMAGES,
    },
  };
}

export default function Page() {
  return (
    <Suspense>
      <LocalGamePage />
    </Suspense>
  );
}
