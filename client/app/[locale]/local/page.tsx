import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocalGamePage } from "@/views/LocalGamePage";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "og" });

  return {
    title: t("localTitle"),
    description: t("localDescription"),
    openGraph: {
      title: t("localTitle"),
      description: t("localDescription"),
    },
  };
}

export default function Page() {
  return <LocalGamePage />;
}
