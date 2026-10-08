"use client";

/**
 * Support page: contact address, bug reports, rules, account deletion and
 * purchase restore. App Store Connect, Google Play and Steam all require a
 * public support URL; this page is it (https://playtiao.com/support).
 *
 * support@playtiao.com is a Cloudflare Email Routing address for the
 * playtiao.com zone. Copy lives under the `support` i18n namespace.
 */

import { useTranslations } from "next-intl";
import { PageLayout } from "@/components/PageLayout";
import { PaperCard } from "@/components/ui/paper-card";
import { Link } from "@/i18n/navigation";
import { GITHUB_REPO_URL } from "@/views/AboutPage";

export const SUPPORT_EMAIL = "support@playtiao.com";

const linkClass =
  "font-medium text-[#5d4732] underline decoration-[#d4c4a8] underline-offset-2 hover:text-[#3a2818]";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xl font-semibold text-[#3a2b1b]">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-[#4a3728]">{children}</div>
    </section>
  );
}

export function SupportPage() {
  const t = useTranslations("support");
  const internal = (href: string) => (chunks: React.ReactNode) => (
    <Link href={href} className={linkClass}>
      {chunks}
    </Link>
  );

  return (
    <PageLayout maxWidth="max-w-3xl">
      <PaperCard className="p-6 sm:p-8">
        <div className="space-y-6">
          <header className="space-y-2">
            <h1 className="text-3xl font-semibold text-[#2a1d13]">{t("title")}</h1>
            <p className="text-sm leading-relaxed text-[#4a3728]">{t("intro")}</p>
          </header>

          <Section title={t("contactTitle")}>
            <p>
              {t.rich("contactBody", {
                email: (chunks) => (
                  <a href={`mailto:${SUPPORT_EMAIL}`} className={linkClass}>
                    {chunks}
                  </a>
                ),
              })}
            </p>
          </Section>

          <Section title={t("bugsTitle")}>
            <p>
              {t.rich("bugsBody", {
                repo: (chunks) => (
                  <a
                    href={`${GITHUB_REPO_URL}/issues`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={linkClass}
                  >
                    {chunks}
                  </a>
                ),
              })}
            </p>
          </Section>

          <Section title={t("rulesTitle")}>
            <p>
              {t.rich("rulesBody", { rules: internal("/rules"), tutorial: internal("/tutorial") })}
            </p>
          </Section>

          <Section title={t("accountTitle")}>
            <p>
              {t.rich("accountBody", {
                settings: internal("/settings"),
                privacy: internal("/privacy"),
              })}
            </p>
          </Section>

          <Section title={t("purchasesTitle")}>
            <p>{t("purchasesBody")}</p>
          </Section>
        </div>
      </PaperCard>
    </PageLayout>
  );
}
