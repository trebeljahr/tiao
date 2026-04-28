"use client";

/**
 * Impressum (legal notice) page. Required by German law (§ 5 DDG, § 18 MStV)
 * for any commercial or business-like telemedia offering — including hobby
 * projects once they show ads, accept payments, or are "nicht ausschließlich
 * persönlich oder familiär". Tiao accepts Stripe payments, so it qualifies.
 *
 * Content is driven by i18n. The German version is the authoritative one
 * (it's legally required in German); en/es are provided for discoverability.
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

export function ImpressumPage() {
  const t = useTranslations("impressum");

  return (
    <PageLayout maxWidth="max-w-3xl">
      <PaperCard className="p-6 sm:p-8">
        <div className="space-y-6">
          <header className="space-y-1">
            <h1 className="text-3xl font-semibold text-[#2a1d13]">{t("title")}</h1>
          </header>

          <Section title={t("providerTitle")}>
            <p className="whitespace-pre-line">{t("providerAddress")}</p>
          </Section>

          <Section title={t("contactTitle")}>
            <p className="whitespace-pre-line">{t("contactBody")}</p>
          </Section>

          <Section title={t("responsibleTitle")}>
            <p className="whitespace-pre-line">{t("responsibleBody")}</p>
          </Section>

          <Section title={t("euDisputeTitle")}>
            <p>{t("euDisputeBody")}</p>
          </Section>

          <Section title={t("consumerDisputeTitle")}>
            <p>{t("consumerDisputeBody")}</p>
          </Section>

          <Section title={t("liabilityContentTitle")}>
            <p>{t("liabilityContentBody")}</p>
          </Section>

          <Section title={t("liabilityLinksTitle")}>
            <p>{t("liabilityLinksBody")}</p>
          </Section>

          <Section title={t("copyrightTitle")}>
            <p>{t("copyrightBody")}</p>
          </Section>
        </div>
      </PaperCard>
    </PageLayout>
  );
}
