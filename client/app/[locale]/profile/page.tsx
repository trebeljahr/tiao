import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ProfilePage } from "@/views/ProfilePage";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "og" });

  return {
    title: t("profileTitle"),
    description: t("profileDescription"),
    openGraph: {
      title: t("profileTitle"),
      description: t("profileDescription"),
    },
  };
}

export default function Page() {
  return <ProfilePage />;
}
