import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
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
    },
  };
}

export default function Page() {
  return <ImpressumPage />;
}
