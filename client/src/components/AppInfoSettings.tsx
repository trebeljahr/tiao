"use client";

import { useTranslations } from "next-intl";
import { AppInfoLinks } from "@/components/AppInfoLinks";
import { GameCredits } from "@/components/GameCredits";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaperCard } from "@/components/ui/paper-card";
import { useAppInfoInSettings } from "@/lib/distributionChannel";

export function AppInfoSettings() {
  const t = useTranslations("lobby");
  const appInfoInSettings = useAppInfoInSettings();
  if (!appInfoInSettings) return null;
  return (
    <PaperCard>
      <CardHeader>
        <CardTitle>{t("footerAbout")}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-[#7a6a58]">
        <GameCredits />
        <AppInfoLinks inSettings />
      </CardContent>
    </PaperCard>
  );
}
