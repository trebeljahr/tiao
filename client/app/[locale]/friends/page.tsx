import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { NO_INDEX_ROBOTS, OG_IMAGES } from "@/lib/metadata";
import { FriendsPage } from "@/views/FriendsPage";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "og" });

  return {
    title: t("friendsTitle"),
    description: t("friendsDescription"),
    robots: NO_INDEX_ROBOTS,
    openGraph: {
      title: t("friendsTitle"),
      description: t("friendsDescription"),
      images: OG_IMAGES,
    },
  };
}

export default function Page() {
  return <FriendsPage />;
}
