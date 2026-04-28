import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { OG_IMAGES } from "@/lib/metadata";
import { ImpressumPage } from "@/views/ImpressumPage";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "impressum" });

  return {
    title: t("title"),
    description: t("metaDescription"),
    openGraph: {
      title: t("title"),
      description: t("metaDescription"),
      images: OG_IMAGES,
    },
  };
}

export default function Page() {
  return <ImpressumPage />;
}
