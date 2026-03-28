"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("error");
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12 text-foreground">
      <div className="w-full max-w-md rounded-3xl border border-border/80 bg-card/95 px-8 py-7 text-center shadow-2xl">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-black/10 bg-red-100 font-display text-4xl text-red-600 shadow-sm">
          !
        </div>
        <h1 className="mt-4 font-display text-3xl font-bold">{t("somethingWentWrong")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("unexpectedError")}</p>
        {error.message && (
          <pre className="mt-4 max-h-32 overflow-auto rounded-lg bg-black/5 p-3 text-left text-xs text-red-500">
            {error.message}
          </pre>
        )}
        <div className="mt-6 flex gap-3">
          <Button className="flex-1" onClick={reset}>
            {t("tryAgain")}
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => window.location.assign("/")}>
            {t("backToHome")}
          </Button>
        </div>
      </div>
    </div>
  );
}
