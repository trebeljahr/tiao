import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { localizedAlternates, OG_IMAGES } from "@/lib/metadata";
import AndreasCreator from "./AndreasCreator";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);

  return {
    title: "Andreas Edmeier",
    description:
      "Andreas is the game designer and creator of Tiao. A game developer from Germany with a passion for board games and elegant mechanics.",
    alternates: localizedAlternates(locale, "/creators/andreas"),
    openGraph: {
      title: "Andreas Edmeier — Creator of Tiao",
      description:
        "Meet the mind behind Tiao. Game designer and developer with a passion for board games and elegant mechanics.",
      images: OG_IMAGES,
    },
  };
}

export default function Page() {
  return <AndreasCreator />;
}
