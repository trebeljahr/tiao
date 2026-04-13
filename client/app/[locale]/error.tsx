"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/PageLayout";
import { PaperCard } from "@/components/ui/paper-card";
import { CardContent } from "@/components/ui/card";
import { BackButton } from "@/components/BackButton";
import { captureException } from "@/lib/glitchtip";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("serverError");

  useEffect(() => {
    captureException(error, { digest: error.digest });
  }, [error]);

  return (
    <PageLayout maxWidth="max-w-lg">
      <div className="flex flex-col items-center pt-8 sm:pt-16">
        <BackButton />

        <PaperCard className="mt-4 w-full shadow-xl">
          <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
            <div className="flex items-center gap-3">
              <span className="flex h-14 w-14 items-center justify-center rounded-3xl border-2 border-[#f6e8cf]/55 bg-[linear-gradient(180deg,#faefd8,#ecd4a6)] font-display text-3xl text-[#25170d] shadow-[0_32px_64px_-24px_rgba(37,23,13,0.85)]">
                跳
              </span>
              <h1 className="font-display text-4xl tracking-tighter text-[#2f2015]">Tiao</h1>
            </div>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-100 font-display text-3xl text-red-600">
              !
            </div>
            <h2 className="font-display text-2xl font-bold text-[#2b1e14]">{t("title")}</h2>
            <p className="max-w-sm text-sm text-[#6e5b48]">{t("description")}</p>
            {error.message && process.env.NODE_ENV !== "production" && (
              <pre className="w-full max-h-32 overflow-auto rounded-lg bg-black/5 p-3 text-left text-xs text-red-500">
                {error.message}
              </pre>
            )}
            <div className="mt-2 flex gap-3">
              <Button variant="outline" className="border-[#dcc7a2] px-6" onClick={reset}>
                {t("tryAgain")}
              </Button>
              <Button className="px-6" onClick={() => (window.location.href = "/")}>
                {t("backToLobby")}
              </Button>
            </div>
          </CardContent>
        </PaperCard>
      </div>
    </PageLayout>
  );
}
