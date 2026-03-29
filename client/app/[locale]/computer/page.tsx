import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ComputerGamePage } from "@/views/ComputerGamePage";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "og" });

  return {
    title: t("computerTitle"),
    description: t("computerDescription"),
    openGraph: {
      title: t("computerTitle"),
      description: t("computerDescription"),
    },
  };
}

export default function Page() {
  return <ComputerGamePage />;
}
