import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { NO_INDEX_ROBOTS, OG_IMAGES } from "@/lib/metadata";
import { ProfilePage } from "@/views/ProfilePage";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "og" });

  return {
    title: t("settingsTitle"),
    description: t("profileDescription"),
    robots: NO_INDEX_ROBOTS,
    openGraph: {
      title: t("settingsTitle"),
      description: t("profileDescription"),
      images: OG_IMAGES,
    },
  };
}

export default function Page() {
  return <ProfilePage />;
}
