"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { PaperCard } from "@/components/ui/paper-card";
import { CardContent } from "@/components/ui/card";
import { BackButton } from "@/components/BackButton";

export function NotFoundPage() {
  const t = useTranslations("notFound");

  return (
    <div className="flex flex-col items-center pt-8 sm:pt-16">
      <BackButton />

      <PaperCard className="mt-4 w-full max-w-lg shadow-xl">
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
          <h2 className="font-display text-2xl font-bold text-[#2b1e14]">{t("title")}</h2>
          <p className="max-w-sm text-sm text-[#6e5b48]">{t("description")}</p>
          <Button className="mt-2 px-8" onClick={() => (window.location.href = "/")}>
            {t("backToLobby")}
          </Button>
        </CardContent>
      </PaperCard>
    </div>
  );
}
