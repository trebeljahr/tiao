import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { localizedAlternates, OG_IMAGES } from "@/lib/metadata";
import RicoCreator from "./RicoCreator";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);

  return {
    title: "Rico Trebeljahr",
    description:
      "Rico is the developer behind playtiao.com. Full-stack engineer based in Berlin who built the digital version of Tiao.",
    alternates: localizedAlternates(locale, "/creators/rico"),
    openGraph: {
      title: "Rico Trebeljahr — Tiao Developer",
      description:
        "Meet the developer behind playtiao.com. Full-stack engineer and creator of the digital Tiao experience.",
      images: OG_IMAGES,
    },
  };
}

export default function Page() {
  return <RicoCreator />;
}
