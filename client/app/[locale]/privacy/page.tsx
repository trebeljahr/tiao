import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PrivacyPolicyPage } from "@/views/PrivacyPolicyPage";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "privacy" });

  return {
    title: t("policyTitle"),
    description: t("policyMetaDescription"),
    openGraph: {
      title: t("policyTitle"),
      description: t("policyMetaDescription"),
    },
  };
}

export default function Page() {
  return <PrivacyPolicyPage />;
}
