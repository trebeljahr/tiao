"use client";

/**
 * Privacy policy page. Content is driven by i18n so the sections can be
 * localized (en/de/es). All controller-specific placeholders — legal
 * address, controller email, company name — live in the i18n file so
 * Rico can fill them in one place without touching the JSX.
 *
 * This page is intentionally verbose: the sections match the structure
 * required by GDPR art. 13/14 (controller, categories of data, legal
 * basis, retention, sub-processors, rights). If you add new data-
 * collection features to the app, also update the policy here (and in
 * all locale files).
 */

import { useTranslations } from "next-intl";
import { PageLayout } from "@/components/PageLayout";
import { PaperCard } from "@/components/ui/paper-card";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xl font-semibold text-[#3a2b1b]">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-[#4a3728]">{children}</div>
    </section>
  );
}

export function PrivacyPolicyPage() {
  const t = useTranslations("privacy");

  return (
    <PageLayout maxWidth="max-w-3xl">
      <PaperCard className="p-6 sm:p-8">
        <div className="space-y-6">
          <header className="space-y-1">
            <h1 className="text-3xl font-semibold text-[#2a1d13]">{t("policyTitle")}</h1>
            <p className="text-sm text-[#6e5b48]">{t("policyLastUpdated")}</p>
          </header>

          <Section title={t("controllerTitle")}>
            <p>{t("controllerIntro")}</p>
            <p className="whitespace-pre-line">{t("controllerAddress")}</p>
            <p>{t("controllerContact")}</p>
          </Section>

          <Section title={t("dataWeCollectTitle")}>
            <p>{t("dataWeCollectIntro")}</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t("dataAccount")}</li>
              <li>{t("dataGameplay")}</li>
              <li>{t("dataAnalytics")}</li>
              <li>{t("dataPayment")}</li>
              <li>{t("dataLogs")}</li>
            </ul>
          </Section>

          <Section title={t("legalBasisTitle")}>
            <p>{t("legalBasisIntro")}</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t("legalContract")}</li>
              <li>{t("legalConsent")}</li>
              <li>{t("legalLegitimate")}</li>
              <li>{t("legalLegalObligation")}</li>
            </ul>
          </Section>

          <Section title={t("subProcessorsTitle")}>
            <p>{t("subProcessorsIntro")}</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t("subProcessorHosting")}</li>
              <li>{t("subProcessorAnalytics")}</li>
              <li>{t("subProcessorStorage")}</li>
              <li>{t("subProcessorEmail")}</li>
              <li>{t("subProcessorPayments")}</li>
              <li>{t("subProcessorOAuth")}</li>
            </ul>
          </Section>

          <Section title={t("retentionTitle")}>
            <p>{t("retentionAccount")}</p>
            <p>{t("retentionAnalytics")}</p>
            <p>{t("retentionLogs")}</p>
          </Section>

          <Section title={t("rightsTitle")}>
            <p>{t("rightsIntro")}</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t("rightAccess")}</li>
              <li>{t("rightRectification")}</li>
              <li>{t("rightErasure")}</li>
              <li>{t("rightRestriction")}</li>
              <li>{t("rightPortability")}</li>
              <li>{t("rightObject")}</li>
              <li>{t("rightWithdraw")}</li>
              <li>{t("rightComplain")}</li>
            </ul>
            <p>{t("rightsHowTo")}</p>
          </Section>

          <Section title={t("cookiesTitle")}>
            <p>{t("cookiesIntro")}</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t("cookieEssential")}</li>
              <li>{t("cookieAnalytics")}</li>
            </ul>
          </Section>

          <Section title={t("changesTitle")}>
            <p>{t("changesBody")}</p>
          </Section>
        </div>
      </PaperCard>
    </PageLayout>
  );
}
