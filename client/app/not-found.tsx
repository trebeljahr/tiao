import { PaperCard } from "@/components/ui/paper-card";
import { CardContent } from "@/components/ui/card";

/**
 * Root-level 404 page. Rendered outside the [locale] segment so we cannot
 * use next-intl hooks — strings are hardcoded in English.  This page is
 * hit when the path doesn't match a valid locale prefix.
 */
export default function RootNotFound() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(circle_at_top,rgba(255,247,231,0.76),transparent_58%)]" />

      <main className="mx-auto flex max-w-lg flex-col items-center px-4 pb-12 pt-24 sm:px-6">
        <PaperCard className="w-full shadow-xl">
          <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
            <div className="flex items-center gap-3">
              <span className="flex h-14 w-14 items-center justify-center rounded-3xl border-2 border-[#f6e8cf]/55 bg-[linear-gradient(180deg,#faefd8,#ecd4a6)] font-display text-3xl text-[#25170d] shadow-[0_32px_64px_-24px_rgba(37,23,13,0.85)]">
                跳
              </span>
              <h1 className="font-display text-4xl tracking-tighter text-[#2f2015]">Tiao</h1>
            </div>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f4e8d2] font-display text-2xl font-bold text-[#6c543c]">
              404
            </div>
            <h2 className="font-display text-2xl font-bold text-[#2b1e14]">Page not found</h2>
            <p className="max-w-sm text-sm text-[#6e5b48]">
              The page you&apos;re looking for doesn&apos;t exist or has been moved.
            </p>
            <a
              href="/"
              className="mt-2 inline-flex items-center justify-center rounded-xl bg-primary px-8 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/95"
            >
              Back to Lobby
            </a>
          </CardContent>
        </PaperCard>
      </main>
    </div>
  );
}
