"use client";
// Use next-intl's localized Link, NOT the raw `next/link` — a vanilla
// Link emits locale-less hrefs like `/tutorial` which Next.js then
// prefetches verbatim. In a web build the middleware rewrites those
// to `/en/tutorial`, but the desktop static export has no middleware
// and the `app://tiao/` protocol handler only knows about
// `<locale>/tutorial/index.html`, so every prefetch 404s in the
// console. The localized Link prefixes the current locale before
// the URL ever leaves the renderer.
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { PageLayout } from "@/components/PageLayout";
import { PaperCard } from "@/components/ui/paper-card";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Offline fallback for the lobby page in the desktop Electron build.
 *
 * The normal LobbyPage depends on live WebSocket updates, game list
 * fetches, tournament fetches, and social overview data — all of
 * which fail hard when the backend is unreachable.  Rather than
 * flash error toasts and show empty panels, we swap the whole lobby
 * out for a minimal "offline entry points" dashboard that links to
 * the four pages known to work without a network connection:
 *
 *   /local     — two-player same device
 *   /computer  — computer opponent (AI runs in browser)
 *   /tutorial  — interactive tutorial (hardcoded steps)
 *   /privacy   — legal pages
 *
 * The decision "am I offline?" lives in the caller (LobbyPage).
 * This component is presentation-only.
 */
export function DesktopOfflineLobby() {
  const t = useTranslations("desktop.lobby");
  const tOffline = useTranslations("desktop.offline");

  const tiles: { href: string; title: string; description: string }[] = [
    { href: "/local", title: t("localTitle"), description: t("localSubtitle") },
    { href: "/computer", title: t("computerTitle"), description: t("computerSubtitle") },
    { href: "/tutorial", title: t("tutorialTitle"), description: t("tutorialSubtitle") },
    { href: "/privacy", title: t("legalTitle"), description: t("legalSubtitle") },
  ];

  return (
    <PageLayout maxWidth="max-w-3xl">
      <PaperCard>
        <CardHeader>
          <CardTitle className="text-center text-2xl">{t("offlineTitle")}</CardTitle>
          <p className="text-center text-sm text-muted-foreground">{t("offlineSubtitle")}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {tiles.map((tile) => (
            <Link key={tile.href} href={tile.href} className="block">
              <div className="rounded-lg border border-border/50 bg-background/70 p-4 transition-colors hover:bg-background">
                <div className="font-semibold">{tile.title}</div>
                <div className="mt-1 text-sm text-muted-foreground">{tile.description}</div>
              </div>
            </Link>
          ))}
          <div className="pt-2 text-center">
            <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
              {tOffline("retryNow")}
            </Button>
          </div>
        </CardContent>
      </PaperCard>
    </PageLayout>
  );
}
