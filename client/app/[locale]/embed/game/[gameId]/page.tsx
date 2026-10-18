import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DESKTOP_SPA_PARAM_VALUE } from "@/lib/desktopPathParam";
import { NO_INDEX_ROBOTS } from "@/lib/metadata";
import { EmbedGamePage } from "@/views/EmbedGamePage";

type Props = { params: Promise<{ locale: string }> };

/**
 * Embeddable finished-game replay: board + move-step controls, no app
 * chrome. This is the only route the app lets third parties iframe —
 * see `scripts/finalize-web-export.mjs` (`_headers`) and
 * `@/lib/frameHeaders` for the header policy and
 * `app/[locale]/providers.tsx` for the stripped-down shell.
 *
 * Placeholder-baked like /game/[gameId]; see that page.
 */
export function generateStaticParams() {
  return [{ gameId: DESKTOP_SPA_PARAM_VALUE }];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "og" });
  return {
    title: t("gameTitle", { gameId: "" }).trim(),
    // The embed is a widget, not a landing page: the canonical share
    // page at /game/:id carries the OG tags and is the one to index.
    robots: NO_INDEX_ROBOTS,
  };
}

export default function Page() {
  return <EmbedGamePage />;
}
