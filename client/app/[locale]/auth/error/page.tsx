"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { getOAuthErrorMessage } from "@/lib/oauthErrors";

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const t = useTranslations("common");
  const tError = useTranslations("authError");

  const errorCode = searchParams.get("error") || "unknown";
  const errorDescription = searchParams.get("error_description");
  const message = errorDescription || getOAuthErrorMessage(errorCode, t);

  return (
    <div className="w-full max-w-md rounded-3xl border border-border/80 bg-card/95 px-8 py-7 text-center shadow-2xl">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-black/10 bg-red-100 font-display text-4xl text-red-600 shadow-xs">
        !
      </div>
      <h1 className="mt-4 font-display text-3xl font-bold">{tError("title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      {errorCode !== "unknown" && (
        <p className="mt-3 rounded-lg bg-black/5 px-3 py-2 font-mono text-xs text-muted-foreground">
          {errorCode}
        </p>
      )}
      <div className="mt-6 flex gap-3">
        <Button className="flex-1" onClick={() => window.location.assign("/")}>
          {tError("goHome")}
        </Button>
        <Button variant="outline" className="flex-1" onClick={() => window.history.back()}>
          {tError("goBack")}
        </Button>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12 text-foreground">
      <Suspense>
        <AuthErrorContent />
      </Suspense>
    </div>
  );
}
