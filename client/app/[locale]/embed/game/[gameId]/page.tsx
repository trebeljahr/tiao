import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DESKTOP_SPA_PARAM_VALUE } from "@/lib/desktopPathParam";
import { NO_INDEX_ROBOTS } from "@/lib/metadata";
import { EmbedGamePage } from "@/views/EmbedGamePage";

type Props = { params: Promise<{ locale: string; gameId: string }> };

// Desktop (Electron) and mobile (Capacitor) both ship a static export.
const IS_STATIC_EXPORT =
  process.env.NEXT_PUBLIC_PLATFORM === "desktop" || process.env.NEXT_PUBLIC_PLATFORM === "mobile";

/**
 * Embeddable finished-game replay: board + move-step controls, no app
 * chrome. This is the only route the app lets third parties iframe —
 * see `client/proxy.ts` / `@/lib/frameHeaders` for the header policy
 * and `app/[locale]/providers.tsx` for the stripped-down shell.
 *
 * Desktop static export needs a placeholder param like the other
 * dynamic routes (see `resolveDynamicParam`); nobody embeds from
 * Electron, but the build must still succeed.
 */
export function generateStaticParams() {
  if (IS_STATIC_EXPORT) return [{ gameId: DESKTOP_SPA_PARAM_VALUE }];
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, gameId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "og" });
  return {
    title: t("gameTitle", { gameId: gameId.toUpperCase() }),
    // The embed is a widget, not a landing page: the canonical share
    // page at /game/:id carries the OG tags and is the one to index.
    robots: NO_INDEX_ROBOTS,
  };
}

export default function Page() {
  return <EmbedGamePage />;
}
