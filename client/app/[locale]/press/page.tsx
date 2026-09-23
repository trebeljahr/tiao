import { existsSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { localizedAlternates, OG_IMAGES } from "@/lib/metadata";
import { PRESS_KIT_ZIP_PATH } from "@/lib/pressKit";
import { PressPage } from "@/views/PressPage";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "press" });

  return {
    title: t("title"),
    description: t("metaDescription"),
    alternates: localizedAlternates(locale, "/press"),
    openGraph: {
      title: t("title"),
      description: t("metaDescription"),
      images: OG_IMAGES,
    },
  };
}

// The zip is produced by hand (screenshot set + logo + walkthrough clip) and
// dropped into public/press/. Until it exists, the page must not link to a
// 404 — the check runs on the server at render time (build time for the
// statically generated locales), and the view renders a "coming soon" state
// with the press email instead of the download button.
function pressKitZipExists(): boolean {
  return existsSync(path.join(process.cwd(), "public", PRESS_KIT_ZIP_PATH));
}

export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <PressPage downloadAvailable={pressKitZipExists()} />;
}
