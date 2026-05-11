import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { useAnalyticsConsent } from "@/lib/AnalyticsConsent";

export function PrivacyCard() {
  const t = useTranslations("privacy");
  const { status, configured, grant, revoke } = useAnalyticsConsent();

  if (!configured) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settingsCardTitle")}</CardTitle>
        <CardDescription>
          {t("settingsCardDesc")}{" "}
          <Link href="/privacy" className="underline underline-offset-2">
            {t("readPolicy")}
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-sm font-medium text-[#4e3d2c]">{t("analyticsToggleLabel")}</p>
          <p className="text-xs text-[#6e5b48]">
            {status === "granted"
              ? t("analyticsOn")
              : status === "denied"
                ? t("analyticsOff")
                : t("analyticsPending")}
          </p>
        </div>
        {status === "granted" ? (
          <Button type="button" variant="outline" onClick={revoke} className="w-full">
            {t("optOut")}
          </Button>
        ) : (
          <Button type="button" onClick={grant} className="w-full">
            {t("optIn")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
