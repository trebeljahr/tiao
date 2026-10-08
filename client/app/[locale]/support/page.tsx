import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { localizedAlternates, OG_IMAGES } from "@/lib/metadata";
import { SupportPage } from "@/views/SupportPage";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "support" });

  return {
    title: t("title"),
    description: t("metaDescription"),
    alternates: localizedAlternates(locale, "/support"),
    openGraph: {
      title: t("title"),
      description: t("metaDescription"),
      images: OG_IMAGES,
    },
  };
}

export default function Page() {
  return <SupportPage />;
}
