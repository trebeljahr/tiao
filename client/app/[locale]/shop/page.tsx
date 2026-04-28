import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { ShopPage } from "@/views/ShopPage";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "shop" });

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default function Page() {
  return (
    <Suspense>
      <ShopPage />
    </Suspense>
  );
}
